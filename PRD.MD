# Room Texture Preview (PoC) — Requirements

Vanilla HTML + CSS + JavaScript. No frameworks, no build step, no AI/ML, no 3D.

---

## 1. Goal

Build a proof-of-concept page where a visitor sees ONE base room photo and can swap the
texture of a marked surface by choosing a product. The client uploads only **one photo**;
every result is generated in the browser on the fly. No pre-rendered image per product.

Reference interaction: a room photo, clickable surface pin, product list on the side,
instant update, Compare / Reset / Download. Use only as a layout reference. Do not copy
any third-party branding.

## 2. Scope

### In scope
- One base photo (`assets/room.jpg`) with one target surface (see 3.2).
- Two texture products that can be swapped onto that surface.
- Admin page to draw the mask polygon by hand (no AI).
- Realistic blending: lighting of the original photo is preserved.
- Compare (before/after), Reset, Download PNG.

### Out of scope (this PoC)
- Visitor photo upload and any automatic surface detection (AI/ML).
- Automatic depth, perspective or room-shape estimation.
- 3D room or 3D product models.
- Automatic color / white-balance matching.
- Backend, database, authentication.

## 3. Assumptions

### 3.1 Inputs
- 1 base photo: `assets/room.jpg` (the kitchen photo provided by the team).
- 2 texture images, separate files: `assets/textures/texture-1.jpg`, `assets/textures/texture-2.jpg`.
  Both are applicable to the same surface in the same photo.
  (If the two textures arrive combined in one image file, support an optional
  `crop: {x, y, w, h}` field per product — see 8.2.)
- Textures should be seamless/tileable where possible. If not, the seam will be visible on
  wide surfaces (known limitation, see 12).

### 3.2 Target surface for the sample photo
The surface to replace is the **walnut wood panel band** in the upper wall cabinet,
running horizontally above the stone backsplash and below the grey upper cabinets.

Approximate position in the sample photo (normalized 0..1 of image width/height),
to be **verified and adjusted in the admin tool**, not hard-coded:

| Corner | x | y |
|---|---|---|
| top-left | 0.46 | 0.234 |
| top-right | 1.00 | 0.234 |
| bottom-right | 1.00 | 0.413 |
| bottom-left | 0.46 | 0.413 |

Notes:
- The panel is viewed almost frontally, so a simple polygon is enough.
- The right edge is cut off by the photo border, so the polygon must reach x = 1.0.
- Do not include the stone backsplash below it, or the dark shadow gap above it.
- Optional extra surfaces the data model must be able to hold later (not required now):
  the walnut shelf unit on the far left and the walnut panel under the island.

## 4. Functional requirements

### Viewer (`index.html`)
- **FR-1** Show the base photo on a canvas, scaled to fit the viewport, keeping aspect ratio.
- **FR-2** Show a product list (2 products) with thumbnail and name. Selecting one applies
  it to the surface immediately.
- **FR-3** Show a pin label on the surface (e.g. "Wall panel"), positioned at the centroid
  of the surface polygon. Clicking the pin focuses that surface (relevant once more
  surfaces exist).
- **FR-4** Switching products must not reload any image after the first load of that texture.
- **FR-5** Controls: **Compare** (before/after slider), **Reset** (back to original),
  **Download** (PNG of the current result at original photo resolution).
- **FR-6** Texture adjustment controls for the selected surface: tile size, rotation
  (0/90/180/270 or free), offset. Defaults come from the data file.
- **FR-7** Responsive layout: works on desktop and mobile browsers.

### Admin mask tool (`admin.html`)
- **FR-8** Load the base photo and draw polygons on top of it.
- **FR-9** Click to add vertices; close polygon by clicking the first vertex or double-click.
- **FR-10** Drag a vertex to adjust. Delete a vertex or a whole polygon. Undo/redo.
- **FR-11** Each polygon has a mode: **include** (area that will change) or **exclude**
  (hole that must stay original, e.g. handle, faucet, appliance).
- **FR-12** Zoom (mouse wheel / pinch) and pan (drag with space or middle mouse) so edges can be
  drawn accurately. Vertex coordinates are stored in image space, independent of zoom.
- **FR-13** Mask preview: semi-transparent overlay (e.g. red 40%) toggle.
- **FR-14** **Test texture** button: fills the mask with a high-contrast checkerboard so
  gaps, leaks and jagged edges are easy to see.
- **FR-15** Export polygons as JSON (see 8.1); import JSON to continue editing;
  autosave draft to `localStorage`.

## 5. Masking approach (no AI)

### 5.1 Concept
A mask is a grayscale image the same size as the photo:
white (1) = this pixel may change, black (0) = keep original.
The mask is built from hand-drawn polygons.

### 5.2 Building the mask
1. Admin draws polygons in image coordinates (stored normalized 0..1, converted to pixels
   at the photo's natural resolution).
2. Rasterize to an offscreen canvas of the **natural photo size** (not screen size):
   - fill black;
   - fill every *include* polygon white;
   - fill every *exclude* polygon black (applied after includes).
3. Feather: blur the mask by ~1–2 px (configurable, `feather`) so edges are smooth, not jagged.
   Use a small box/gaussian blur on the mask data, not on the final image.
4. Convert to a `Float32Array` of values 0..1 (`mask[i]`) and keep the bounding box of
   non-zero pixels to limit later per-pixel work.

### 5.3 Drawing tips to document in the admin page
- Work zoomed in; add more vertices on corners and curves.
- Follow the edge slightly *inside* the surface rather than outside, to avoid color leaking
  onto neighbouring objects.
- Draw exclusions as separate polygons.
- Always run the **Test texture** check before saving.

### 5.4 Sample photo notes
- The walnut band is made of several vertical door panels with thin gaps. The mask may
  cover the whole band as one rectangle-like polygon. Gaps are lost unless the optional
  detail setting (6.4) is used.
- Keep the mask clear of the tall grey cabinet on the left and the stone backsplash below.

## 6. Rendering pipeline

All processing runs in the browser with Canvas 2D `ImageData` (WebGL is optional and not
required for the PoC at ~1600 px photos; restrict loops to the mask bounding box).

### 6.1 Precompute (once per room, after photo and mask are loaded)
1. `P` = photo pixels (RGB, 0..1).
2. `M` = mask (0..1) from section 5.
3. Luminance `L = 0.299 R + 0.587 G + 0.114 B` for every pixel.
4. **Low-frequency shade map `S`** (this is what keeps real lighting without keeping the
   original wood grain):
   - Blur `L` with a large radius (`shadeBlur`, default ~20 px at 1600 px width; scale with
     image width), using *masked* blurring: `Lblur = blur(L * M) / blur(M)` so pixels
     outside the mask do not bleed in.
   - `meanL` = average of `Lblur` over pixels where `M > 0.5`.
   - `S = clamp(Lblur / meanL, 0.6, 1.4)`.
   - Apply strength `k` (default 0.8): `S' = 1 + k * (S - 1)`.

Reason: the original band is dark walnut. Multiplying a new texture directly by the raw
photo luminance would make every texture dark and would print the old grain onto the new
texture. Normalizing by the mean and blurring heavily keeps only soft light/shadow.

### 6.2 Per product
1. Build the tiled texture on an offscreen canvas of the photo size:
   `createPattern(textureImage, 'repeat')`, apply `setTransform` for scale
   (`tileWidthPx`), rotation, offset. Read it as `T` (RGB 0..1).
2. For every pixel in the mask bounding box:
   `out = P * (1 - M) + clamp(T * S') * M`
3. Put the result on the display canvas.
4. Cache the texture image so a second selection does not reload it. Recompute only
   step 6.2 on product/adjustment change (not 6.1).

### 6.3 Compare / Reset / Download
- **Compare**: draw original on the left of a draggable divider and result on the right.
- **Reset**: show the original photo; clear selection.
- **Download**: render at natural photo resolution, `canvas.toBlob('image/png')`.

### 6.4 Optional (nice to have, off by default)
- `detailKeep` (0..1): add a fraction of fine luminance detail back
  (`L - blur(L, small radius)`), so door-panel gaps stay visible.
- Light color tint: multiply result by a small global color factor (e.g. warm/cool) if the
  texture looks too different from the room's light.

## 7. UI specification

- Left panel: surface chip ("Wall panel"), product list (thumbnail + name), selected state.
- Center: canvas with the room photo, pin label on the surface.
- Top bar: Compare, Zoom, Download, Reset.
- Adjustment drawer (collapsible): tile size slider, rotation select, offset X/Y, optional
  detail slider.
- Visual style: clean and neutral, no third-party logos or names.
- Admin page is a separate URL, not linked from the viewer.

## 8. Data model (JSON files, loaded with `fetch`)

### 8.1 `data/rooms.json`
```json
{
  "rooms": [
    {
      "id": "kitchen-1",
      "title": "Kitchen",
      "image": "assets/room.jpg",
      "surfaces": [
        {
          "id": "wall-panel",
          "label": "Wall panel",
          "type": "wall",
          "polygons": [
            { "mode": "include", "points": [[0.46,0.234],[1.0,0.234],[1.0,0.413],[0.46,0.413]] }
          ],
          "feather": 1.5,
          "shadeBlur": 20,
          "shadeStrength": 0.8
        }
      ]
    }
  ]
}
```
Points are normalized (0..1) relative to the photo's natural width and height.
The values above are the approximate starting point from section 3.2 and are replaced by
whatever the admin tool exports.

### 8.2 `data/products.json`
```json
{
  "products": [
    {
      "id": "tex-1",
      "name": "Texture 1",
      "kind": "texture",
      "surfaceTypes": ["wall"],
      "texture": "assets/textures/texture-1.jpg",
      "crop": null,
      "tileWidthPx": 600,
      "rotation": 0,
      "offset": [0, 0],
      "productUrl": ""
    },
    {
      "id": "tex-2",
      "name": "Texture 2",
      "kind": "texture",
      "surfaceTypes": ["wall"],
      "texture": "assets/textures/texture-2.jpg",
      "crop": null,
      "tileWidthPx": 600,
      "rotation": 0,
      "offset": [0, 0],
      "productUrl": ""
    }
  ]
}
```
- `kind` may later also be `"paint"` with a `colorHex` (same pipeline, solid color
  instead of a texture). Not required now.
- `crop` (optional) = `{x, y, w, h}` in texture pixels, for the case where several textures
  are delivered in one image.
- Adding a product = adding an entry here (plus its image). No change to any room.

## 9. File structure
```
/index.html            viewer
/admin.html            mask drawing tool
/css/style.css
/js/app.js             viewer logic (load data, UI, product selection)
/js/render.js          precompute + per-product rendering (section 6)
/js/mask.js            polygon -> mask raster, feather (section 5)
/js/admin.js           polygon editor
/data/rooms.json
/data/products.json
/assets/room.jpg
/assets/textures/texture-1.jpg
/assets/textures/texture-2.jpg
/README.md             run instructions, how to add a room/product
```

## 10. Technical notes
- **Must run through a local static server** (e.g. VS Code "Live Server" or
  `npx serve`). Opening via `file://` taints the canvas, so `getImageData` throws, and
  `fetch` of JSON fails.
- Textures and photo must be same-origin (served by the same server).
- Limit per-pixel loops to the mask bounding box. Reuse typed arrays; avoid allocating per frame.
- Handle `devicePixelRatio` for display, but always process at the photo's natural resolution.
- Use `requestAnimationFrame` for slider-driven re-renders (tile size, offset).
- No external libraries required. If a polygon helper is wanted for the admin tool,
  keep it local and optional.

## 11. Acceptance criteria
1. Opening `index.html` through the local server shows the kitchen photo with the pin on
   the wall panel and two products listed.
2. Selecting product 1, then product 2, changes only the walnut band; nothing else on the
   photo changes (grey cabinets, backsplash, handles, faucet, stools, shelf stay original).
3. After the first render, switching product completes in under 150 ms for a 1600 px wide photo.
4. Soft shadows and light gradients from the original photo are still visible on the new
   texture; the result does not look like a flat sticker.
5. The original walnut grain does not show through the new texture.
6. With the checkerboard test texture, mask edges show no visible jaggedness or gaps at
   100% zoom.
7. Compare slider, Reset and Download PNG work. The downloaded PNG has the original photo
   resolution.
8. The admin tool can redraw the polygon, export JSON, and the viewer picks it up after the
   JSON is saved to `data/rooms.json`.
9. Adding a third product by editing only `products.json` (and adding its image) makes it
   appear in the list and work, with no code change.

## 12. Known limitations (to state to the client)
- Quality depends on the base photo and on how carefully the polygon is drawn.
- Very dark original surfaces replaced by light textures can look dull or too dark; the
  shade normalization reduces this but cannot remove it completely.
- Non-tileable textures show seams on wide areas.
- Door gaps and fine details of the original panel are lost unless the optional detail
  setting is used.
- No perspective warping: acceptable here because the band is photographed almost
  frontally; strongly angled surfaces (floors, countertops) need an additional 4-point
  perspective step (future phase).

## 13. Future (not in this PoC)
- 4-point perspective per surface for floors and countertops.
- Paint/color products.
- More surfaces and more rooms.
- Click-to-select helper in the admin tool (assisted masking).
- Visitor photo upload (requires automatic surface detection).

## 14. Suggested prompt for Claude Code
> Read REQUIREMENTS.md and implement it in vanilla HTML/CSS/JS. Start with the viewer
> (index.html, render.js, mask.js) using the sample polygon from section 3.2 so I can see a
> result quickly, then build admin.html. Keep each file small and readable. Run it through a
> local static server. Report which acceptance criteria are met at the end.