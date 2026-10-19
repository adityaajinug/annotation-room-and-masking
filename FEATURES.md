# Room Texture Preview — Feature Breakdown, Pros/Cons & Masking Limits

Approach: **vanilla HTML + CSS + JavaScript**, Canvas 2D, no backend, no AI.
Client uploads **one room photo**; each texture is applied **in the browser on the fly**
(no pre-rendered image per product). Masks are drawn by hand in an admin page using
**Annotorious**.

---

## 1. Features that are possible (and what is already built)

Legend: ✅ built in this PoC · 🟡 possible, not built yet · ❌ not possible with this approach

### 1.1 Viewer (`index.html`)

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Show one base room photo, scaled to the screen | ✅ | Processing always happens at the photo's natural resolution |
| 2 | Product list with thumbnail + name | ✅ | Add a product = add an entry in `data/products.json` |
| 3 | Swap texture on a marked surface instantly | ✅ | Texture is cached after first load; no image reload on switch |
| 4 | Several surfaces in one photo (e.g. wall panel + island top) | ✅ | Each surface keeps its own product, pin label and settings |
| 5 | Surface pin / label on the photo | ✅ | Placed at the centroid of the surface |
| 6 | Realistic lighting (shadows/highlights of the original are kept) | ✅ | Soft shade map from the original photo is multiplied onto the new texture |
| 7 | Perspective fit (floor / counter look correct) | ✅ | 4-corner homography per surface, with anti-aliasing |
| 8 | Objects on top of the surface stay untouched | ✅ | Via "Exclude" polygons (see section 4) |
| 9 | Texture adjustment: tile size, rotation, offset X/Y, lighting strength | ✅ | |
| 10 | Compare (before/after slider) | ✅ | |
| 11 | Reset | ✅ | |
| 12 | Download result as PNG | ✅ | Original photo resolution |
| 13 | Responsive layout (desktop + mobile) | ✅ basic | Panel stacks under the photo on narrow screens |
| 14 | Zoom/pan inside the viewer | 🟡 | Simple to add (CSS/canvas transform) |
| 15 | Paint / solid color products (`colorHex`) | 🟡 | Same pipeline, solid color instead of texture |
| 16 | Restore fine detail of the old surface (e.g. door gaps) | 🟡 | `detailKeep` option from the PRD, off by default |
| 17 | Global warm/cool tint to match room light | 🟡 | One multiply factor |
| 18 | Several rooms / photos | 🟡 | Data model already supports a list of rooms; UI switcher not built |
| 19 | Product link / "Buy" button (`productUrl`) | 🟡 | Field exists in JSON, not shown in UI |
| 20 | Share link with the selected products | 🟡 | Encode selection in URL |

### 1.2 Admin mask tool (`admin.html`, Annotorious)

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Draw polygon on the photo (click points, close on first point / double-click) | ✅ | |
| 2 | **Include** polygon (area that will change) | ✅ | |
| 3 | **Exclude** polygon (hole that stays original: food, faucet, handle) | ✅ | As many as needed per surface |
| 4 | Multiple surfaces shown together, colored per surface, pin labels like the viewer | ✅ | |
| 5 | Drag vertices to adjust, delete shape | ✅ | |
| 6 | Undo / Redo, `Esc` to cancel a half-drawn shape | ✅ | |
| 7 | Zoom (buttons or Ctrl+wheel) and scroll to pan | ✅ | |
| 8 | Auto perspective (build 4 corners from the Include shape) | ✅ | Corners can be dragged afterwards |
| 9 | **Test texture** (checkerboard) to spot leaks / jagged edges | ✅ | |
| 10 | **Preview** with a real product, rendered exactly like the viewer | ✅ | |
| 11 | Autosave draft in the browser (`localStorage`) | ✅ | "Open viewer" (More menu) reads the draft |
| 12 | Export / import JSON | ✅ | Export, then copy the result into `data/rooms.json` |
| 13 | Save directly to a file / server | 🟡 | Removed for now; a browser-only version (File System Access API) or a small backend is easy to re-add |
| 14 | Mask edge assist (click an object, tool finds its outline by color) | 🟡 | Semi-automatic, **not AI**; speeds up Exclude shapes |
| 15 | Per-surface settings UI (feather, shade blur, shade strength) | 🟡 | Currently edited in `rooms.json` |

### 1.3 Not possible with this approach (needs AI or 3D)

| Feature | Why |
|---|---|
| Visitor uploads **their own** photo and gets surfaces detected automatically | Needs AI segmentation (e.g. SAM-type model) |
| Automatic depth / room-shape estimation | Needs AI depth model |
| 3D room or 3D product models | Out of scope (no 3D) |
| Curved or non-flat surfaces (round tables, curtains) | A single 4-corner plane cannot model curvature |
| Perfect replacement of reflections on glossy surfaces | Reflections in the original photo stay as they are |

---

## 2. How the rendering works (short version)

1. **Mask**: hand-drawn polygons are rasterized at the photo's natural size
   (Include = white, Exclude = black, applied after Include), then edges are blurred ~1.5 px.
2. **Shade map**: the photo's luminance is heavily blurred inside the mask and divided by its
   mean → keeps soft light/shadow but removes the old surface pattern (e.g. wood grain).
3. **Texture**: tiled flat (frontal surfaces) or warped by a 4-corner perspective transform
   (angled surfaces).
4. **Blend per pixel**: `result = photo × (1 − mask) + texture × shade × mask`.

---

## 3. Pros and cons of this approach

### Pros
- **One photo only.** No pre-rendering per product; every texture is generated live.
- **Fast to switch** (about 100 ms on an ~800 px photo in our test) and works offline once loaded.
- **Predictable and controllable.** What the admin draws is exactly what changes; no
  "AI surprises" or wrong detections.
- **No backend, no database, no API cost, no GPU.** Static files only; can be hosted anywhere.
- **Realistic enough** for flat/frontal surfaces: lighting of the real photo is kept, so it
  does not look like a flat sticker.
- **Perspective supported** for counters/floors via 4 corners.
- **Easy to extend:** a new product is just a JSON entry + image; a new surface is a polygon.
- **Privacy-friendly:** photos never leave the browser.

### Cons
- **Manual work per photo.** Someone must draw the masks (a few minutes per surface;
  more if there are many objects).
- **Quality depends on the mask.** A rough polygon → visible halos or leaks at edges.
- **Not for visitor-uploaded photos** — there is no automatic surface detection.
- **Flat planes only.** Curved or irregular surfaces will look wrong.
- **Textures should be seamless.** Non-tileable textures show seams on wide areas.
- **Very dark → very light changes** (e.g. dark walnut → white quartz) can look a bit dull or
  uneven; shade normalization reduces but cannot fully remove this.
- **Reflections, glass and fine shadows are not re-computed** (see section 4).
- **Fine detail of the old surface** (door gaps, panel seams) is lost unless the optional
  detail setting is added.
- **Per-pixel JavaScript cost** grows with photo size and surface area
  (perspective + anti-aliasing is heavier than flat tiling). Larger photos (e.g. 1600+ px)
  will be slower; WebGL would be the next step if needed.
- **Admin depends on a CDN** for Annotorious (can be vendored locally).

---

## 4. Maximum masking when there are objects in the middle of the surface

Objects standing on or in front of the surface (food, jar, faucet, stools) are handled by
**Exclude polygons**: inside an Exclude shape the original photo pixels are kept 100%.

### What it can do
- **Any number of Exclude shapes** per surface, each with **any number of vertices**.
  Practical limit is only the admin's patience, not the software.
- **Objects fully inside the surface** (a jar in the middle of a countertop): a hole is cut
  around it; the surface texture is applied around it.
- **Objects overlapping the surface edge** (a stool in front of the island, a faucet at the
  edge): the Exclude shape cuts the part that overlaps.
- **Soft edges**: ~1.5 px feather blends the border so it does not look cut-out.
- **Accuracy** is bounded by the photo resolution: edges can be placed to within about
  **1 pixel** when zoomed in (sample photo is ~800 px wide, so very small details are hard).

### Where it gets weak (the real maximum)

| Situation | Result |
|---|---|
| Object with a **smooth, simple outline** (jar, plate, bottle, faucet) | Very good — a polygon with 10–30 points is enough |
| Object with a **complex outline** (bread, plants, cables) | Good but slow to draw; many points needed, small edge errors remain |
| **Hair, fur, leaves, fringes, motion blur** | Poor — pixel-accurate soft edges cannot be drawn by hand |
| **Glass / transparent objects** (glass jar) | The jar is kept as in the photo, but the surface seen *through* the glass keeps the **old** color |
| **Shadows cast by objects** on the surface | Soft shadows survive through the shade map; sharp/dark contact shadows are weakened or changed |
| **Reflections of objects** on a glossy surface | Stay as in the original photo (old color), may look inconsistent |
| **Object touching the surface with a thin gap** (wire legs, stool legs) | Very hard to mask by hand |
| **Many small objects** (spice jars, utensils) | Possible, but each needs its own polygon |
| **Visitor photos with unknown objects** | Not possible without AI — masks are drawn by an admin in advance |

### Tips to get the best result
- Zoom in; add more vertices on curves and corners.
- Draw the **Include** edge slightly *inside* the surface and the **Exclude** edge slightly
  *outside* the object (a small safety margin), then check with **Test texture** until no
  halo or leak is visible.
- Use **Test texture** (checkerboard) first, then **Preview** with the real product.
- Use a higher-resolution base photo (1600–2400 px) for more accurate edges.
- If edges look hard, raise `feather` in `data/rooms.json`.

### If more automation is wanted later
1. **Semi-automatic edge assist** (click an object → outline by color; no AI) — roughly
   halves the drawing time for objects with clear colors.
2. **AI segmentation (SAM-type model)** — one click per object, handles complex outlines and
   would enable visitor-uploaded photos. Requires a server or in-browser model and is a
   separate phase.
