'use strict';
/*
 * RetroCam 98 — script dunia MAIN di meet.google.com.
 * Meng-override navigator.mediaDevices.getUserMedia supaya stream video
 * yang diterima Meet sudah diatur sesuai preset aktif.
 *
 * File ini SENGAJA mandiri: dunia MAIN tidak bisa memuat file ekstensi
 * lain, jadi pemetaan constraints & filter CSS ditulis ulang ringkas
 * di sini (padanan core.js — jaga keduanya tetap sejalan).
 *
 * Prinsip jujur: kegagalan apa pun TIDAK BOLEH menggagalkan panggilan
 * kamera Meet. Jalur yang gagal dilaporkan apa adanya lewat postMessage,
 * dan stream asli selalu jadi fallback terakhir.
 */
(function () {
  if (window.__rc98Main) return;
  window.__rc98Main = true;

  let currentPreset = null; // {presetName, settings, softwareMode, autoApply}
  let activeSession = null; // sesi software yang sedang berjalan

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'retrocam98-bridge' || d.type !== 'preset') return;
    currentPreset = d.payload || null;
  });
  // Minta preset yang mungkin sudah dikirim sebelum listener ini siap.
  window.postMessage({ source: 'retrocam98-page', type: 'request-preset' }, location.origin);

  function report(payload) {
    window.postMessage(
      { source: 'retrocam98-page', type: 'applied', payload },
      location.origin
    );
  }

  // ---------- pemetaan ringkas (padanan core.js) ----------
  function clampToCap(value, cap) {
    if (!cap || typeof cap !== 'object' || Array.isArray(cap)) return value;
    let v = Number(value);
    if (Number.isNaN(v)) return value;
    if (typeof cap.min === 'number') v = Math.max(cap.min, v);
    if (typeof cap.max === 'number') v = Math.min(cap.max, v);
    if (typeof cap.step === 'number' && cap.step > 0) {
      const base = typeof cap.min === 'number' ? cap.min : 0;
      v = base + Math.round((v - base) / cap.step) * cap.step;
      v = Math.round(v * 1e6) / 1e6;
    }
    return v;
  }

  /*
   * Kontrol multiplikatif berskala persen (100 = bawaan kamera).
   * Capability native driver (mis. 0-255) TIDAK se-skala dengan persen,
   * jadi nilai persen diterjemahkan berjangkar nilai bawaan native
   * track (getSettings) — padanan percentToNative di core.js (bug
   * v0.2.0: persen diteruskan mentah sebagai native, warna anjlok).
   */
  const MULT_KEYS = ['brightness', 'contrast', 'saturation', 'sharpness'];

  function percentToNative(pct, cap, defaultNative) {
    const isRange = cap && typeof cap === 'object' && !Array.isArray(cap) &&
      (typeof cap.min === 'number' || typeof cap.max === 'number');
    if (!isRange) return pct;
    const p = Number(pct);
    if (Number.isNaN(p)) return pct;
    const d = Number(defaultNative);
    if (Number.isFinite(d) && (typeof cap.min !== 'number' || d > cap.min)) {
      return clampToCap(d * (p / 100), cap);
    }
    if (typeof cap.min === 'number' && typeof cap.max === 'number') {
      return clampToCap(cap.min + (p / 200) * (cap.max - cap.min), cap);
    }
    return clampToCap(p, cap);
  }

  function buildConstraints(settings, caps, defaultsNative) {
    const out = [];
    if (!settings || !caps) return out;
    const has = (k) => Object.prototype.hasOwnProperty.call(caps, k);
    const modeOk = (mode, cap) => !Array.isArray(cap) || cap.includes(mode);
    const range = (k, sk) => { if (has(k)) out.push({ [k]: clampToCap(settings[sk || k], caps[k]) }); };
    const mult = (k) => {
      if (has(k)) out.push({ [k]: percentToNative(settings[k], caps[k], defaultsNative ? defaultsNative[k] : undefined) });
    };
    mult('brightness'); mult('contrast'); mult('saturation'); mult('sharpness'); range('hue');
    if (has('exposureMode') && modeOk(settings.exposureMode, caps.exposureMode)) out.push({ exposureMode: settings.exposureMode });
    range('exposureCompensation');
    if (has('whiteBalanceMode') && modeOk(settings.whiteBalanceMode, caps.whiteBalanceMode)) out.push({ whiteBalanceMode: settings.whiteBalanceMode });
    if (settings.whiteBalanceMode === 'manual') range('colorTemperature');
    range('gain');
    if (has('focusMode') && modeOk(settings.focusMode, caps.focusMode)) out.push({ focusMode: settings.focusMode });
    if (settings.focusMode === 'manual') range('focusDistance');
    range('zoom'); range('pan'); range('tilt');
    return out;
  }

  function cssFilter(s) {
    // Gamma didekati dengan faktor brightness keseluruhan (lihat core.js).
    // _lumaFactor diisi analisis Auto Terbaik (koreksi terang jalur software).
    const parts = [];
    const bright = ((s.brightness ?? 100) / 100) * ((s.gamma ?? 100) / 100) * (s._lumaFactor ?? 1);
    const contrast = (s.contrast ?? 100) / 100;
    const saturate = (s.saturation ?? 100) / 100;
    const hue = s.hue ?? 0;
    const t = (n) => String(Math.round(n * 10000) / 10000);
    if (bright !== 1) parts.push('brightness(' + t(bright) + ')');
    if (contrast !== 1) parts.push('contrast(' + t(contrast) + ')');
    if (saturate !== 1) parts.push('saturate(' + t(saturate) + ')');
    if (hue !== 0) parts.push('hue-rotate(' + t(hue) + 'deg)');
    return parts.length ? parts.join(' ') : 'none';
  }

  async function applyHardwareStepwise(track, constraints) {
    const applied = [];
    if (!constraints.length) return applied;
    try {
      await track.applyConstraints({ advanced: constraints });
      return constraints.map((c) => Object.keys(c)[0]);
    } catch (e) { /* lanjut satu-satu */ }
    for (const c of constraints) {
      try {
        await track.applyConstraints({ advanced: [c] });
        applied.push(Object.keys(c)[0]);
      } catch (e) { /* kontrol ini ditolak kamera/driver — lewati */ }
    }
    return applied;
  }

  // ---------- Auto Terbaik: analisis frame ringkas (mandiri) ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /*
   * Satu putaran analisis untuk payload autoBest: sampel frame 160x120
   * dari stream, hitung meanLuma + whiteClipPct, lalu koreksi:
   * - terlalu terang (>165): exposureCompensation -1.0 bila didukung track
   * - terlalu gelap (<70): exposureCompensation +1.0 bila didukung track
   * - faktor koreksi brightness untuk jalur software selalu dihitung
   *   (target luma 128, clamp 0.6-1.5) dan dipakai pemanggil bila
   *   softwareMode aktif.
   * Kegagalan apa pun mengembalikan null — getUserMedia Meet TIDAK BOLEH
   * gagal gara-gara analisis ini.
   */
  async function analyzeAutoBest(stream, track, settings) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      try { await Promise.race([video.play(), sleep(1200)]); } catch (e) {}
      const deadline = Date.now() + 1200;
      while ((!video.videoWidth || video.readyState < 2) && Date.now() < deadline) {
        await sleep(80);
      }
      if (!video.videoWidth || !video.videoHeight) return null;

      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 120;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, 160, 120);
      const data = ctx.getImageData(0, 0, 160, 120).data;
      const total = 160 * 120;
      let sumL = 0, white = 0;
      for (let i = 0; i < total; i++) {
        const o = i * 4;
        const L = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
        sumL += L;
        if (L > 245) white++;
      }
      const meanLuma = Math.round((sumL / total) * 100) / 100;
      const whiteClipPct = Math.round(((white / total) * 100) * 100) / 100;

      let delta = 0;
      let evApplied = null;
      let desc;
      if (meanLuma > 165) {
        delta = -1.0;
        desc = 'gambar terlalu terang — exposure diturunkan -1.0 EV';
      } else if (meanLuma < 70) {
        delta = 1.0;
        desc = 'gambar terlalu gelap — exposure dinaikkan +1.0 EV';
      } else {
        desc = 'terang gambar dalam rentang wajar — tanpa koreksi exposure tambahan';
      }
      if (delta !== 0) {
        try {
          const caps = track.getCapabilities ? track.getCapabilities() : {};
          if (Object.prototype.hasOwnProperty.call(caps, 'exposureCompensation')) {
            const cur = (track.getSettings && track.getSettings().exposureCompensation) ??
              settings.exposureCompensation ?? 0;
            const target = clampToCap(cur + delta, caps.exposureCompensation);
            await track.applyConstraints({ advanced: [{ exposureCompensation: target }] });
            evApplied = target;
          } else {
            desc += ' (kontrol exposure tidak tersedia di kamera ini)';
          }
        } catch (e) {
          desc += ' (koreksi exposure ditolak kamera)';
        }
      }
      const factorRaw = 128 / Math.max(meanLuma, 1);
      const softwareFactor = Math.round(Math.min(1.5, Math.max(0.6, factorRaw)) * 10000) / 10000;
      return {
        meanLuma,
        whiteClipPct,
        exposureCompensation: evApplied,
        softwareFactor,
        correction: desc + '; luma ' + Math.round(meanLuma) +
          ', putih meledak ' + Math.round(whiteClipPct) + '%' +
          (evApplied !== null ? ', exposure sekarang ' + evApplied + ' EV' : '')
      };
    } catch (e) {
      return null;
    } finally {
      try { video.pause(); } catch (e) {}
      video.srcObject = null;
    }
  }

  // ---------- jalur software lewat canvas ----------
  function stopSession() {
    if (!activeSession) return;
    const s = activeSession;
    activeSession = null;
    try { s.stop(); } catch (e) { /* abaikan */ }
  }

  function wrapSoftware(originalStream, track, settings) {
    const srcSettings = (track.getSettings && track.getSettings()) || {};
    const srcW = srcSettings.width || 640;
    const srcH = srcSettings.height || 480;
    const scale = Math.min(1, 1280 / srcW, 720 / srcH);
    const cw = Math.max(2, Math.round((srcW * scale) / 2) * 2);
    const ch = Math.max(2, Math.round((srcH * scale) / 2) * 2);

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = originalStream;

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D tidak tersedia');

    let raf = 0;
    let stopped = false;
    const session = {
      stop() {
        stopped = true;
        if (raf) cancelAnimationFrame(raf);
        try { video.pause(); } catch (e) {}
        video.srcObject = null;
      }
    };

    const zoomFactor = Math.max(1, (settings.zoom ?? 100) / 100);
    const draw = () => {
      if (stopped) return;
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (video.readyState < 2 || !video.videoWidth) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cropW = vw / zoomFactor;
      const cropH = vh / zoomFactor;
      const maxX = (vw - cropW) / 2;
      const maxY = (vh - cropH) / 2;
      const sx = maxX + (maxX * ((settings.pan ?? 0) / 100));
      const sy = maxY + (maxY * ((settings.tilt ?? 0) / 100));
      ctx.filter = cssFilter(settings);
      ctx.save();
      if (settings.mirror) {
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);
      }
      try {
        ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cw, ch);
      } catch (e) { /* frame belum siap */ }
      ctx.restore();
    };

    return video.play().then(() => {
      draw();
      const canvasStream = canvas.captureStream(30);
      const outTracks = canvasStream.getVideoTracks();
      const out = new MediaStream([...outTracks, ...originalStream.getAudioTracks()]);
      const cleanup = () => { if (activeSession === session) stopSession(); };
      outTracks.forEach((t) => t.addEventListener('ended', cleanup));
      track.addEventListener('ended', cleanup);
      activeSession = session;
      return out;
    });
  }

  // ---------- override getUserMedia ----------
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') return;
  const originalGetUserMedia = md.getUserMedia.bind(md);

  md.getUserMedia = async function (constraints) {
    const wantsVideo = !!constraints && constraints.video !== false && constraints.video !== undefined;
    const stream = await originalGetUserMedia(constraints);
    if (!wantsVideo) return stream;

    const preset = currentPreset;
    if (!preset || !preset.settings) return stream; // belum ada preset: jangan sentuh apa pun

    const presetName = preset.presetName || 'Preset';
    if (preset.autoApply === false) {
      report({ presetName, applied: false, autoApply: false, hardwareApplied: [], software: false });
      return stream;
    }

    const settings = preset.settings;
    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) return stream;
    const track = videoTracks[0];

    // Kamera diganti / dipanggil ulang: matikan sesi software lama dulu.
    stopSession();

    let hardwareApplied = [];
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      // Jangkar terjemahan persen->native: nilai bawaan native track ini.
      let defaultsNative = {};
      try { defaultsNative = (track.getSettings && track.getSettings()) || {}; } catch (e) { defaultsNative = {}; }
      hardwareApplied = await applyHardwareStepwise(track, buildConstraints(settings, caps, defaultsNative));
    } catch (e) { hardwareApplied = []; }

    // Auto Terbaik: preset sudah diterapkan, sekarang analisis SATU putaran
    // dari gambar nyata dan koreksi. Gagal analisis = preset biasa berlaku.
    const effSettings = Object.assign({}, settings);
    let autoBestInfo;
    if (preset.autoBest === true) {
      let analysis = null;
      try { analysis = await analyzeAutoBest(stream, track, effSettings); } catch (e) { analysis = null; }
      if (analysis) {
        if (analysis.softwareFactor && analysis.softwareFactor !== 1) {
          effSettings._lumaFactor = analysis.softwareFactor;
        }
        if (analysis.exposureCompensation !== null && analysis.exposureCompensation !== undefined &&
            !hardwareApplied.includes('exposureCompensation')) {
          hardwareApplied.push('exposureCompensation');
        }
        autoBestInfo = { meanLuma: analysis.meanLuma, correction: analysis.correction };
      } else {
        autoBestInfo = { meanLuma: null, correction: 'analisis tidak tersedia — preset diterapkan apa adanya' };
      }
    }

    const useSoftware = preset.softwareMode === true || settings.softwareMode === true;
    if (useSoftware) {
      try {
        const wrapped = await wrapSoftware(stream, track, effSettings);
        report({ presetName, applied: true, hardwareApplied, software: true, autoBest: autoBestInfo });
        return wrapped;
      } catch (e) {
        // Jalur software gagal: Meet tetap dapat stream asli + hardware.
        report({ presetName, applied: hardwareApplied.length > 0, hardwareApplied, software: false, softwareFailed: true, autoBest: autoBestInfo });
        return stream;
      }
    }

    report({ presetName, applied: true, hardwareApplied, software: false, autoBest: autoBestInfo });
    return stream;
  };
})();
