'use strict';
/* RetroCam 98 — popup: preset cepat + status + pintu ke Studio. */
(function () {
  const Core = window.RetroCore;
  const $ = (id) => document.getElementById(id);
  let meetPreset = null;
  let previewStream = null;

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function stamp() {
    const now = new Date();
    let h = now.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const pad = (n) => String(n).padStart(2, '0');
    $('datestamp').textContent = ampm + ' ' + pad(h) + ':' + pad(now.getMinutes()) + '  ' +
      MONTHS[now.getMonth()] + '. ' + pad(now.getDate()) + ' ' + now.getFullYear();
  }
  stamp();
  setInterval(stamp, 5000);

  function renderStatus() {
    const name = (meetPreset && meetPreset.presetName) || 'Default Kamera';
    $('activeName').textContent = name.toUpperCase();
    const auto = !meetPreset || meetPreset.autoApply !== false;
    $('led').classList.toggle('on', auto);
    $('ledText').textContent = auto ? 'AUTO-APPLY ON' : 'AUTO-APPLY OFF';
    document.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.name === name);
    });
  }

  function choosePreset(p) {
    const prev = meetPreset || {};
    meetPreset = {
      presetName: p.name,
      settings: Core.cloneSettings(p.settings),
      softwareMode: prev.softwareMode === true || p.settings.softwareMode === true,
      autoApply: prev.autoApply !== undefined ? prev.autoApply : true,
      autoBest: false,
      deviceId: prev.deviceId || null,
      updatedAt: Date.now()
    };
    // Hormati nilai toggle dari settings preset itu sendiri bila belum ada preset sebelumnya.
    if (!prev.presetName) {
      meetPreset.softwareMode = p.settings.softwareMode === true;
      meetPreset.autoApply = p.settings.autoApply !== false;
    }
    const data = { [Core.MEET_KEY]: meetPreset };
    chrome.storage.local.get(Core.ACTIVE_KEY, (res) => {
      const active = res[Core.ACTIVE_KEY] || {};
      const dev = meetPreset.deviceId || active.deviceId;
      if (dev) data[Core.storageKeyForDevice(dev)] = meetPreset;
      chrome.storage.local.set(data, () => {
        $('statusText').textContent = 'Preset "' + p.name + '" aktif untuk Google Meet.';
        renderStatus();
      });
    });
    renderStatus();
  }

  function buildChips() {
    const box = $('chips');
    for (const p of Core.BUILTIN_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.name = p.name;
      b.textContent = p.name;
      b.addEventListener('click', () => choosePreset(p));
      box.appendChild(b);
    }
  }

  $('btnAutoBest').addEventListener('click', () => {
    const prev = meetPreset || {};
    meetPreset = {
      presetName: 'Auto Terbaik',
      settings: Core.cloneSettings(prev.settings),
      softwareMode: prev.softwareMode === true,
      autoApply: true,
      autoBest: true,
      deviceId: prev.deviceId || null,
      updatedAt: Date.now()
    };
    const data = { [Core.MEET_KEY]: meetPreset };
    chrome.storage.local.get(Core.ACTIVE_KEY, (res) => {
      const active = res[Core.ACTIVE_KEY] || {};
      const dev = meetPreset.deviceId || active.deviceId;
      if (dev) data[Core.storageKeyForDevice(dev)] = meetPreset;
      chrome.storage.local.set(data, () => {
        $('statusText').textContent =
          'Auto Terbaik aktif — analisis otomatis berjalan di Meet saat kamera dinyalakan.';
        renderStatus();
      });
    });
    renderStatus();
  });

  $('btnStudio').addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'rc98-open-studio' }, () => {
        void chrome.runtime.lastError;
        window.close();
      });
    } catch (e) {
      chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') });
      window.close();
    }
  });

  $('btnPreview').addEventListener('click', async () => {
    try {
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        previewStream = null;
        $('preview').srcObject = null;
        $('previewEmpty').style.display = 'flex';
        $('btnPreview').textContent = 'NYALAKAN PRATINJAU';
        return;
      }
      previewStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      $('preview').srcObject = previewStream;
      const settings = Core.cloneSettings(meetPreset && meetPreset.settings);
      if (settings.softwareMode) $('preview').style.filter = Core.buildCssFilter(settings);
      if (settings.mirror) $('preview').style.transform = 'scaleX(-1)';
      $('previewEmpty').style.display = 'none';
      $('btnPreview').textContent = 'MATIKAN PRATINJAU';
    } catch (e) {
      $('statusText').textContent = 'Pratinjau gagal: ' + (e && e.message ? e.message : e);
    }
  });

  buildChips();
  chrome.storage.local.get(Core.MEET_KEY, (res) => {
    meetPreset = res[Core.MEET_KEY] || null;
    renderStatus();
  });
})();
