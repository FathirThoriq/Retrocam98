'use strict';
/*
 * RetroCam 98 — logika murni (tanpa DOM / tanpa chrome API).
 * Dipakai oleh studio, popup, dan teruji lewat Node (UMD).
 */
(function (root, factory) {
  const api = factory();
  root.RetroCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const DEFAULT_SETTINGS = Object.freeze({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    sharpness: 100,
    gamma: 100,
    hue: 0,
    exposureMode: 'auto',
    exposureCompensation: 0,
    colorTemperature: 4500,
    whiteBalanceMode: 'auto',
    gain: 0,
    focusMode: 'auto',
    focusDistance: 0,
    zoom: 100,
    pan: 0,
    tilt: 0,
    mirror: false,
    softwareMode: false,
    autoApply: true
  });

  function preset(id, name, overrides) {
    return { id, name, settings: Object.assign({}, DEFAULT_SETTINGS, overrides) };
  }

  const BUILTIN_PRESETS = Object.freeze([
    preset('default', 'Default Kamera', {}),
    preset('ruangan-gelap', 'Ruangan Gelap', {
      brightness: 138, gamma: 135, gain: 12, exposureCompensation: 1.0, contrast: 106
    }),
    preset('silau-backlight', 'Silau / Backlight', {
      brightness: 92, exposureCompensation: -1.2, contrast: 112, saturation: 106, gamma: 94
    }),
    preset('warna-pucat', 'Warna Pucat', {
      saturation: 142, contrast: 110, colorTemperature: 4300, brightness: 104
    }),
    preset('tajam-maksimal', 'Tajam Maksimal', {
      sharpness: 170, contrast: 118, saturation: 108, brightness: 102
    })
  ]);

  const MEET_KEY = 'rc98:meetPreset';
  const ACTIVE_KEY = 'rc98:active';
  const CUSTOM_KEY = 'rc98:customPresets';

  function storageKeyForDevice(deviceId) {
    return 'rc98:device:' + (deviceId ? String(deviceId) : 'default');
  }

  /*
   * Sesuaikan nilai dengan capability kamera {min, max, step}.
   * Capability berbentuk array (enum/mode) dikembalikan apa adanya bila cocok.
   */
  function clampToCapability(value, cap) {
    if (cap == null) return value;
    if (Array.isArray(cap)) return cap.includes(value) ? value : value;
    if (typeof cap === 'object') {
      let v = Number(value);
      if (Number.isNaN(v)) return value;
      if (typeof cap.min === 'number') v = Math.max(cap.min, v);
      if (typeof cap.max === 'number') v = Math.min(cap.max, v);
      if (typeof cap.step === 'number' && cap.step > 0) {
        const base = typeof cap.min === 'number' ? cap.min : 0;
        v = base + Math.round((v - base) / cap.step) * cap.step;
        if (typeof cap.min === 'number') v = Math.max(cap.min, v);
        if (typeof cap.max === 'number') v = Math.min(cap.max, v);
        v = Math.round(v * 1e6) / 1e6;
      }
      return v;
    }
    return value;
  }

  function modeAllowed(mode, cap) {
    if (Array.isArray(cap)) return cap.includes(mode);
    return true;
  }

  /*
   * Kontrol multiplikatif berskala PERSEN di settings kita
   * (100 = netral = kondisi bawaan kamera). Capability Chromium
   * mengembalikan rentang NATIVE driver (mis. 0-255 dengan bawaan 128),
   * jadi nilai persen TIDAK BOLEH diteruskan mentah sebagai nilai native
   * (bug v0.2.0: saturation 100 diterapkan sebagai native 100 dari 255
   * sehingga warna anjlok nyaris grayscale). Kontrol-kontrol ini wajib
   * diterjemahkan berjangkar nilai bawaan native kamera (getSettings).
   */
  const MULT_KEYS = Object.freeze(['brightness', 'contrast', 'saturation', 'sharpness']);

  function isRangeCap(cap) {
    return !!cap && typeof cap === 'object' && !Array.isArray(cap) &&
      (typeof cap.min === 'number' || typeof cap.max === 'number');
  }

  /*
   * Persen -> native. Jangkar utama: nilai bawaan native kamera
   * (defaultNative dari getSettings) — persen 100 berarti nilai bawaan
   * itu sendiri. Tanpa jangkar valid, persen 0-200 dipetakan linear ke
   * rentang capability (100 -> tengah rentang).
   */
  function percentToNative(pct, cap, defaultNative) {
    if (!isRangeCap(cap)) return pct;
    const p = Number(pct);
    if (Number.isNaN(p)) return pct;
    const d = Number(defaultNative);
    if (Number.isFinite(d) && (typeof cap.min !== 'number' || d > cap.min)) {
      return clampToCapability(d * (p / 100), cap);
    }
    if (typeof cap.min === 'number' && typeof cap.max === 'number') {
      return clampToCapability(cap.min + (p / 200) * (cap.max - cap.min), cap);
    }
    return clampToCapability(p, cap);
  }

  /* Kebalikan percentToNative: native -> persen (dibulatkan). */
  function nativeToPercent(native, cap, defaultNative) {
    if (!isRangeCap(cap)) return native;
    const v = Number(native);
    if (Number.isNaN(v)) return native;
    const d = Number(defaultNative);
    if (Number.isFinite(d) && d > 0) {
      return Math.round((v / d) * 100);
    }
    if (typeof cap.min === 'number' && typeof cap.max === 'number' && cap.max > cap.min) {
      return Math.round(((v - cap.min) / (cap.max - cap.min)) * 200);
    }
    return Math.round(v);
  }

  /*
   * Bangun array `advanced` untuk applyConstraints, HANYA berisi kontrol
   * yang benar-benar ada di capabilities track. Mengembalikan array objek
   * satu-kunci, mis. [{brightness: 120}, {exposureMode: 'manual'}].
   * defaultsNative (opsional): nilai bawaan native per-kunci dari
   * getSettings() track — jangkar terjemahan kontrol persen (MULT_KEYS).
   * Kontrol satuan-asli (EV, Kelvin, derajat, dll.) tetap di-clamp
   * langsung seperti sebelumnya.
   */
  function buildConstraints(settings, capabilities, defaultsNative) {
    const out = [];
    if (!settings || !capabilities || typeof capabilities !== 'object') return out;
    const has = (k) => Object.prototype.hasOwnProperty.call(capabilities, k);
    const pushRange = (key, settingsKey) => {
      if (has(key)) out.push({ [key]: clampToCapability(settings[settingsKey ?? key], capabilities[key]) });
    };
    const pushMult = (key) => {
      if (has(key)) {
        out.push({
          [key]: percentToNative(
            settings[key], capabilities[key],
            defaultsNative ? defaultsNative[key] : undefined)
        });
      }
    };

    pushMult('brightness');
    pushMult('contrast');
    pushMult('saturation');
    pushMult('sharpness');
    pushRange('hue');

    if (has('exposureMode') && modeAllowed(settings.exposureMode, capabilities.exposureMode)) {
      out.push({ exposureMode: settings.exposureMode });
    }
    pushRange('exposureCompensation');

    if (has('whiteBalanceMode') && modeAllowed(settings.whiteBalanceMode, capabilities.whiteBalanceMode)) {
      out.push({ whiteBalanceMode: settings.whiteBalanceMode });
    }
    // Temperatur warna hanya bermakna saat white balance manual.
    if (settings.whiteBalanceMode === 'manual') pushRange('colorTemperature');

    // Gain: pakai kunci 'gain' bila diekspos kamera; selain itu dilewati
    // (tidak diganti iso karena satuan & perilakunya berbeda per driver).
    pushRange('gain');

    if (has('focusMode') && modeAllowed(settings.focusMode, capabilities.focusMode)) {
      const fm = settings.focusMode === 'auto' ? settings.focusMode : settings.focusMode;
      out.push({ focusMode: fm });
    }
    // Jarak fokus hanya bermakna saat fokus manual.
    if (settings.focusMode === 'manual') pushRange('focusDistance');

    pushRange('zoom');
    pushRange('pan');
    pushRange('tilt');
    return out;
  }

  /*
   * Filter CSS untuk jalur software.
   * Pendekatan gamma: CSS tidak punya gamma(), jadi gamma didekati dengan
   * mengalikan faktor brightness keseluruhan dengan rasio gamma
   * (gamma 135 -> brightness x1.35). Ini bukan gamma correction sejati,
   * tapi perubahan terang yang searah dan terasa di gambar.
   * Sharpness & gain tidak punya padanan CSS dan sengaja tidak dipalsukan.
   */
  function buildCssFilter(settings) {
    if (!settings) return 'none';
    const parts = [];
    const gammaRatio = (settings.gamma ?? 100) / 100;
    const bright = ((settings.brightness ?? 100) / 100) * gammaRatio;
    const contrast = (settings.contrast ?? 100) / 100;
    const saturate = (settings.saturation ?? 100) / 100;
    const hue = settings.hue ?? 0;
    if (bright !== 1) parts.push('brightness(' + trimNum(bright) + ')');
    if (contrast !== 1) parts.push('contrast(' + trimNum(contrast) + ')');
    if (saturate !== 1) parts.push('saturate(' + trimNum(saturate) + ')');
    if (hue !== 0) parts.push('hue-rotate(' + trimNum(hue) + 'deg)');
    return parts.length ? parts.join(' ') : 'none';
  }

  function trimNum(n) {
    return String(Math.round(n * 10000) / 10000);
  }

  function cloneSettings(s) {
    return Object.assign({}, DEFAULT_SETTINGS, s || {});
  }

  // ---------- AUTO: analisis frame + rekomendasi setting terbaik ----------

  // Target kecerahan rata-rata frame (skala luma 0-255) untuk wajah/objek
  // yang terekspos baik di kamera meeting pada umumnya.
  const TARGET_LUMA = Object.freeze({ min: 118, max: 138 });

  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;

  /*
   * Statistik satu frame dari data RGBA (pemanggil men-downscale dulu,
   * mis. ke 160x120, supaya murah). width/height dipakai untuk energi
   * gradien ketajaman (rata-rata |selisih luma tetangga horizontal|).
   */
  function computeFrameStats(pixels, width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    const total = w * h;
    if (!pixels || !total || pixels.length < total * 4) {
      return {
        meanLuma: 0, whiteClipPct: 0, blackClipPct: 0,
        meanR: 0, meanG: 0, meanB: 0, castRatio: 1,
        saturationMean: 0, contrastSpan: 0, sharpness: 0,
        width: w, height: h, pixelCount: 0
      };
    }
    const luma = new Float32Array(total);
    const hist = new Uint32Array(256);
    let sumL = 0, sumR = 0, sumG = 0, sumB = 0, sumS = 0;
    let white = 0, black = 0;
    for (let i = 0; i < total; i++) {
      const o = i * 4;
      const R = pixels[o], G = pixels[o + 1], B = pixels[o + 2];
      const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      luma[i] = L;
      sumL += L; sumR += R; sumG += G; sumB += B;
      const li = L < 0 ? 0 : L > 255 ? 255 : Math.round(L);
      hist[li]++;
      if (L > 245) white++;
      if (L < 10) black++;
      const mx = Math.max(R, G, B);
      const mn = Math.min(R, G, B);
      sumS += mx === 0 ? 0 : (mx - mn) / mx;
    }
    // Rentang kontras dari histogram: persentil 95 - persentil 5.
    const pct = (p) => {
      const need = total * p;
      let cum = 0;
      for (let v = 0; v < 256; v++) {
        cum += hist[v];
        if (cum >= need) return v;
      }
      return 255;
    };
    // Energi gradien horizontal sebagai proksi ketajaman relatif.
    let gSum = 0, gCount = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 1; x < w; x++) {
        gSum += Math.abs(luma[row + x] - luma[row + x - 1]);
        gCount++;
      }
    }
    const meanR = sumR / total, meanG = sumG / total, meanB = sumB / total;
    const cMax = Math.max(meanR, meanG, meanB);
    const cMin = Math.min(meanR, meanG, meanB);
    return {
      meanLuma: r2(sumL / total),
      whiteClipPct: r2((white / total) * 100),
      blackClipPct: r2((black / total) * 100),
      meanR: r2(meanR), meanG: r2(meanG), meanB: r2(meanB),
      castRatio: cMin > 0 ? r3(cMax / cMin) : (cMax > 0 ? Infinity : 1),
      saturationMean: Math.round((sumS / total) * 10000) / 10000,
      contrastSpan: pct(0.95) - pct(0.05),
      sharpness: gCount ? r2(gSum / gCount) : 0,
      width: w, height: h, pixelCount: total
    };
  }

  /*
   * Rekomendasi setting dari statistik frame.
   * Mengembalikan {patch, reasons[]}: patch hanya memuat kunci yang berubah.
   * Kunci hardware murni (exposureCompensation, colorTemperature, focusMode)
   * hanya masuk patch bila diekspos capabilities; kunci dwi-jalur
   * (brightness/contrast/saturation/sharpness/gamma/gain) selalu boleh
   * karena bisa dipikul jalur software.
   */
  function recommendSettings(stats, capabilities, current) {
    const s = stats || {};
    const caps = capabilities || {};
    const cur = cloneSettings(current);
    const patch = {};
    const reasons = [];
    const has = (k) => Object.prototype.hasOwnProperty.call(caps, k);
    const mean = typeof s.meanLuma === 'number' ? s.meanLuma : 128;
    const clip = typeof s.whiteClipPct === 'number' ? s.whiteClipPct : 0;
    const roundEv = (v) => Math.round(v * 2) / 2;
    const applyEv = (delta, why) => {
      if (!has('exposureCompensation')) return false;
      let target = roundEv((cur.exposureCompensation || 0) + delta);
      target = clampToCapability(target, caps.exposureCompensation);
      if (target !== (cur.exposureCompensation || 0)) {
        patch.exposureCompensation = target;
        reasons.push(why + ' Exposure compensation diatur ke ' +
          (target > 0 ? '+' : '') + target.toFixed(1) + ' EV.');
        return true;
      }
      return false;
    };

    // --- Kecerahan / exposure ---
    if (mean > 165 || clip > 12) {
      let delta;
      if (mean >= 210 || clip >= 30) delta = -2.0;
      else if (mean >= 185 || clip >= 20) delta = -1.5;
      else delta = -1.0;
      const why = 'Gambar terlalu terang (kecerahan rata-rata ' + Math.round(mean) +
        ', area putih meledak ' + Math.round(clip) + '%).';
      if (!applyEv(delta, why)) {
        reasons.push(why + ' Kontrol exposure hardware tidak tersedia, jadi koreksi dipikul brightness/gain.');
      }
      if ((cur.brightness || 100) > 85) {
        patch.brightness = 85;
        reasons.push('Brightness diturunkan ke 85 agar area putih tidak makin meledak.');
      }
      if ((cur.gain || 0) > 0) {
        patch.gain = 0;
        reasons.push('Gain dikembalikan ke 0 karena gambar sudah terlalu terang.');
      }
    } else if (mean >= 145) {
      let pushed = applyEv(-0.5, 'Gambar agak terlalu terang (kecerahan rata-rata ' + Math.round(mean) + ').');
      if ((cur.brightness || 100) > 95) {
        patch.brightness = 95;
        reasons.push('Brightness diturunkan ke 95.');
        pushed = true;
      }
      if (!pushed) {
        reasons.push('Gambar agak terlalu terang (kecerahan rata-rata ' + Math.round(mean) +
          '), tetapi kontrol exposure hardware tidak tersedia dan brightness sudah rendah — koreksi terbatas.');
      }
    } else if (mean < 70) {
      const delta = mean < 50 ? 1.5 : 1.0;
      const why = 'Gambar terlalu gelap (kecerahan rata-rata ' + Math.round(mean) + ').';
      if (!applyEv(delta, why)) {
        reasons.push(why + ' Kontrol exposure hardware tidak tersedia, jadi koreksi dipikul brightness/gamma/gain.');
      }
      patch.brightness = 115;
      patch.gamma = 120;
      patch.gain = Math.min(18, Math.max(cur.gain || 0, mean < 50 ? 18 : 12));
      reasons.push('Brightness 115, gamma 120, dan gain ' + patch.gain + ' untuk mengangkat gambar gelap.');
    } else if (mean < 95) {
      applyEv(0.5, 'Gambar agak gelap (kecerahan rata-rata ' + Math.round(mean) + ').');
      patch.brightness = 108;
      patch.gamma = 110;
      reasons.push('Brightness 108 dan gamma 110 untuk mencerahkan gambar.');
    }

    // --- Cast warna ---
    const cast = typeof s.castRatio === 'number' ? s.castRatio : 1;
    if (cast > 1.25) {
      const mR = s.meanR || 0, mG = s.meanG || 0, mB = s.meanB || 0;
      const shift = cast >= 1.5 ? 1000 : 600;
      if (mR >= mG && mR >= mB) {
        // Cast hangat (merah dominan): turunkan suhu menuju netral.
        if (has('colorTemperature')) {
          patch.whiteBalanceMode = 'manual';
          patch.colorTemperature = Math.round(
            clampToCapability((cur.colorTemperature || 4500) - shift, caps.colorTemperature) / 50) * 50;
          reasons.push('Cast warna hangat terdeteksi (kanal merah dominan, rasio ' + cast +
            ') — suhu warna diturunkan ke ' + patch.colorTemperature + ' K dengan white balance manual.');
        } else {
          reasons.push('Cast warna hangat terdeteksi (kanal merah dominan, rasio ' + cast +
            '), tetapi koreksi suhu warna memerlukan kontrol hardware yang tidak tersedia di kamera ini.');
        }
      } else if (mB >= mR && mB >= mG) {
        // Cast dingin (biru dominan): naikkan suhu menuju netral.
        if (has('colorTemperature')) {
          patch.whiteBalanceMode = 'manual';
          patch.colorTemperature = Math.round(
            clampToCapability((cur.colorTemperature || 4500) + shift, caps.colorTemperature) / 50) * 50;
          reasons.push('Cast warna dingin terdeteksi (kanal biru dominan, rasio ' + cast +
            ') — suhu warna dinaikkan ke ' + patch.colorTemperature + ' K dengan white balance manual.');
        } else {
          reasons.push('Cast warna dingin terdeteksi (kanal biru dominan, rasio ' + cast +
            '), tetapi koreksi suhu warna memerlukan kontrol hardware yang tidak tersedia di kamera ini.');
        }
      } else {
        reasons.push('Cast warna hijau terdeteksi (rasio kanal ' + cast +
          ') — suhu warna bukan koreksi yang tepat untuk cast ini, jadi tidak diubah otomatis.');
      }
    }

    // --- Kontras ---
    const span = typeof s.contrastSpan === 'number' ? s.contrastSpan : 255;
    if (span < 90 && clip < 8) {
      const target = span < 50 ? 122 : span < 70 ? 118 : 112;
      if (target > (cur.contrast || 100)) {
        patch.contrast = target;
        reasons.push('Rentang kontras sempit (' + Math.round(span) + ') — contrast dinaikkan ke ' + target + ' agar objek lebih tegas.');
      }
    }

    // --- Saturasi ---
    const sat = typeof s.saturationMean === 'number' ? s.saturationMean : 0.3;
    if (sat < 0.18 && clip < 10) {
      const target = sat < 0.10 ? 128 : 118;
      if (target > (cur.saturation || 100)) {
        patch.saturation = target;
        reasons.push('Warna pudar (saturasi rata-rata ' + sat + ') — saturation dinaikkan ke ' + target + '.');
      }
    } else if (sat > 0.45 && (cur.saturation || 100) > 92) {
      patch.saturation = 92;
      reasons.push('Warna terlalu jenuh (saturasi rata-rata ' + sat + ') — saturation diturunkan ke 92.');
    }

    // --- Ketajaman / noise ---
    const sharp = typeof s.sharpness === 'number' ? s.sharpness : 10;
    if (sharp < 5) {
      // Batas auto 130: di atas itu noise pada gambar berbintik makin kasar.
      patch.sharpness = 115;
      reasons.push('Gambar lunak (ketajaman ' + sharp + ') — sharpness dinaikkan moderat ke 115. ' +
        'Rekomendasi auto tidak pernah menaikkan sharpness di atas 130 karena itu memperkasar noise pada gambar berbintik.');
    } else if (sharp >= 20) {
      reasons.push('Ketajaman/noise sudah tinggi (' + sharp + ') — sharpness tidak dinaikkan agar bintik noise tidak makin kasar.');
    }

    // --- Fokus: utamakan continuous bila hardware mendukung ---
    if (has('focusMode')) {
      const fc = caps.focusMode;
      if (!Array.isArray(fc) || fc.includes('continuous')) {
        if (cur.focusMode !== 'continuous') {
          patch.focusMode = 'continuous';
          reasons.push('Fokus diset ke continuous agar kamera terus mengunci objek secara otomatis.');
        }
      }
    }

    if (!Object.keys(patch).length && !reasons.length) {
      reasons.push('Gambar sudah dalam rentang baik — tidak ada koreksi besar yang diterapkan.');
    } else if (!Object.keys(patch).length) {
      reasons.push('Tidak ada perubahan setting yang diterapkan.');
    }
    return { patch, reasons };
  }


  function findPreset(id) {
    return BUILTIN_PRESETS.find((p) => p.id === id) || null;
  }

  return {
    DEFAULT_SETTINGS,
    BUILTIN_PRESETS,
    MEET_KEY,
    ACTIVE_KEY,
    CUSTOM_KEY,
    storageKeyForDevice,
    clampToCapability,
    MULT_KEYS,
    percentToNative,
    nativeToPercent,
    buildConstraints,
    buildCssFilter,
    cloneSettings,
    findPreset,
    TARGET_LUMA,
    computeFrameStats,
    recommendSettings
  };
});
