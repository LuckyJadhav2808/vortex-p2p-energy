# pyre-ignore-all-errors
# pyright: reportAll=false
# type: ignore
"""
VORTEX — P2P Energy Trading Matching Engine
Flask API with APScheduler for automated matching every 30 seconds.
Includes: Partial filling, platform fee, notifications, energy simulation, grid API.
"""

import os
import datetime
import math
from flask import Flask, jsonify, request  # type: ignore
from flask_cors import CORS  # type: ignore
from apscheduler.schedulers.background import BackgroundScheduler  # type: ignore
import firebase_admin  # type: ignore
from firebase_admin import credentials, firestore  # type: ignore

# ---- Firebase Admin Init ----
SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'serviceAccountKey.json')

import json

if os.path.exists(SERVICE_ACCOUNT_PATH):
    # Local development — use the key file directly
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)
elif os.environ.get('FIREBASE_CREDENTIALS'):
    # Railway / cloud deployment — JSON string in environment variable
    cred_dict = json.loads(os.environ['FIREBASE_CREDENTIALS'])
    cred = credentials.Certificate(cred_dict)
    firebase_admin.initialize_app(cred)
else:
    # Google Cloud default credentials
    firebase_admin.initialize_app()

db = firestore.client()

# ---- Flask App ----
app = Flask(__name__)
CORS(app)

# ---- Constants ----
PLATFORM_FEE_PERCENT = 0.02  # 2% platform fee on each trade


# ============================================
# MATCHING ENGINE (with partial fills + fees)
# ============================================
def run_matching_engine():
    """
    Core matching algorithm:
    1. Fetch all open sell bids (sorted by price ASC — cheapest first)
    2. Fetch all open buy bids (sorted by price DESC — highest willing to pay first)
    3. Match pairs where buyer price >= seller price
    4. Clearing price = midpoint of buy and sell prices
    5. Support partial fills: if quantities differ, fill the minimum and keep remainder open
    6. Deduct platform fee from seller credit
    7. Create notification docs for both parties
    8. Skip matches where buyer has insufficient wallet balance
    """
    try:
        log_entry("info", "Matching engine started")

        # Expire old bids first
        expire_old_bids()

        # Fetch open sell bids and sort by price ascending in memory
        sell_bids = (
            db.collection('bids')
            .where('type', '==', 'sell')
            .where('status', '==', 'open')
            .stream()
        )
        sell_list = [{'id': b.id, **b.to_dict()} for b in sell_bids]
        sell_list.sort(key=lambda x: x.get('pricePerUnit', 0))

        # Fetch open buy bids and sort by price descending in memory
        buy_bids = (
            db.collection('bids')
            .where('type', '==', 'buy')
            .where('status', '==', 'open')
            .stream()
        )
        buy_list = [{'id': b.id, **b.to_dict()} for b in buy_bids]
        buy_list.sort(key=lambda x: x.get('pricePerUnit', 0), reverse=True)

        matches_count: int = 0
        matched_sell_ids: set = set()
        matched_buy_ids: set = set()

        for sell in sell_list:
            if sell['id'] in matched_sell_ids:
                continue

            for buy in buy_list:
                if buy['id'] in matched_buy_ids:
                    continue

                # Type cast for Pyre strict mode
                buy_price = float(str(buy.get('pricePerUnit', 0.0)))  # type: ignore
                sell_price = float(str(sell.get('pricePerUnit', 0.0)))  # type: ignore
                buy_kwh = float(str(buy.get('kwhAmount', 0.0)))  # type: ignore
                sell_kwh = float(str(sell.get('kwhAmount', 0.0)))  # type: ignore

                # Is this an explicit manual match from the marketplace?
                is_explicit = (sell.get('targetBidId') == buy['id'] or buy.get('targetBidId') == sell['id'])

                # If not an explicit match, skip if either party disabled auto-match
                if not is_explicit:
                    if not sell.get('autoMatch', True) or not buy.get('autoMatch', True):
                        continue

                # Check price compatibility
                if buy_price < sell_price:
                    continue

                # Determine trade quantity (minimum of both)
                trade_kwh = float(min(sell_kwh, buy_kwh))

                # Clearing price = midpoint
                clearing_price = float((sell_price + buy_price) / 2.0)
                trade_cost = float(trade_kwh * clearing_price)

                # Platform fee
                platform_fee = float(trade_cost * PLATFORM_FEE_PERCENT)
                seller_credit = float(trade_cost - platform_fee)

                # Check buyer wallet
                buyer_doc = db.collection('users').document(buy['userId']).get()
                if not buyer_doc.exists:
                    continue
                buyer_data = buyer_doc.to_dict()
                buyer_balance = float(buyer_data.get('walletBalance', 0.0))

                if buyer_balance < trade_cost:
                    log_entry(
                        "warning",
                        "Insufficient balance for buyer {}: needs {:.2f}, has {:.2f}".format(
                            buy['userId'], trade_cost, buyer_balance
                        )
                    )
                    continue

                # ---- Execute Trade (Batch Write for Atomicity) ----
                batch = db.batch()

                # 1. Create trade record
                trade_ref = db.collection('trades').document()
                batch.set(trade_ref, {
                    'sellerId': sell['userId'],
                    'buyerId': buy['userId'],
                    'sellerZone': sell.get('zone', '?'),
                    'buyerZone': buy.get('zone', '?'),
                    'kwhAmount': trade_kwh,
                    'clearingPrice': clearing_price,
                    'platformFee': platform_fee,
                    'sellBidId': sell['id'],
                    'buyBidId': buy['id'],
                    'timestamp': firestore.SERVER_TIMESTAMP
                })

                # 2. Handle partial fills — mark fully consumed bids as matched,
                #    update partially filled bids with remaining quantity
                if sell_kwh <= buy_kwh:
                    # Sell bid fully consumed
                    batch.update(db.collection('bids').document(sell['id']), {'status': 'matched'})
                    matched_sell_ids.add(sell['id'])
                else:
                    # Sell bid partially filled — reduce remaining quantity
                    remaining_sell = float(sell_kwh - trade_kwh)
                    batch.update(db.collection('bids').document(sell['id']), {
                        'kwhAmount': remaining_sell
                    })

                if buy_kwh <= sell_kwh:
                    # Buy bid fully consumed
                    batch.update(db.collection('bids').document(buy['id']), {'status': 'matched'})
                    matched_buy_ids.add(buy['id'])
                else:
                    # Buy bid partially filled — reduce remaining quantity
                    remaining_buy = float(buy_kwh - trade_kwh)
                    batch.update(db.collection('bids').document(buy['id']), {
                        'kwhAmount': remaining_buy
                    })

                # 3. Update wallets atomically
                seller_ref = db.collection('users').document(sell['userId'])
                buyer_ref = db.collection('users').document(buy['userId'])

                batch.update(seller_ref, {
                    'walletBalance': firestore.Increment(float(seller_credit)),
                    'energyBalance': firestore.Increment(float(-trade_kwh)),
                    'tradesCompleted': firestore.Increment(int(1))
                })
                batch.update(buyer_ref, {
                    'walletBalance': firestore.Increment(float(-trade_cost)),
                    'energyBalance': firestore.Increment(float(trade_kwh)),
                    'tradesCompleted': firestore.Increment(int(1))
                })

                # 4. Wallet transaction records
                seller_tx_ref = db.collection('walletTransactions').document()
                batch.set(seller_tx_ref, {
                    'userId': sell['userId'],
                    'type': 'trade_credit',
                    'amount': seller_credit,
                    'label': "Sold {} kWh @ {:.2f}/kWh (fee: {:.2f})".format(trade_kwh, clearing_price, platform_fee),
                    'counterpartyZone': buy.get('zone', '?'),
                    'tradeId': trade_ref.id,
                    'timestamp': firestore.SERVER_TIMESTAMP
                })

                buyer_tx_ref = db.collection('walletTransactions').document()
                batch.set(buyer_tx_ref, {
                    'userId': buy['userId'],
                    'type': 'trade_debit',
                    'amount': float(-trade_cost),
                    'label': "Bought {} kWh @ {:.2f}/kWh".format(trade_kwh, clearing_price),
                    'counterpartyZone': sell.get('zone', '?'),
                    'tradeId': trade_ref.id,
                    'timestamp': firestore.SERVER_TIMESTAMP
                })

                # 5. Platform fee transaction record
                fee_tx_ref = db.collection('walletTransactions').document()
                batch.set(fee_tx_ref, {
                    'userId': 'platform',
                    'type': 'platform_fee',
                    'amount': platform_fee,
                    'label': "Fee on {} kWh trade @ {:.2f}/kWh".format(trade_kwh, clearing_price),
                    'tradeId': trade_ref.id,
                    'timestamp': firestore.SERVER_TIMESTAMP
                })

                # 6. Update platform stats
                platform_ref = db.collection('platformStats').document('totals')
                batch.set(platform_ref, {
                    'totalFees': firestore.Increment(float(platform_fee)),
                    'totalTrades': firestore.Increment(int(1)),
                    'totalKwh': firestore.Increment(float(trade_kwh)),
                    'totalSettled': firestore.Increment(float(trade_cost)),
                    'lastUpdated': firestore.SERVER_TIMESTAMP
                }, merge=True)

                # 7. Create notification docs for both parties
                seller_notif_ref = db.collection('notifications').document()
                batch.set(seller_notif_ref, {
                    'userId': sell['userId'],
                    'type': 'trade_settled',
                    'title': 'Trade Settled!',
                    'message': "You sold {} kWh at ₹{:.2f}/kWh. Credited ₹{:.2f} (fee: ₹{:.2f})".format(
                        trade_kwh, clearing_price, seller_credit, platform_fee
                    ),
                    'read': False,
                    'tradeId': trade_ref.id,
                    'timestamp': firestore.SERVER_TIMESTAMP
                })

                buyer_notif_ref = db.collection('notifications').document()
                batch.set(buyer_notif_ref, {
                    'userId': buy['userId'],
                    'type': 'trade_settled',
                    'title': 'Trade Settled!',
                    'message': "You bought {} kWh at ₹{:.2f}/kWh. Debited ₹{:.2f}".format(
                        trade_kwh, clearing_price, trade_cost
                    ),
                    'read': False,
                    'tradeId': trade_ref.id,
                    'timestamp': firestore.SERVER_TIMESTAMP
                })

                # Commit batch
                batch.commit()

                matches_count += 1  # type: ignore

                log_entry(
                    "match",
                    "Matched: {} kWh @ {:.2f}/kWh | Zone {} -> Zone {} | Fee: {:.2f}".format(
                        trade_kwh, clearing_price, sell.get('zone', '?'), buy.get('zone', '?'), platform_fee
                    )
                )

                # If sell bid was fully consumed, move to next sell bid
                if sell['id'] in matched_sell_ids:
                    break
                # Otherwise the partially-filled sell continues to match with next buyer

        log_entry("info", "Matching complete: {} trades settled".format(matches_count))
        return matches_count

    except Exception as e:
        log_entry("error", "Matching engine error: {}".format(str(e)))
        return 0


def expire_old_bids():
    """Mark bids past their expiresAt as expired. Create notifications for expired bids."""
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        open_bids = db.collection('bids').where('status', '==', 'open').stream()

        batch = db.batch()
        count: int = 0
        for bid in open_bids:
            data = bid.to_dict()
            expires_at = data.get('expiresAt')
            if expires_at:
                # Firestore Timestamp to datetime
                if hasattr(expires_at, 'timestamp'):
                    exp_time = datetime.datetime.fromtimestamp(expires_at.timestamp(), tz=datetime.timezone.utc)
                else:
                    exp_time = expires_at

                if now > exp_time:
                    batch.update(db.collection('bids').document(bid.id), {'status': 'expired'})

                    # Create notification for bid expiry
                    notif_ref = db.collection('notifications').document()
                    batch.set(notif_ref, {
                        'userId': data.get('userId', ''),
                        'type': 'bid_expired',
                        'title': 'Bid Expired',
                        'message': "Your {} bid for {} kWh at ₹{:.2f}/kWh has expired.".format(
                            data.get('type', 'sell'),
                            data.get('kwhAmount', 0),
                            data.get('pricePerUnit', 0)
                        ),
                        'read': False,
                        'timestamp': firestore.SERVER_TIMESTAMP
                    })
                    count += 1  # type: ignore

        if count > 0:
            batch.commit()
            log_entry("info", "Expired {} old bids".format(count))

    except Exception as e:
        log_entry("error", "Bid expiry error: {}".format(str(e)))


def log_entry(log_type, message):
    """Write a log entry to Firestore."""
    try:
        db.collection('logs').add({
            'type': log_type,
            'message': message,
            'timestamp': firestore.SERVER_TIMESTAMP
        })
    except Exception:
        print("[{}] {}".format(log_type.upper(), message))


# ============================================
# ENERGY GENERATION SIMULATION
# ============================================
def simulate_energy_generation():
    """
    For prosumers, simulate solar energy generation based on time-of-day
    and their solarCapacity. Runs every 5 minutes during daylight (6 AM - 6 PM IST).
    Uses a solar bell curve: peak at noon, zero at night.
    """
    try:
        # Use IST (UTC+5:30)
        ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
        now = datetime.datetime.now(ist)
        hour = now.hour + now.minute / 60.0

        # Solar bell curve: 0 before 6 AM and after 6 PM, peak at noon
        if hour < 6 or hour > 18:
            return  # No generation at night

        # Normalized solar output: sin curve from 6 AM to 6 PM
        solar_factor = math.sin(math.pi * (hour - 6) / 12)
        solar_factor = max(0, solar_factor)

        # Get all prosumers
        prosumers = db.collection('users').where('role', '==', 'prosumer').stream()
        batch = db.batch()
        count = 0

        for user_doc in prosumers:
            data = user_doc.to_dict()
            capacity = float(data.get('solarCapacity', 0))
            if capacity <= 0:
                continue

            # Generate energy: capacity per month / (30 days * 24 hours) * solar_factor * 5 min interval
            hourly_capacity = capacity / (30 * 12)  # kWh per 5-minute slot averaged
            generated = float(hourly_capacity * solar_factor)

            if generated > 0.01:  # Skip negligible amounts
                batch.update(db.collection('users').document(user_doc.id), {
                    'energyBalance': firestore.Increment(float(generated))
                })
                count += 1

        if count > 0:
            batch.commit()
            log_entry("info", "Generated solar energy for {} prosumers (factor: {:.2f})".format(count, solar_factor))

    except Exception as e:
        log_entry("error", "Energy simulation error: {}".format(str(e)))


# ============================================
# API ENDPOINTS
# ============================================

@app.route('/')
def index():
    return jsonify({'status': 'ok', 'service': 'Vortex Matching Engine', 'version': '2.0.0'})


@app.route('/api/match', methods=['POST', 'GET'])
def match_endpoint():
    """Trigger the matching engine manually or via scheduler."""
    count = run_matching_engine()
    return jsonify({
        'success': True,
        'matchesCount': count,
        'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat()
    })


@app.route('/api/price-suggestion/<zone>', methods=['GET'])
def price_suggestion(zone):
    """
    Returns a suggested bid price based on the average of the
    last 20 clearing prices for the given zone.
    """
    try:
        # Get recent trades for this zone (seller side)
        trades = list(
            db.collection('trades')
            .where('sellerZone', '==', zone)
            .stream()
        )
        
        # Also check buyer zone
        buy_trades = list(
            db.collection('trades')
            .where('buyerZone', '==', zone)
            .stream()
        )

        all_trades = trades + buy_trades
        
        # Sort by timestamp descending in memory
        def get_timestamp(t):
            data = t.to_dict()
            ts = data.get('timestamp')
            if hasattr(ts, 'timestamp'):
                return ts.timestamp()
            return 0
            
        all_trades_typed = list(all_trades)
        all_trades_typed.sort(key=get_timestamp, reverse=True)
        # Limit to 40 most recent overall
        all_trades_typed = all_trades_typed[:40]  # type: ignore

        all_prices = []  # type: ignore
        for t in all_trades_typed:
            data = t.to_dict()
            if data.get('clearingPrice'):  # type: ignore
                all_prices.append(float(str(data['clearingPrice'])))  # type: ignore

        avg_price: float = 5.50
        if all_prices:
            avg_price = float(sum(all_prices) / len(all_prices))  # type: ignore

        return jsonify({
            'zone': zone,
            'suggestedPrice': float(round(avg_price, 2)),  # type: ignore
            'basedOnTrades': len(all_prices),
            'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat()
        })

    except Exception as e:
        return jsonify({
            'zone': zone,
            'suggestedPrice': 5.50,
            'basedOnTrades': 0,
            'error': str(e)
        })


@app.route('/api/stats', methods=['GET'])
def system_stats():
    """Return system-level stats for admin panel and landing page."""
    try:
        users_count = len(list(db.collection('users').stream()))
        trades = list(db.collection('trades').stream())
        total_kwh = sum(t.to_dict().get('kwhAmount', 0) for t in trades)
        total_settled = sum(
            t.to_dict().get('kwhAmount', 0) * t.to_dict().get('clearingPrice', 0)
            for t in trades
        )

        # Platform fees
        platform_doc = db.collection('platformStats').document('totals').get()
        total_fees = 0
        if platform_doc.exists:
            total_fees = platform_doc.to_dict().get('totalFees', 0)

        return jsonify({
            'totalUsers': users_count,
            'totalTrades': len(trades),
            'totalKwh': round(total_kwh, 2),
            'totalSettled': round(total_settled, 2),
            'totalFees': round(total_fees, 2)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/platform-revenue', methods=['GET'])
def platform_revenue():
    """Return platform revenue breakdown for admin dashboard."""
    try:
        # Get platform stats
        platform_doc = db.collection('platformStats').document('totals').get()
        stats = {}
        if platform_doc.exists:
            stats = platform_doc.to_dict()

        # Get recent fee transactions for daily breakdown
        fee_txns = list(
            db.collection('walletTransactions')
            .where('type', '==', 'platform_fee')
            .stream()
        )

        daily_revenue = {}
        for tx in fee_txns:
            data = tx.to_dict()
            ts = data.get('timestamp')
            if ts and hasattr(ts, 'timestamp'):
                day = datetime.datetime.fromtimestamp(ts.timestamp(), tz=datetime.timezone.utc).strftime('%Y-%m-%d')
                daily_revenue[day] = daily_revenue.get(day, 0) + float(data.get('amount', 0))

        return jsonify({
            'totalFees': round(stats.get('totalFees', 0), 2),
            'totalTrades': stats.get('totalTrades', 0),
            'totalKwh': round(stats.get('totalKwh', 0), 2),
            'totalSettled': round(stats.get('totalSettled', 0), 2),
            'dailyRevenue': daily_revenue,
            'feePercent': PLATFORM_FEE_PERCENT * 100
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================
# GRID INTEGRATION API (Mock endpoints)
# ============================================

@app.route('/api/grid/status', methods=['GET'])
def grid_status():
    """Returns mock grid status — demonstrates grid integration capability."""
    ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    now = datetime.datetime.now(ist)
    hour = now.hour

    # Simulate grid conditions based on time of day
    if 6 <= hour <= 18:
        solar_pct = round(30 + 20 * math.sin(math.pi * (hour - 6) / 12), 1)
    else:
        solar_pct = 0

    # Simulate load
    if 9 <= hour <= 12 or 18 <= hour <= 21:
        load_level = 'high'
        frequency = round(49.85 + (hash(str(now.minute)) % 20) / 100, 2)
    elif 0 <= hour <= 5:
        load_level = 'low'
        frequency = round(50.05 + (hash(str(now.minute)) % 10) / 100, 2)
    else:
        load_level = 'medium'
        frequency = round(49.95 + (hash(str(now.minute)) % 15) / 100, 2)

    return jsonify({
        'gridFrequency': frequency,
        'loadLevel': load_level,
        'solarContribution': solar_pct,
        'windContribution': round(5 + (hash(str(now.hour)) % 10), 1),
        'totalRenewable': round(solar_pct + 5 + (hash(str(now.hour)) % 10), 1),
        'status': 'stable' if frequency >= 49.90 else 'stressed',
        'timestamp': now.isoformat()
    })


@app.route('/api/grid/tariff', methods=['GET'])
def grid_tariff():
    """Returns current government grid tariff with time-of-use rates."""
    ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    now = datetime.datetime.now(ist)
    hour = now.hour

    # Time-of-use tariff structure (₹/kWh)
    tariff_schedule = {
        'off_peak': {'rate': 6.50, 'hours': '10 PM - 6 AM', 'label': 'Off-Peak'},
        'standard': {'rate': 8.50, 'hours': '6 AM - 5 PM', 'label': 'Standard'},
        'peak': {'rate': 11.00, 'hours': '5 PM - 10 PM', 'label': 'Peak'}
    }

    if 22 <= hour or hour < 6:
        current = tariff_schedule['off_peak']
        current_type = 'off_peak'
    elif 17 <= hour < 22:
        current = tariff_schedule['peak']
        current_type = 'peak'
    else:
        current = tariff_schedule['standard']
        current_type = 'standard'

    return jsonify({
        'currentRate': current['rate'],
        'currentType': current_type,
        'currentLabel': current['label'],
        'schedule': tariff_schedule,
        'currency': 'INR',
        'provider': 'State Electricity Board (Mock)',
        'timestamp': now.isoformat()
    })


@app.route('/api/grid/report-outage', methods=['POST'])
def report_outage():
    """Accept outage reports for a zone."""
    try:
        data = request.json or {}
        zone = data.get('zone', '')
        description = data.get('description', 'Power outage reported')
        reporter_id = data.get('userId', 'anonymous')

        if not zone:
            return jsonify({'error': 'Zone is required'}), 400

        db.collection('outageReports').add({
            'zone': zone,
            'description': description,
            'reporterId': reporter_id,
            'status': 'reported',
            'timestamp': firestore.SERVER_TIMESTAMP
        })

        return jsonify({
            'success': True,
            'message': 'Outage report submitted for Zone {}'.format(zone)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/simulate-generation', methods=['POST'])
def trigger_simulation():
    """Manually trigger energy generation simulation."""
    simulate_energy_generation()
    return jsonify({
        'success': True,
        'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat()
    })


# ============================================
# SCHEDULER — Run matching every 30 seconds, energy sim every 5 minutes
# ============================================
scheduler = BackgroundScheduler()
scheduler.add_job(func=run_matching_engine, trigger='interval', seconds=30, id='matching_engine')
scheduler.add_job(func=simulate_energy_generation, trigger='interval', minutes=5, id='energy_simulation')
scheduler.start()


# ============================================
# MAIN
# ============================================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print("Vortex Matching Engine v2.0 starting on port {}".format(port))
    print("Auto-matching every 30 seconds")
    print("Energy simulation every 5 minutes")
    print("Platform fee: {}%".format(PLATFORM_FEE_PERCENT * 100))
    app.run(host='0.0.0.0', port=port, debug=False)
