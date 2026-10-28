# Data model (rekomendasi untuk backend)

Dokumen ini menjelaskan data apa yang perlu disimpan, dan yang sebaiknya tidak disimpan, saat `admin-2` / `view-2`
dipindah dari penyimpanan browser (IndexedDB) ke backend. Format yang ada sekarang (Export JSON) dijelaskan di bagian
paling bawah.

## Prinsip

1. Simpan hal yang diedit manusia. Jangan simpan hasil hitungan.
2. File biner (foto, tekstur) disimpan sebagai file di object storage dan dirujuk lewat URL/ID. Jangan base64 di dalam JSON.
3. Koordinat shape tetap ternormalisasi (0 sampai 1) terhadap foto, supaya shape tetap pas walau foto diganti dengan
   resolusi lain.
4. Ukuran pola dinyatakan dalam cm (`tileCm`, `realWidthCm`), bukan piksel, karena piksel bergantung pada resolusi foto.

## Entitas

| Entitas | Field | Catatan |
|---|---|---|
| **Project** (satu ruangan) | `id`, `name`, `schemaVersion`, `status` (`draft` / `published`), `revision`, `ownerId`, `createdAt`, `updatedAt` | `revision` naik tiap simpan, dipakai untuk mencegah dua admin saling menimpa (optimistic locking) |
| **Photo** | `asset` (URL / ID file), `width`, `height`, `hash` | Foto yang dipakai admin dibatasi 2000 px sisi terpanjang. Simpan versi itu. Aslinya boleh disimpan terpisah |
| **Surface** | `id`, `label`, `pin [x, y]`, `realWidthCm`, `planeAspect`, `textureIds`, `look`, `shapes` | `textureIds` kosong/tidak ada = semua tekstur diizinkan. `pin` boleh `null` (default ke tengah shape Include) |
| **Surface.look** | `feather`, `shadeBlur`, `shade`, `detail`, `highlight`, `contact`, `tint` | Semua angka slider per surface. Nilai default ada di `js/render.js` (`look()`) |
| **Shape** (anak surface) | `mode` (`include` / `exclude` / `quad`), `kind` (`path` / `rect` / `ellipse`), `nodes` atau `box` | Lihat bagian Shape di bawah |
| **Texture** | `id`, `name`, `asset`, `width`, `height`, `tileCm`, `tileWidthPx`, `repeat`, `rotation`, `offset [x, y]` | `repeat`: `repeat` / `mirror` / `cover` (fit once). `tileWidthPx` adalah cadangan kalau `tileCm` atau `realWidthCm` kosong |

### Shape

- `nodes`: daftar `{ x, y, ix, iy, ox, oy, smooth }`. `x, y` titik jangkar, `ix, iy` handle kurva masuk, `ox, oy` handle kurva
  keluar (offset dari jangkar, ternormalisasi). Semua handle 0 berarti garis lurus.
- `box`: `[x0, y0, x1, y1]` untuk `rect` dan `ellipse`.
- Source of truth adalah `nodes` / `box`. Poligon `points` (hasil sampling kurva) bisa dihitung ulang, jadi tidak wajib disimpan.
  Viewer saat ini masih membaca `points`, jadi selama belum diubah, simpan juga `points` sebagai cache.
- `quad` harus tepat 4 titik sudut tanpa handle. Maksimal satu `quad` per surface.
- Urutan shape dalam surface dipertahankan. Exclude menimpa Include yang digambar sebelumnya.

## Contoh (format yang disarankan untuk backend)

```json
{
  "schemaVersion": 3,
  "id": "p-123",
  "name": "Kitchen",
  "status": "published",
  "revision": 7,
  "photo": { "asset": "assets/ab12.jpg", "width": 1600, "height": 1000 },
  "surfaces": [
    {
      "id": "s-1",
      "label": "Island top",
      "pin": [0.55, 0.70],
      "realWidthCm": 240,
      "planeAspect": 3.5,
      "textureIds": ["t-1", "t-2"],
      "look": { "feather": 1.5, "shadeBlur": 30, "shade": 0.8, "detail": 0.6, "highlight": 0.5, "contact": 0.35, "tint": 0.5 },
      "shapes": [
        { "mode": "quad", "kind": "path", "nodes": [{ "x": 0.19, "y": 0.71 }, { "x": 1, "y": 0.71 }, { "x": 1, "y": 0.81 }, { "x": 0.08, "y": 0.80 }] },
        { "mode": "include", "kind": "ellipse", "box": [0.1, 0.7, 0.9, 0.85] },
        { "mode": "exclude", "kind": "path", "nodes": [{ "x": 0.6, "y": 0.66, "ix": -0.01, "iy": 0, "ox": 0.01, "oy": 0, "smooth": true }, "..."] }
      ]
    }
  ],
  "textures": [
    { "id": "t-1", "name": "Light quartz", "asset": "assets/cd34.jpg", "width": 800, "height": 400,
      "tileCm": 60, "tileWidthPx": 400, "repeat": "mirror", "rotation": 90, "offset": [40, -25] }
  ]
}
```

## Yang TIDAK perlu disimpan

- Mask hasil render, peta bayangan, hasil preview, dan hasil render lainnya. Semuanya dihitung ulang dari foto dan shape.
- Model AI (SlimSAM) dan embedding hasil analisis foto. Model diunduh dari CDN saat dipakai, embedding dihitung di browser.
- Riwayat undo/redo, posisi zoom, status hints, tool yang sedang aktif. Itu hanya keadaan UI.
- Foto dan tekstur sebagai base64 di dalam JSON.

## Alur yang disarankan

- **Draft dan published.** Admin mengedit draft. Viewer publik membaca snapshot published yang tidak berubah. Publish
  membuat snapshot baru (salinan JSON + referensi file).
- **Optimistic locking.** Simpan dengan `revision` yang terakhir dibaca. Kalau berbeda di server, tolak dan minta muat ulang.
- **File.** Upload foto/tekstur ke object storage, simpan hash isi supaya file yang sama tidak diunggah dua kali.
- **Analitik (opsional).** Event pengunjung (surface dan tekstur yang dipilih, waktu) disimpan di tabel terpisah, bukan di
  dalam project.

## Format yang dipakai sekarang (Export JSON)

Dibuat oleh `More -> Export JSON` di `admin-2.html`, dan dibaca dari `data/project.json` kalau browser belum punya data.

```json
{
  "version": 2,
  "image": "data:image/jpeg;base64,...",
  "surfaces": [
    {
      "id": "s-1", "label": "Island top", "pin": [0.55, 0.70],
      "polygons": [
        { "mode": "include", "points": [[0.1, 0.7], [0.9, 0.7], [0.9, 0.85], [0.1, 0.85]] },
        { "mode": "include", "points": ["... 80 titik hasil sampling"], "shape": "ellipse", "box": [0.1, 0.7, 0.9, 0.85] },
        { "mode": "exclude", "points": ["..."], "nodes": [{ "x": 0.6, "y": 0.66, "ix": -0.01, "iy": 0, "ox": 0.01, "oy": 0, "smooth": true }] }
      ],
      "feather": 1.5, "shadeBlur": 30, "shadeStrength": 0.8,
      "detailStrength": 0.6, "highlightStrength": 0.5, "contactShadow": 0.35, "tintStrength": 0.5,
      "planeAspect": 3.5, "realWidthCm": 240, "textureIds": ["t-1"]
    }
  ],
  "textures": [
    { "id": "t-1", "name": "Light quartz", "src": "data:image/jpeg;base64,...",
      "tileWidthPx": 400, "tileCm": 60, "repeat": "mirror", "rotation": 90, "offset": [40, -25] }
  ]
}
```

Pemetaan ke format backend:

| Sekarang | Backend |
|---|---|
| `version` | `schemaVersion` |
| `image` (data URL) | `photo.asset` + `photo.width/height` |
| `surfaces[].polygons[]` | `surfaces[].shapes[]` (`shape` menjadi `kind`, polygon biasa menjadi `kind: "path"` dengan node tanpa handle) |
| `shadeStrength`, `detailStrength`, `highlightStrength`, `contactShadow`, `tintStrength`, `feather`, `shadeBlur` | `surfaces[].look` (`shade`, `detail`, `highlight`, `contact`, `tint`, `feather`, `shadeBlur`) |
| `textures[].src` (data URL) | `textures[].asset` + `width/height` |

Field yang tidak ada (`planeAspect`, `realWidthCm`, `textureIds`, `tileCm`, `repeat`, `pin`) boleh kosong, dan renderer
memakai default-nya.
