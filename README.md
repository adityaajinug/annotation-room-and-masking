# Room Texture Preview (PoC)

Satu foto ruangan, ganti tekstur permukaan (mis. panel dinding, top island) langsung di browser.
Vanilla HTML + CSS + JavaScript, masking digambar manual dengan [Annotorious](https://annotorious.github.io/).
Detail fitur, kelebihan/kekurangan, dan batas masking: lihat [FEATURES.md](FEATURES.md).

## Menjalankan lewat VS Code

> Project **harus** dibuka lewat server lokal. Membuka `index.html` langsung (`file://`) akan gagal
> karena `fetch` JSON dan `getImageData` diblokir browser.

### Cara 1 — Live Server (disarankan)
1. Install [Visual Studio Code](https://code.visualstudio.com/).
2. Buka folder project: **File → Open Folder…** → pilih folder `room-test`.
3. Buka tab **Extensions** (`Ctrl+Shift+X`), cari **Live Server** (Ritwick Dey), klik **Install**.
4. Klik kanan `index.html` di Explorer → **Open with Live Server**
   (atau klik **Go Live** di pojok kanan bawah VS Code).
5. Browser terbuka di `http://127.0.0.1:5500/index.html`.

| Halaman | URL |
|---|---|
| Viewer | `http://127.0.0.1:5500/index.html` |
| Admin (masking) | `http://127.0.0.1:5500/admin.html` |
| Viewer memakai draft dari admin | `http://127.0.0.1:5500/index.html?draft=1` |

> Admin tidak ditautkan dari viewer; buka URL-nya langsung.
> Admin memuat Annotorious dari CDN, jadi butuh koneksi internet.

### Cara 2 — Terminal VS Code (tanpa extension)
Buka terminal (`` Ctrl+` ``) di folder project, lalu pilih salah satu:

```bash
npx serve .            # Node.js, buka alamat yang ditampilkan
# atau
python -m http.server 8080   # lalu buka http://localhost:8080
```

## Cara memakai

### Viewer
1. Pilih surface (mis. **Wall panel** / **Island top**) di panel kiri atau klik pin pada foto.
2. Klik produk (Texture 1 / Texture 2) → tekstur langsung berganti.
3. **Adjust texture**: ukuran tile, rotasi, offset, kekuatan pencahayaan.
4. **Compare** (slider sebelum/sesudah), **Reset**, **Download** (PNG resolusi asli).

### Admin (masking)
1. Pilih **Surface** di kiri atas.
2. **Include** = area yang akan berubah. Klik titik-titik mengelilingi area, tutup dengan klik titik pertama atau double-click.
3. **Exclude** = lubang yang tetap foto asli (makanan, kran, dll.). Gambar di dalam/di tepi area Include.
4. Permukaan miring (counter/lantai): menu **More → Auto perspective**, lalu geser titik sudutnya bila perlu.
5. **Test texture** (checkerboard untuk cek tepi) atau pilih produk lalu **Preview** (sama seperti viewer).
6. Perubahan tersimpan otomatis sebagai draft di browser. Lihat hasilnya lewat **More → Open viewer**.

Salah gambar?
`Esc` batalkan shape yang sedang digambar · `Ctrl+Z` / `Ctrl+Y` undo/redo ·
klik shape lalu `Delete` · geser titik shape yang dipilih · **More → Clear surface**.

Shortcut: `1` Include, `2` Exclude, `3` Perspective.

### Memindahkan hasil masking ke data permanen
Tombol Save sementara dihapus. Untuk menjadikan hasil admin permanen:
1. Admin → **More → Export JSON** (mengunduh `surfaces.json`).
2. Salin isi `polygons` tiap surface ke `data/rooms.json` pada surface yang sama.
3. Refresh viewer.

## Struktur project

```
index.html            viewer
admin.html            alat masking (Annotorious)
css/style.css
js/app.js             logika viewer (surface, produk, compare, download)
js/render.js          shade map + render tekstur (flat & perspektif)
js/mask.js            polygon -> mask, feather
js/admin.js           editor polygon (tag include/exclude/perspective)
data/rooms.json       foto, surface, polygon
data/products.json    daftar produk/tekstur
assets/room.jpg       foto dasar
assets/textures/      texture-1.jpg, texture-2.jpg
server.py             contoh backend save (opsional, tidak dipakai admin saat ini)
PRD.MD                requirement awal
```

## Menambah produk / surface / ruangan

- **Produk baru**: taruh gambar di `assets/textures/`, tambahkan entri di `data/products.json`
  (`id`, `name`, `texture`, `surfaceTypes`, `tileWidthPx`, ...). Tidak perlu ubah kode.
  `surfaceTypes` harus cocok dengan `type` surface (mis. `"wall"`, `"counter"`).
- **Surface baru**: tambahkan entri di `surfaces` pada `data/rooms.json` (polygon bisa kosong
  `[]`, lalu digambar di admin).
  - `planeAspect`: rasio lebar:kedalaman bidang asli untuk surface perspektif (mis. top meja ~3.5).
  - `feather`, `shadeBlur`, `shadeStrength`: kehalusan tepi dan pencahayaan.
- **Foto baru**: ganti `assets/room.jpg` (dan `image` di `rooms.json`), lalu gambar ulang mask.

## Troubleshooting

| Masalah | Penyebab / solusi |
|---|---|
| Halaman kosong / "Error … run via a local static server" | Dibuka lewat `file://`. Pakai Live Server atau `npx serve`. |
| Admin tidak menampilkan alat gambar | Tidak ada internet (Annotorious dari CDN). |
| Polygon admin aneh / tidak sesuai | Draft lama di browser. Konsol browser: `localStorage.removeItem('room-mask-draft')` lalu refresh. |
| Perubahan JSON tidak terlihat | Hard refresh (`Ctrl+F5`); jika memakai `?draft=1`, draft browser lebih diutamakan dari `rooms.json`. |
| Tekstur terlihat bergaris pada top meja | Efek sudut kamera hampir sejajar. Sesuaikan `planeAspect` atau Tile size. |
| Ada tepi kotak di sekitar objek | Polygon Exclude terlalu kasar. Gambar ulang dengan lebih banyak titik. |
