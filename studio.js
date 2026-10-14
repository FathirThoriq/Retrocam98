'use strict';
/* RetroCam 98 — Studio (side panel / tab). Semua logika kamera tinggal di sini. */
(function () {
  const Core = window.RetroCore;
  const $ = (id) => document.getElementById(id);

  const NOTE_UNSUPPORTED = 'Tidak diekspos driver kamera ini — aktifkan Mode Software';
  const NOTE_SOFTWARE = 'Berlaku lewat Mode Software (software).';
  // Kunci yang diwakili filter CSS saat Mode Software menyala di pratinjau.
  const SW_KEYS = ['brightness', 'contrast', 'saturation', 'hue'];

  const SLIDERS = [
    { key: 'brightness', label: 'BRIGHTNESS', group: 'gambar', badge: 'H/S', gen: [0, 200, 1], sw: true },
    { key: 'contrast', label: 'CONTRAST', group: 'gambar', badge: 'H/S', gen: [0, 200, 1], sw: true },
    { key: 'saturation', label: 'SATURATION', group: 'gambar', badge: 'H/S', gen: [0, 200, 1], sw: true },
    { key: 'sharpness', label: 'SHARPNESS', group: 'gambar', badge: 'H/S', gen: [0, 200, 1], sw: false },
    { key: 'gamma', label: 'GAMMA', group: 'gambar', badge: 'S', gen: [50, 200, 1], sw: true, swOnly: true },
    { key: 'hue', label: 'HUE', group: 'gambar', badge: 'H/S', gen: [-180, 180, 1], sw: true },
    { key: 'exposureCompensation', label: 'EXPOSURE COMPENSATION', group: 'cahaya', badge: 'H/S', gen: [-3, 3, 0.1], sw: false },
    { key: 'colorTemperature', label: 'COLOR TEMPERATURE (K)', group: 'cahaya', badge: 'H/S', gen: [2000, 8000, 50], sw: false, pair: 'whiteBalanceMode' },
    { key: 'gain', label: 'GAIN', group: 'cahaya', badge: 'H/S', gen: [0, 100, 1], sw: false },
    { key: 'focusDistance', label: 'FOCUS DISTANCE', group: 'fokus', badge: 'H', gen: [0, 100, 1], sw: false, pair: 'focusMode' },
    { key: 'zoom', label: 'ZOOM (%)', group: 'fokus', badge: 'H/S', gen: [100, 400, 1], sw: true },
    { key: 'pan', label: 'PAN', group: 'fokus', badge: 'H/S', gen: [-100, 100, 1], sw: true },
    { key: 'tilt', label: 'TILT', group: 'fokus', badge: 'H/S', gen: [-100, 100, 1], sw: true }
  ];
  const MODES = [
    { key: 'exposureMode', label: 'EXPOSURE MODE', group: 'cahaya', options: ['auto', 'manual', 'continuous'] },
    { key: 'whiteBalanceMode', label: 'WHITE BALANCE MODE', group: 'cahaya', options: ['auto', 'manual', 'continuous'] },
    { key: 'focusMode', label: 'FOCUS MODE', group: 'fokus', options: ['auto', 'manual', 'continuous', 'single-shot'] }
  ];

  let settings = Core.cloneSettings();
  let presetName = 'Default Kamera';
  let stream = null;
  let track = null;
  let caps = null;
  let deviceId = null;
  let snapshot = null; // getSettings() saat kamera pertama menyala (untuk Reset)
  let streamStartedAt = 0;
  let persistTimer = 0;
  let customPresets = [];
  const sliderEls = {}; // key -> {wrap, input, val, note}
  const modeEls = {};

  // ---------- util ----------
  function setStatus(t) { $('statusText').textContent = t; }
  function setReport(t) { $('applyReport').textContent = t; }
  function fmtVal(key, v) {
    if (key === 'exposureCompensation') return Number(v).toFixed(1) + ' EV';
    if (key === 'colorTemperature') return v + ' K';
    return String(v);
  }

  // ---------- OSD ----------
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function tickOsd() {
    const now = new Date();
    let h = now.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const pad = (n) => String(n).padStart(2, '0');
    $('datestamp').textContent =
      ampm + ' ' + pad(h) + ':' + pad(now.getMinutes()) + '  ' +
      MONTHS[now.getMonth()] + '. ' + pad(now.getDate()) + ' ' + now.getFullYear();
    if (streamStartedAt) {
      const s = Math.floor((Date.now() - streamStartedAt) / 1000);
      $('timecode').textContent =
        Math.floor(s / 3600) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
    }
  }
  setInterval(tickOsd, 250);
  tickOsd();

  // ---------- bangun kontrol ----------
  function buildControls() {
    for (const group of ['gambar', 'cahaya', 'fokus']) {
      const page = $('page-' + group);
      for (const m of MODES.filter((x) => x.group === group)) page.appendChild(buildMode(m));
      for (const d of SLIDERS.filter((x) => x.group === group)) page.appendChild(buildSlider(d));
    }
    // Mirror: toggle software di grup fokus
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    wrap.innerHTML = '<div class="ctrl-head"><span class="ctrl-name">MIRROR (CERMIN)</span>' +
      '<span class="badge sw">S</span></div>';
    const row = document.createElement('label');
    row.className = 'switch-row';
    const span = document.createElement('span');
    span.textContent = 'Balik gambar secara horizontal';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => {
      settings.mirror = input.checked;
      onSettingsChanged('mirror');
    });
    row.append(span, input);
    wrap.appendChild(row);
    $('page-fokus').appendChild(wrap);
    sliderEls.mirror = { input };
  }

  function buildMode(def) {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    const head = document.createElement('div');
    head.className = 'ctrl-head';
    const name = document.createElement('span');
    name.className = 'ctrl-name';
    name.textContent = def.label;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'H';
    const sel = document.createElement('select');
    sel.className = 'mode';
    for (const opt of def.options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt.toUpperCase();
      sel.appendChild(o);
    }
    sel.value = settings[def.key];
    sel.addEventListener('change', () => {
      settings[def.key] = sel.value;
      refreshControlStates();
      onSettingsChanged(def.key);
    });
    head.append(name, badge, sel);
    wrap.appendChild(head);
    modeEls[def.key] = { wrap, sel };
    return wrap;
  }

  function buildSlider(def) {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    const head = document.createElement('div');
    head.className = 'ctrl-head';
    const name = document.createElement('span');
    name.className = 'ctrl-name';
    name.textContent = def.label;
    const badge = document.createElement('span');
    badge.className = 'badge' + (def.swOnly ? ' sw' : '');
    badge.textContent = def.badge;
    const val = document.createElement('span');
    val.className = 'ctrl-val';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = def.gen[0]; input.max = def.gen[1]; input.step = def.gen[2];
    input.value = settings[def.key];
    input.addEventListener('input', () => {
      settings[def.key] = Number(input.value);
      val.textContent = fmtVal(def.key, settings[def.key]);
      onSettingsChanged(def.key);
    });
    const note = document.createElement('p');
    note.className = 'note';
    head.append(name, badge, val);
    wrap.append(head, input, note);
    sliderEls[def.key] = { wrap, input, val, note, def };
    val.textContent = fmtVal(def.key, settings[def.key]);
    return wrap;
  }

  // Kunci berskala persen: rentang slider TIDAK boleh ditimpa rentang
  // native capability (penyebab bug skala v0.2.0) — biarkan generik persen.
  const PERCENT_KEYS = ['brightness', 'contrast', 'saturation', 'sharpness', 'gamma', 'hue'];

  function refreshControlStates() {
    for (const key of Object.keys(sliderEls)) {
      if (key === 'mirror') continue;
      const { input, note, wrap, def } = sliderEls[key];
      const capKey = def.key;
      const hasCap = !!(caps && Object.prototype.hasOwnProperty.call(caps, capKey));
      if (!PERCENT_KEYS.includes(capKey) && hasCap && caps[capKey] && typeof caps[capKey] === 'object' && !Array.isArray(caps[capKey])) {
        input.min = caps[capKey].min ?? def.gen[0];
        input.max = caps[capKey].max ?? def.gen[1];
        input.step = caps[capKey].step ?? def.gen[2];
      } else {
        input.min = def.gen[0]; input.max = def.gen[1]; input.step = def.gen[2];
      }
      let disabled = false;
      let noteText = '';
      if (def.pair) {
        const modeKey = def.pair;
        if (settings[modeKey] !== 'manual') {
          disabled = true;
          noteText = 'Aktif saat mode ' + modeKey.replace('Mode', '') + ' = MANUAL.';
        }
      }
      if (!disabled) {
        if (def.swOnly) {
          noteText = NOTE_SOFTWARE;
        } else if (!caps) {
          noteText = 'Nyalakan kamera untuk membaca kemampuan hardware-nya.';
          disabled = false;
        } else if (hasCap) {
          noteText = '';
        } else if (def.sw) {
          disabled = !settings.softwareMode;
          noteText = settings.softwareMode ? NOTE_SOFTWARE : NOTE_UNSUPPORTED;
        } else {
          disabled = true;
          noteText = NOTE_UNSUPPORTED;
        }
      }
      input.disabled = disabled;
      note.textContent = noteText;
      wrap.classList.toggle('unsupported', disabled);
    }
    for (const key of Object.keys(modeEls)) {
      const hasCap = !!(caps && Object.prototype.hasOwnProperty.call(caps, key));
      modeEls[key].sel.disabled = !!caps && !hasCap;
      modeEls[key].wrap.classList.toggle('unsupported', !!caps && !hasCap);
    }
    $('tglSoftware').checked = !!settings.softwareMode;
    $('tglAuto').checked = !!settings.autoApply;
    $('ledSw').classList.toggle('on', !!settings.softwareMode);
    $('ledAuto').classList.toggle('on', !!settings.autoApply);
    if (sliderEls.mirror) sliderEls.mirror.input.checked = !!settings.mirror;
  }

  function syncControlsFromSettings() {
    for (const key of Object.keys(sliderEls)) {
      if (key === 'mirror') continue;
      const e = sliderEls[key];
      e.input.value = settings[key];
      e.val.textContent = fmtVal(key, settings[key]);
    }
    for (const key of Object.keys(modeEls)) modeEls[key].sel.value = settings[key];
    refreshControlStates();
  }

  // ---------- terapkan ----------
  async function applyHardwareStepwise(constraints) {
    const applied = [];
    if (!track || !constraints.length) return applied;
    try {
      await track.applyConstraints({ advanced: constraints });
      return constraints.map((c) => Object.keys(c)[0]);
    } catch (e) { /* lanjut satu-satu */ }
    for (const c of constraints) {
      try {
        await track.applyConstraints({ advanced: [c] });
        applied.push(Object.keys(c)[0]);
      } catch (e) { /* ditolak driver — catat lewat ketiadaannya di daftar */ }
    }
    return applied;
  }

  function updatePreviewSoftware() {
    const v = $('preview');
    if (settings.softwareMode) {
      v.style.filter = Core.buildCssFilter(settings);
      const z = Math.max(1, (settings.zoom || 100) / 100);
      const m = settings.mirror ? -1 : 1;
      v.style.transform = 'scaleX(' + m * z + ') scaleY(' + z + ')';
    } else {
      v.style.filter = 'none';
      v.style.transform = settings.mirror ? 'scaleX(-1)' : '';
    }
  }

  async function applyAll(reason) {
    updatePreviewSoftware();
    if (!track) { schedulePersist(); return; }
    let constraints = Core.buildConstraints(settings, caps || {}, snapshot || {});
    if (settings.softwareMode) {
      constraints = constraints.filter((c) => !SW_KEYS.includes(Object.keys(c)[0]));
    }
    const applied = await applyHardwareStepwise(constraints);
    const failed = constraints
      .map((c) => Object.keys(c)[0])
      .filter((k) => !applied.includes(k));
    let msg = '';
    if (constraints.length) {
      msg = 'Diterapkan (hardware): ' + (applied.length ? applied.join(', ') : 'tidak ada') + '.';
      if (failed.length) msg += ' Gagal: ' + failed.join(', ') + '.';
    } else {
      msg = 'Tidak ada kontrol hardware yang tersedia dari kamera ini.';
    }
    if (settings.softwareMode) msg += ' Nilai software tampil di pratinjau & berlaku di Meet.';
    setReport(msg);
    schedulePersist();
    return applied;
  }

  function onSettingsChanged() {
    $('activePresetName').textContent = presetName.toUpperCase();
    refreshControlStates();
    applyAll();
  }

  // ---------- simpan ----------
  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 250);
  }
  function persistNow() {
    const data = {};
    const payload = {
      presetName,
      settings: Object.assign({}, settings),
      softwareMode: !!settings.softwareMode,
      autoApply: !!settings.autoApply,
      autoBest: presetName === 'Auto Terbaik',
      deviceId: deviceId || null,
      updatedAt: Date.now()
    };
    data[Core.MEET_KEY] = payload;
    data[Core.ACTIVE_KEY] = { deviceId: deviceId || null, presetName };
    if (deviceId) data[Core.storageKeyForDevice(deviceId)] = payload;
    chrome.storage.local.set(data);
  }

  // ---------- preset ----------
  function renderPresetChips() {
    const box = $('presetChips');
    box.innerHTML = '';
    for (const p of Core.BUILTIN_PRESETS) box.appendChild(chip(p, false));
    const cbox = $('customChips');
    cbox.innerHTML = '';
    for (const p of customPresets) cbox.appendChild(chip(p, true));
  }
  function chip(p, isCustom) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (isCustom ? ' custom' : '') + (p.name === presetName ? ' active' : '');
    b.textContent = p.name;
    b.addEventListener('click', () => {
      settings = Core.cloneSettings(p.settings);
      presetName = p.name;
      syncControlsFromSettings();
      $('activePresetName').textContent = presetName.toUpperCase();
      renderPresetChips();
      applyAll('preset');
    });
    return b;
  }

  // ---------- kamera ----------
  async function listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const sel = $('cameraSelect');
    const prev = sel.value || deviceId;
    sel.innerHTML = '';
    cams.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = c.deviceId;
      o.textContent = c.label || 'Kamera ' + (i + 1);
      sel.appendChild(o);
    });
    if (prev && cams.some((c) => c.deviceId === prev)) sel.value = prev;
    return cams;
  }

  function fillFormatOptions() {
    const resSel = $('resSelect');
    const fpsSel = $('fpsSelect');
    const prevRes = resSel.value;
    const prevFps = fpsSel.value;
    resSel.innerHTML = '';
    const common = [[640, 480], [1280, 720], [1920, 1080]];
    for (const [w, h] of common) {
      if (caps && caps.width) {
        if (w < (caps.width.min || 0) || w > (caps.width.max || Infinity)) continue;
      }
      const o = document.createElement('option');
      o.value = w + 'x' + h;
      o.textContent = w + ' × ' + h;
      resSel.appendChild(o);
    }
    if (!resSel.options.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Bawaan kamera';
      resSel.appendChild(o);
    }
    fpsSel.innerHTML = '';
    for (const f of [24, 30, 60]) {
      if (caps && caps.frameRate) {
        if (f < (caps.frameRate.min || 0) || f > (caps.frameRate.max || Infinity)) continue;
      }
      const o = document.createElement('option');
      o.value = String(f);
      o.textContent = f + ' fps';
      fpsSel.appendChild(o);
    }
    if (prevRes) resSel.value = prevRes;
    if (prevFps) fpsSel.value = prevFps;
  }

  async function enableCamera() {
    try {
      setStatus('Meminta izin kamera…');
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const video = {};
      const selId = $('cameraSelect').value;
      if (selId) video.deviceId = { exact: selId };
      const res = $('resSelect').value;
      if (res) {
        const [w, h] = res.split('x').map(Number);
        video.width = { ideal: w };
        video.height = { ideal: h };
      }
      const fps = $('fpsSelect').value;
      if (fps) video.frameRate = { ideal: Number(fps) };
      if (!Object.keys(video).length) video.facingMode = 'user';

      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      track = stream.getVideoTracks()[0];
      deviceId = (track.getSettings && track.getSettings().deviceId) || selId || null;
      snapshot = track.getSettings ? Object.assign({}, track.getSettings()) : null;
      caps = track.getCapabilities ? track.getCapabilities() : {};
      streamStartedAt = Date.now();

      $('preview').srcObject = stream;
      $('previewEmpty').style.display = 'none';
      $('ledCam').classList.add('on');
      $('ledCamText').textContent = 'KAMERA AKTIF';
      $('btnEnable').textContent = 'MULAI ULANG KAMERA';
      const s = snapshot || {};
      $('osdRes').textContent = (s.width || '—') + ' × ' + (s.height || '—') + (s.frameRate ? ' @ ' + Math.round(s.frameRate) : '');
      const label = (await listDevices(), track.label) || 'Kamera';
      $('previewCamName').textContent = String(label).toUpperCase();
      if (deviceId && $('cameraSelect').value !== deviceId) $('cameraSelect').value = deviceId;
      fillFormatOptions();

      // PERTAMA: inisialisasi settings dari kondisi ASLI kamera ini
      // (snapshot getSettings), supaya slider mencerminkan keadaan
      // sebenarnya. Kontrol persen diterjemahkan dari native lewat
      // jangkar nilai bawaannya sendiri (hasilnya ~100 menurut
      // konstruksi: 100% = kondisi bawaan kamera). Kontrol satuan-asli
      // disalin apa adanya. Preset tersimpan di bawah menimpa ini.
      if (snapshot) {
        const init = Core.cloneSettings(settings);
        for (const k of Core.MULT_KEYS) {
          if (typeof snapshot[k] === 'number' && caps && caps[k]) {
            init[k] = Core.nativeToPercent(snapshot[k], caps[k], snapshot[k]);
          }
        }
        for (const k of ['exposureCompensation', 'colorTemperature', 'gain', 'zoom', 'focusDistance', 'pan', 'tilt']) {
          if (typeof snapshot[k] === 'number' &&
              Object.prototype.hasOwnProperty.call(Core.DEFAULT_SETTINGS, k)) {
            init[k] = snapshot[k];
          }
        }
        settings = init;
      }

      // Preset tersimpan untuk kamera ini mengalahkan nilai saat ini.
      if (deviceId) {
        const key = Core.storageKeyForDevice(deviceId);
        const stored = await chrome.storage.local.get(key);
        if (stored[key] && stored[key].settings) {
          settings = Core.cloneSettings(stored[key].settings);
          presetName = stored[key].presetName || presetName;
          $('activePresetName').textContent = presetName.toUpperCase();
          renderPresetChips();
        }
      }
      syncControlsFromSettings();
      const capKeys = Object.keys(caps || {}).length;
      setStatus('Kamera aktif. Capability hardware terbaca: ' + capKeys + ' entri. Geser slider untuk menerapkan.');
      await applyAll('enable');
    } catch (e) {
      setStatus('Gagal menyalakan kamera: ' + (e && e.message ? e.message : e));
      $('ledCam').classList.remove('on');
      $('ledCamText').textContent = 'KAMERA MATI';
    }
  }

  // ---------- AUTO: setting terbaik ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 160; sampleCanvas.height = 120;

  function sampleFrameStats() {
    const v = $('preview');
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
      // Ukur area TENGAH frame (70% x 70%): keputusan exposure harus
      // menilai objek di tengah, bukan latar yang meledak di pinggir.
      const sw = Math.max(1, Math.round(v.videoWidth * 0.7));
      const sh = Math.max(1, Math.round(v.videoHeight * 0.7));
      const sx = Math.round((v.videoWidth - sw) / 2);
      const sy = Math.round((v.videoHeight - sh) / 2);
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const img = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
      return Core.computeFrameStats(img.data, sampleCanvas.width, sampleCanvas.height);
    } catch (e) {
      return null;
    }
  }

  function focusSweepPossible() {
    if (!caps || !caps.focusDistance || typeof caps.focusDistance !== 'object' ||
        Array.isArray(caps.focusDistance)) return false;
    if (!caps.focusMode) return false;
    return !Array.isArray(caps.focusMode) || caps.focusMode.includes('manual');
  }

  /*
   * Sapu 5 nilai focusDistance, ukur ketajaman tiap nilai, pilih tertajam.
   * Nilai fokus TIDAK dikarang oleh rekomendasi — ini satu-satunya cara
   * jujur mencari fokus terbaik pada kamera fokus manual.
   */
  async function runFocusSweep() {
    const cap = caps.focusDistance;
    const min = typeof cap.min === 'number' ? cap.min : 0;
    const max = typeof cap.max === 'number' ? cap.max : 100;
    const prevMode = settings.focusMode;
    const prevDist = settings.focusDistance;
    settings.focusMode = 'manual';
    let best = null;
    try {
      for (let i = 0; i < 5; i++) {
        if (!stream || !track || track.readyState === 'ended') {
          throw new Error('stream berhenti di tengah sapuan fokus');
        }
        const val = Math.round((min + ((max - min) * i) / 4) * 100) / 100;
        settings.focusDistance = val;
        syncControlsFromSettings();
        await applyAll('auto-focus-sweep');
        await wait(250);
        const st = sampleFrameStats();
        if (st && (!best || st.sharpness > best.sharpness)) {
          best = { value: val, sharpness: st.sharpness };
        }
      }
    } catch (e) {
      // Sapuan gagal di tengah jalan: kembalikan fokus seperti semula.
      settings.focusMode = prevMode;
      settings.focusDistance = prevDist;
      syncControlsFromSettings();
      return null;
    }
    if (!best) {
      settings.focusMode = prevMode;
      settings.focusDistance = prevDist;
      syncControlsFromSettings();
      return null;
    }
    settings.focusMode = 'manual';
    settings.focusDistance = best.value;
    syncControlsFromSettings();
    await applyAll('auto-focus-best');
    return best;
  }

  function showAutoReport(before, after, reasonList, closing) {
    $('autoReport').classList.remove('hidden');
    const line = (label, b, a, unit) =>
      label + ': ' + b + unit + ' → ' + a + unit;
    $('autoStats').textContent = [
      line('Terang (luma rata-rata)', Math.round(before.meanLuma), Math.round(after.meanLuma), ''),
      '  target ' + Core.TARGET_LUMA.min + '–' + Core.TARGET_LUMA.max,
      line('Putih meledak (clip)', Math.round(before.whiteClipPct), Math.round(after.whiteClipPct), '%'),
      line('Rentang kontras', Math.round(before.contrastSpan), Math.round(after.contrastSpan), ''),
      line('Ketajaman', before.sharpness, after.sharpness, '')
    ].join('\n');
    const ul = $('autoReasons');
    ul.innerHTML = '';
    for (const r of reasonList) {
      const li = document.createElement('li');
      li.textContent = r;
      ul.appendChild(li);
    }
    $('autoClosing').textContent = closing;
  }

  async function runAutoBest() {
    const btn = $('btnAuto');
    if (!stream || !track || track.readyState === 'ended') {
      setStatus('AUTO butuh kamera menyala — tekan AKTIFKAN KAMERA dulu, baru jalankan AUTO.');
      setReport('AUTO dibatalkan: kamera belum aktif.');
      return;
    }
    btn.disabled = true;
    const btnText = btn.textContent;
    btn.textContent = 'AUTO BERJALAN…';
    try {
      const before = sampleFrameStats();
      if (!before) throw new Error('frame pratinjau belum siap dibaca');
      // Salinan untuk pagar pengaman: bila AUTO justru merusak warna,
      // nilai terkait dikembalikan ke kondisi sebelum AUTO.
      const preAuto = Object.assign({}, settings);

      presetName = 'Auto Terbaik';
      $('activePresetName').textContent = presetName.toUpperCase();
      renderPresetChips();
      const reasonList = ['Statistik diukur dari area tengah frame (objek).'];

      // Putaran 1: rekomendasi dari frame saat ini.
      const rec = Core.recommendSettings(before, caps || {}, settings);
      Object.assign(settings, rec.patch);
      reasonList.push(...rec.reasons);
      syncControlsFromSettings();
      await applyAll('auto');

      // Fokus: sapuan jarak fokus bila hardware mendukung.
      if (focusSweepPossible()) {
        const best = await runFocusSweep();
        if (best) {
          reasonList.push('Sapuan fokus selesai: jarak fokus ' + best.value +
            ' memberi ketajaman tertinggi (' + best.sharpness + ') di kamera ini.');
        } else {
          reasonList.push('Sapuan fokus tidak tuntas; nilai fokus dikembalikan seperti sebelum AUTO.');
        }
      } else if (caps && caps.focusMode && Array.isArray(caps.focusMode) &&
                 caps.focusMode.includes('continuous') &&
                 settings.focusMode === 'continuous') {
        reasonList.push('Fokus: mode continuous aktif — kamera mengunci objek secara otomatis.');
      } else {
        reasonList.push('Fokus: kamera ini tidak mengekspos jarak fokus manual, jadi fokus bersifat tetap/otomatis dari kameranya.');
      }

      // Putaran 2 (maksimal): ukur ulang setelah exposure hardware bekerja.
      await wait(700);
      let after = sampleFrameStats() || before;
      let rounds = 1;
      if (after.meanLuma < Core.TARGET_LUMA.min || after.meanLuma > Core.TARGET_LUMA.max) {
        const rec2 = Core.recommendSettings(after, caps || {}, settings);
        if (Object.keys(rec2.patch).length) {
          Object.assign(settings, rec2.patch);
          reasonList.push(...rec2.reasons);
          syncControlsFromSettings();
          await applyAll('auto-2');
          rounds = 2;
          await wait(700);
          after = sampleFrameStats() || after;
        }
      }

      // Pagar pengaman saturasi: bila warna justru memburuk jauh setelah
      // koreksi (gejala ketidakcocokan skala driver), kembalikan
      // saturasi ke nilai sebelum AUTO dan terapkan ulang.
      if (typeof before.saturationMean === 'number' && before.saturationMean >= 0.05 &&
          typeof after.saturationMean === 'number' &&
          after.saturationMean < 0.7 * before.saturationMean) {
        settings.saturation = preAuto.saturation;
        syncControlsFromSettings();
        await applyAll('auto-sat-guard');
        reasonList.push('Saturasi sempat turun setelah koreksi (kemungkinan skala driver) — ' +
          'nilai saturasi dikembalikan seperti sebelum AUTO.');
        await wait(250);
        after = sampleFrameStats() || after;
      }

      persistNow();
      let closing;
      if (after.meanLuma < Core.TARGET_LUMA.min || after.meanLuma > Core.TARGET_LUMA.max) {
        closing = 'Selesai dalam ' + rounds + ' putaran, tetapi terang akhir (' + Math.round(after.meanLuma) +
          ') masih di luar target ' + Core.TARGET_LUMA.min + '–' + Core.TARGET_LUMA.max +
          ' — keterbatasan kamera/kondisi cahaya ruangan. Geser posisi cahaya atau atur manual bila perlu.';
      } else {
        closing = 'Selesai dalam ' + rounds + ' putaran — terang gambar masuk target. ' +
          'Hasil tersimpan sebagai preset "Auto Terbaik" untuk kamera ini dan untuk Google Meet.';
      }
      showAutoReport(before, after, reasonList, closing);
      setReport('AUTO selesai (' + rounds + ' putaran koreksi). Preset aktif: Auto Terbaik.');
      setStatus('AUTO selesai. Hasil tersimpan untuk kamera ini dan Google Meet.');
    } catch (e) {
      setReport('AUTO gagal: ' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
      btn.textContent = btnText;
    }
  }

  // ---------- reset ----------
  async function resetAll() {
    settings = Core.cloneSettings();
    presetName = 'Default Kamera';
    $('activePresetName').textContent = presetName.toUpperCase();
    renderPresetChips();
    syncControlsFromSettings();
    updatePreviewSoftware();
    if (track && snapshot && caps) {
      // Snapshot berisi nilai NATIVE driver — jangan diteruskan mentah
      // sebagai persen. Konversi dulu: kontrol persen lewat
      // nativeToPercent (berjangkar nilai bawaan itu sendiri), kontrol
      // satuan-asli disalin apa adanya.
      const restore = Core.cloneSettings();
      for (const k of Object.keys(Core.DEFAULT_SETTINGS)) {
        if (typeof snapshot[k] !== 'number') continue;
        restore[k] = Core.MULT_KEYS.includes(k)
          ? Core.nativeToPercent(snapshot[k], caps[k], snapshot[k])
          : snapshot[k];
      }
      const constraints = Core.buildConstraints(restore, caps, snapshot);
      const applied = await applyHardwareStepwise(constraints);
      setReport('Reset: nilai awal kamera dikembalikan (' +
        (applied.length ? applied.join(', ') : 'tidak ada kontrol hardware') + ').');
    } else {
      setReport('Reset: pengaturan kembali ke bawaan RetroCam 98.');
    }
    schedulePersist();
  }

  // ---------- init ----------
  function init() {
    buildControls();

    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        for (const g of ['gambar', 'cahaya', 'fokus', 'format']) {
          $('page-' + g).classList.toggle('hidden', g !== btn.dataset.tab);
        }
      });
    });

    $('btnEnable').addEventListener('click', enableCamera);
    $('btnRefresh').addEventListener('click', () => listDevices().catch(() => {}));
    $('cameraSelect').addEventListener('change', () => { if (stream) enableCamera(); });
    $('resSelect').addEventListener('change', () => { if (stream) enableCamera(); });
    $('fpsSelect').addEventListener('change', () => { if (stream) enableCamera(); });
    $('btnReset').addEventListener('click', resetAll);
    $('btnAuto').addEventListener('click', runAutoBest);

    $('tglSoftware').addEventListener('change', (e) => {
      settings.softwareMode = e.target.checked;
      onSettingsChanged('softwareMode');
    });
    $('tglAuto').addEventListener('change', (e) => {
      settings.autoApply = e.target.checked;
      onSettingsChanged('autoApply');
    });
    $('btnSavePreset').addEventListener('click', () => {
      const name = $('customName').value.trim();
      if (!name) { setReport('Isi nama preset dulu sebelum menyimpan.'); return; }
      customPresets.push({
        id: 'custom-' + Date.now(),
        name,
        settings: Object.assign({}, settings)
      });
      chrome.storage.local.set({ [Core.CUSTOM_KEY]: customPresets });
      presetName = name;
      $('customName').value = '';
      $('activePresetName').textContent = name.toUpperCase();
      renderPresetChips();
      schedulePersist();
      setReport('Preset "' + name + '" tersimpan.');
    });

    chrome.storage.local.get([Core.MEET_KEY, Core.CUSTOM_KEY], (res) => {
      if (res[Core.MEET_KEY] && res[Core.MEET_KEY].settings) {
        settings = Core.cloneSettings(res[Core.MEET_KEY].settings);
        presetName = res[Core.MEET_KEY].presetName || presetName;
        $('activePresetName').textContent = presetName.toUpperCase();
      }
      customPresets = Array.isArray(res[Core.CUSTOM_KEY]) ? res[Core.CUSTOM_KEY] : [];
      renderPresetChips();
      syncControlsFromSettings();
    });
    renderPresetChips();
    syncControlsFromSettings();
    listDevices().catch(() => {});
    fillFormatOptions();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
