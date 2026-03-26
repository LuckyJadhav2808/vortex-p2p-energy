---
description: How to redeploy Vortex (GitHub → Render auto-deploys)
---

## Step 1: Commit your latest changes
```bash
git add .
git commit -m "describe what you changed"
```

## Step 2: Push to GitHub
```bash
git push origin main
```

That's it for both frontend and backend! Render auto-deploys both services on every push.
- **Frontend** (static site): updates in ~1 minute
- **Backend** (`backend/app.py`): rebuilds in ~2–3 minutes

Monitor deployments at: **dashboard.render.com** → click your service → **Logs** tab

---

## If you changed Firestore Rules (`firestore.rules`)
Render does NOT handle this. Deploy manually via Firebase Console:
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Firestore → **Rules** tab
3. Paste the updated rules → click **Publish**

---

## Quick Reference

| What changed | What to do |
|---|---|
| HTML / JS / CSS | `git add . && git commit -m "..." && git push` |
| `backend/app.py` or `requirements.txt` | Same push — Render rebuilds backend |
| `firestore.rules` | Paste manually in Firebase Console |
| Firebase config (`js/config.js`) | Update file, then push |
