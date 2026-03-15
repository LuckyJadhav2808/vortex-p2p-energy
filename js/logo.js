// ============================================
// VORTEX — Logo Component
// Full "VORTEX" text with subtle lightning behind
// ============================================

// Lightning bolt SVG — used as a subtle background element behind the wordmark
const BOLT_BG_SVG = `<svg viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="bolt-bg-svg">
  <path d="M24 0L8 22H18L14 48L36 20H24L28 0H24Z" fill="currentColor"/>
</svg>`;

const BOLT_SVG_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="8" fill="#0A0F1E"/>
  <path d="M36 6L16 30H28L23 58L48 28H34L40 6H36Z" fill="#00FF87"/>
</svg>`;

// Small inline bolt icon for compact logo
const BOLT_ICON_SVG = `<svg viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="bolt-icon-svg">
  <path d="M24 0L8 22H18L14 48L36 20H24L28 0H24Z" fill="currentColor"/>
</svg>`;

// Inject Full Logo (landing + auth pages)
// Shows "VORTEX" clearly with a subtle lightning bolt behind the whole wordmark
function renderFullLogo(container) {
  container.innerHTML = `
    <div class="vortex-logo vortex-logo-full">
      <div class="vortex-wordmark-wrap">
        <div class="vortex-bolt-bg">${BOLT_BG_SVG}</div>
        <span class="vortex-wordmark-text">VORTEX</span>
      </div>
      <div class="vortex-tagline">Power Your Neighbors. Own Your Grid.</div>
    </div>
  `;
}

// Inject Compact Logo (sidebar) — small bolt icon + "VORTEX" text
function renderCompactLogo(container) {
  container.innerHTML = `
    <div class="vortex-logo vortex-logo-compact" onclick="window.location.href='dashboard.html'" style="cursor:pointer;">
      <span class="vortex-bolt-icon">${BOLT_ICON_SVG}</span>
      <span class="vortex-compact-text">VORTEX</span>
    </div>
  `;
}

// Inject Compact Logo with Admin badge
function renderAdminLogo(container) {
  container.innerHTML = `
    <div class="vortex-logo vortex-logo-compact" onclick="window.location.href='dashboard.html'" style="cursor:pointer;">
      <span class="vortex-bolt-icon">${BOLT_ICON_SVG}</span>
      <span class="vortex-compact-text">VORTEX</span>
      <span class="admin-badge">ADMIN</span>
    </div>
  `;
}

// Inject Favicon
function injectFavicon() {
  const existing = document.querySelector('link[rel="icon"]');
  if (existing) existing.remove();

  const svgBlob = new Blob([BOLT_SVG_FAVICON], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = url;
  document.head.appendChild(link);
}

// First Trade Easter Egg
function triggerFirstTradeEasterEgg() {
  const bolt = document.querySelector('.vortex-bolt-icon') || document.querySelector('.vortex-bolt-bg');
  if (bolt) {
    bolt.classList.add('first-trade-flash');
    setTimeout(() => bolt.classList.remove('first-trade-flash'), 2500);
  }
}

// Fullscreen Match Celebration
function triggerMatchAnimation(kwh) {
  const overlay = document.createElement('div');
  overlay.className = 'match-overlay';
  overlay.innerHTML = `
    <div class="match-bolt">${BOLT_BG_SVG}</div>
    <div class="match-text">VORTEX ALIGNED</div>
    <div style="color:var(--accent-green);font-size:1.5rem;font-weight:600;margin-top:1rem;font-family:'Inter', sans-serif;">
      ${kwh} kWh Trade Settled
    </div>
  `;
  document.body.appendChild(overlay);
  
  // Trigger animation next frame
  requestAnimationFrame(() => {
    overlay.classList.add('active');
  });
  
  // Fade out and remove
  setTimeout(() => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  }, 2500);
}

export { renderFullLogo, renderCompactLogo, renderAdminLogo, injectFavicon, triggerFirstTradeEasterEgg, triggerMatchAnimation };
