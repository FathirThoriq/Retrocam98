# RetroCam 98

**Pengatur kamera lengkap untuk meeting di browser.**

Setting kamera bawaan sistem operasi dan Google Meet sangat terbatas — gambar
terlalu gelap, pucat, silau, atau warnanya meleset, padahal umumnya hanya perlu
diatur dulu sebelum dipakai. RetroCam 98 adalah ekstensi Chrome & Brave yang
menambahkan kontrol kamera lengkap langsung dari browser: brightness, contrast,
saturation, exposure, white balance, fokus, zoom, dan preset — khusus untuk
meeting di browser, dengan target utama Google Meet.

Tampilannya bertema retro camcorder era 90-an: OSD REC dan stempel tanggal di
pratinjau, panel ber-bevel, label monospace — dengan palet warna sage, taupe,
dan krem:

`#d3c4bb` `#737460` `#a19885` `#b8aea0` `#80866e` `#3e4a3f` `#222229`
`#ebe1e6` `#232f2f` `#5e6d58` `#aaa3a4` `#7b7975`

Versi saat ini: **0.2.1** · Lisensi: MIT

## Fitur

- **Studio (side panel)** — pratinjau kamera besar ber-OSD camcorder (REC,
  timecode berjalan, stempel tanggal, bracket viewfinder), kontrol digrupkan
  dalam tab: Gambar, Cahaya & Warna, Fokus & Bingkai, Format.
- **Dua jalur penerapan**
  - *Jalur hardware* — memakai `getCapabilities()` + `applyConstraints()`.
    Slider hanya aktif untuk kontrol yang benar-benar diekspos kamera/driver,
    dengan rentang asli dari kamera itu. Penerapan dilakukan bertahap dan
    statusnya dilaporkan apa adanya: kontrol mana yang berhasil dan mana
    yang gagal.
  - *Mode Software* — untuk kontrol yang tidak diekspos driver: gambar
    diproses lewat canvas (`captureStream`, maks. 720p / 30 fps) termasuk
    zoom digital, pan/tilt crop, dan mirror. Audio tidak disentuh.
- **Auto Terbaik** — satu tombol menganalisis gambar kameramu sendiri
  (kecerahan, clipping, cast warna, kontras, saturasi, ketajaman) lalu
  menerapkan setting terbaik untuk kondisi itu, maksimal 2 putaran ukur-ulang,
  termasuk sapuan fokus bila hardware mendukung. Hasilnya tersimpan per kamera.
- **Preset** — 5 bawaan (Default Kamera, Ruangan Gelap, Silau / Backlight,
  Warna Pucat, Tajam Maksimal) plus preset kustom tanpa batas. Tersimpan
  otomatis per kamera (per `deviceId`).
- **Terapkan otomatis di Google Meet** — preset aktif diterapkan ke kamera
  Meet lewat injeksi `getUserMedia`, dan lencana kecil di halaman Meet
  menunjukkan statusnya secara jujur: "RETROCAM 98 AKTIF — [preset]" atau
  "RETROCAM 98 TIDAK DITERAPKAN".
- **Popup ringkas** — ganti preset cepat, pratinjau mini, tombol Auto Terbaik,
  dan tombol Buka Studio.
- **Reset** — mengembalikan pengaturan ke nilai awal kamera saat pertama
  dinyalakan dari Studio.

## Cara pasang

Ekstensi ini dipasang manual lewat **Load unpacked** (belum tersedia di
Chrome Web Store):

1. Unduh repo ini: tombol hijau **Code → Download ZIP**, lalu ekstrak —
   atau `git clone https://github.com/FathirThoriq/Retrocam98.git`
2. Di Chrome buka `chrome://extensions`, di Brave buka `brave://extensions`
3. Nyalakan **Developer mode** (kanan atas)
4. Klik **Load unpacked**, pilih folder hasil ekstrak/clone repo ini
   (folder yang berisi `manifest.json`)

## Cara pakai

1. Klik ikon RetroCam 98 → **Buka Studio** (side panel terbuka).
2. Di Studio, tekan **Aktifkan Kamera** (izin kamera hanya diminta setelah
   tombol ini ditekan), lalu geser slider, pilih preset, atau jalankan
   **AUTO — CARI SETTING TERBAIK**. Pengaturan tersimpan otomatis per kamera.
3. Pastikan toggle **Terapkan Otomatis di Google Meet** menyala.
4. Buka / muat ulang tab Google Meet dan nyalakan kamera seperti biasa —
   presetmu diterapkan, dan lencana RetroCam 98 di pojok halaman Meet
   melaporkan hasilnya.
5. Kamera sudah menyala di Meet sebelum ekstensi siap? Matikan-nyalakan
   kamera di Meet, atau muat ulang tabnya.

## Cara kerja

Arsitektur Manifest V3, vanilla JavaScript, tanpa proses build:

```
Popup ───────────────► chrome.storage.local (preset per deviceId)
Side Panel "Studio" ─► kontrol lengkap + pratinjau live + analisis Auto
Background (service worker) ─► koordinasi tab Meet
Content script (ISOLATED) ───► teruskan preset ke halaman + lencana status
Script injeksi (MAIN world) ─► override getUserMedia di tab Meet:
                               terapkan constraints hardware, dan bila
                               Mode Software menyala, bungkus track
                               lewat canvas (video olahan + audio asli)
```

Nilai setting internal berskala persen (100 = netral) dan diterjemahkan ke
skala native driver kamera berjangkar nilai bawaan kamera itu sendiri —
rentang dan kemampuan selalu dibaca dari `getCapabilities()` kamera yang
sedang aktif, bukan angka tebak.

## Batasan (jujur)

- **Hanya di browser.** Ekstensi ini tidak mengubah kamera untuk aplikasi
  di luar browser (Zoom desktop, OBS, dll.) dan tidak memasang driver apa pun.
- **Kontrol hardware tergantung kamera dan driver.** Bila driver tidak
  mengekspos suatu kontrol, slidernya nonaktif dan UI menyebutkan alasannya;
  Mode Software adalah jalan keluarnya.
- **Mode Software maks. 720p / 30 fps** demi performa.
- Auto Terbaik memperbaiki exposure, warna, kontras, dan ketajaman
  pengolahan — ia tidak bisa menaikkan resolusi sensor dan tidak bisa
  menciptakan fokus optik pada kamera fokus-tetap.
- Perilaku per sistem berbeda: Windows biasanya paling lengkap, Linux
  tergantung driver, macOS paling terbatas terutama untuk kamera internal.

## Privasi

Semua pemrosesan terjadi lokal di browsermu. Tidak ada server, tidak ada
analitik, tidak ada unggahan frame atau data. Preset hanya disimpan di
`chrome.storage.local` pada perangkatmu sendiri.

## Struktur file

```
manifest.json          Manifest V3
core.js                Logika murni: preset, constraints, filter CSS,
                       analisis frame & rekomendasi Auto Terbaik
background.js          Service worker: side panel + pemberitahuan tab Meet
studio.html/css/js     Studio (side panel / tab) — kontrol lengkap
popup.html/css/js      Popup ringkas
bridge.js              Content script ISOLATED di Meet: preset + lencana
inject-main.js         Script MAIN di Meet: override getUserMedia
icons/                 Ikon 16/48/128
```

## Catatan perubahan

### v0.2.1
Perbaikan bug skala native dari v0.2.0: nilai persen kini diterjemahkan ke
skala native berjangkar nilai bawaan kamera (di v0.2.0 nilai persen sempat
diterapkan mentah sebagai nilai native driver sehingga warna bisa anjlok).
Slider diinisialisasi dari kondisi asli kamera, AUTO mendapat pagar pengaman
saturasi, dan statistik AUTO diukur dari area tengah frame (objek).

### v0.2.0
Fitur **Auto Terbaik**: analisis frame + rekomendasi setting otomatis
(maks. 2 putaran, sapuan fokus bila hardware mendukung).

### v0.1.0
Rilis pertama: Studio side panel, preset per kamera, injeksi Google Meet,
dan Mode Software (canvas).

## Lisensi

MIT — lihat [LICENSE](LICENSE).
