'use strict';
/*
 * RetroCam 98 — bridge (dunia ISOLATED) di meet.google.com.
 * Tugasnya cuma dua: meneruskan preset dari chrome.storage ke halaman
 * (postMessage), dan menggambar lencana status dari laporan halaman.
 * Tidak menyentuh DOM Meet selain lencana itu sendiri.
 */
(function () {
  if (window.__rc98Bridge) return;
  window.__rc98Bridge = true;

  const MEET_KEY = 'rc98:meetPreset';
  let badge = null;
  let badgeHidden = false;

  function sendPresetToPage() {
    chrome.storage.local.get(MEET_KEY, (res) => {
      const payload = res && res[MEET_KEY] ? res[MEET_KEY] : null;
      window.postMessage(
        { source: 'retrocam98-bridge', type: 'preset', payload },
        location.origin
      );
    });
  }

  function ensureBadge() {
    if (badge || badgeHidden) return badge;
    badge = document.createElement('div');
    badge.id = 'rc98-badge';
    badge.setAttribute('role', 'status');
    badge.title = 'Klik untuk menyembunyikan lencana RetroCam 98';
    badge.style.cssText = [
      'position:fixed', 'left:12px', 'bottom:88px', 'z-index:2147483000',
      'font-family:ui-monospace,Menlo,Consolas,monospace', 'font-size:11px',
      'letter-spacing:0.06em', 'padding:6px 10px', 'cursor:pointer',
      'color:#ebe1e6', 'background:#5e6d58',
      'border:2px solid', 'border-color:#b8aea0 #222229 #222229 #b8aea0',
      'box-shadow:2px 2px 0 rgba(0,0,0,0.35)', 'user-select:none'
    ].join(';');
    badge.addEventListener('click', () => {
      badgeHidden = true;
      badge.remove();
      badge = null;
    });
    (document.body || document.documentElement).appendChild(badge);
    return badge;
  }

  function showBadge(payload) {
    const el = ensureBadge();
    if (!el) return;
    const applied = payload && payload.applied !== false && payload.autoApply !== false;
    const name = (payload && payload.presetName) || '';
    if (applied) {
      const auto = payload.autoBest ? ' · AUTO' : '';
      el.textContent = '● RETROCAM 98 AKTIF' + (name ? ' — ' + String(name).toUpperCase() : '') + auto;
      el.style.background = '#5e6d58';
      const hw = (payload.hardwareApplied || []).join(', ');
      el.title =
        'Diterapkan di kamera Meet.' +
        (hw ? ' Hardware: ' + hw + '.' : ' Hardware: tidak ada yang diterapkan.') +
        (payload.software ? ' Mode software: aktif.' : '') +
        (payload.autoBest ? ' Auto Terbaik: ' + (payload.autoBest.correction || 'berjalan.') : '') +
        ' Klik untuk menyembunyikan.';
    } else {
      el.textContent = '● RETROCAM 98 TIDAK DITERAPKAN';
      el.style.background = '#7b7975';
      el.title = 'Terapkan otomatis sedang mati atau belum ada preset. Klik untuk menyembunyikan.';
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'retrocam98-page') return;
    if (d.type === 'applied') showBadge(d.payload || {});
    if (d.type === 'request-preset') sendPresetToPage();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MEET_KEY]) sendPresetToPage();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'rc98-preset-updated') sendPresetToPage();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendPresetToPage, { once: true });
  }
  sendPresetToPage();
})();
