// Image helpers for the mask editor, all plain JS (no model download):
//   magic wand  - flood-fill the pixels of similar colour around a click, return its outline (+ holes)

class Vision {
  constructor(img) {
    this.w = img.naturalWidth;
    this.h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    this.raw = g.getImageData(0, 0, this.w, this.h).data;
    this.pix = null; // 3x3-blurred copy (noise-tolerant colour compare)
  }

  prep() {
    if (this.pix) return;
    const { w, h, raw } = this, tmp = new Uint8ClampedArray(raw.length), out = new Uint8ClampedArray(raw.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = (y * w + Math.max(0, x - 1)) * 4, b = (y * w + x) * 4, c = (y * w + Math.min(w - 1, x + 1)) * 4;
        for (let k = 0; k < 3; k++) tmp[b + k] = (raw[a + k] + raw[b + k] + raw[c + k]) / 3;
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const a = (y0 * w + x) * 4, b = (y * w + x) * 4, c = (y1 * w + x) * 4;
        for (let k = 0; k < 3; k++) out[b + k] = (tmp[a + k] + tmp[b + k] + tmp[c + k]) / 3;
        out[b + 3] = 255;
      }
    }
    this.pix = out;
  }

  // tol 1..100. Returns { outer: [[x,y]...], holes: [[[x,y]...]...], area } in image pixels, or null.
  wand(sx, sy, tol) {
    this.prep();
    const { w, h, pix } = this;
    sx = Math.min(w - 1, Math.max(0, Math.floor(sx)));
    sy = Math.min(h - 1, Math.max(0, Math.floor(sy)));
    // seed colour = mean of the 5x5 around the click
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = Math.max(0, sy - 2); y <= Math.min(h - 1, sy + 2); y++) {
      for (let x = Math.max(0, sx - 2); x <= Math.min(w - 1, sx + 2); x++) {
        const i = (y * w + x) * 4; sr += pix[i]; sg += pix[i + 1]; sb += pix[i + 2]; n++;
      }
    }
    sr /= n; sg /= n; sb /= n;
    const thr = (tol * 1.8) ** 2;
    const mask = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0, area = 0, bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    const near = i => {
      const dr = pix[i * 4] - sr, dg = pix[i * 4 + 1] - sg, db = pix[i * 4 + 2] - sb;
      return dr * dr + dg * dg + db * db <= thr;
    };
    const start = sy * w + sx;
    mask[start] = 1; stack[sp++] = start;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0;
      area++;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      if (x > 0 && !mask[i - 1] && near(i - 1)) { mask[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && !mask[i + 1] && near(i + 1)) { mask[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !mask[i - w] && near(i - w)) { mask[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && !mask[i + w] && near(i + w)) { mask[i + w] = 1; stack[sp++] = i + w; }
    }
    if (area < 12) return null;
    return this.outlineOf(mask, area, bx0, by0, bx1, by1);
  }

  // Outline (+ holes) of an external binary mask (e.g. from the AI select). Keeps the blob under (sx, sy).
  outlineOfMask(src, sx, sy) {
    const { w, h } = this;
    sx = Math.min(w - 1, Math.max(0, Math.floor(sx)));
    sy = Math.min(h - 1, Math.max(0, Math.floor(sy)));
    let start = sy * w + sx;
    if (!src[start]) { // click landed just outside the mask: take the nearest set pixel
      let best = -1, bd = 1e9;
      for (let i = 0; i < src.length; i++) {
        if (!src[i]) continue;
        const d = (i % w - sx) ** 2 + (((i / w) | 0) - sy) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) return null;
      start = best;
    }
    const mask = new Uint8Array(w * h), stack = new Int32Array(w * h);
    let sp = 0, area = 0, bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    mask[start] = 1; stack[sp++] = start;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0;
      area++;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      if (x > 0 && src[i - 1] && !mask[i - 1]) { mask[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && src[i + 1] && !mask[i + 1]) { mask[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && src[i - w] && !mask[i - w]) { mask[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && src[i + w] && !mask[i + w]) { mask[i + w] = 1; stack[sp++] = i + w; }
    }
    if (area < 12) return null;
    return this.outlineOf(mask, area, bx0, by0, bx1, by1);
  }

  // Outline (+ holes) of a 4-connected blob. Returns { outer, holes, area } in image pixels, or null.
  outlineOf(mask, area, bx0, by0, bx1, by1) {
    const { w, h } = this;
    const eps = Math.max(1.5, 0.0025 * Math.max(w, h));
    const outer = simplify(traceOuter(mask, w, h, bx0, by0, bx1, by1), eps);
    if (outer.length < 3) return null;

    // holes: non-region pixels inside the bbox that cannot reach its border
    const bw = bx1 - bx0 + 3, bh = by1 - by0 + 3; // 1px padding so the outside is connected
    const lab = new Int32Array(bw * bh); // 0 unvisited, -1 outside/region, >0 hole id
    const at = (x, y) => (y - by0 + 1) * bw + (x - bx0 + 1);
    const inRegion = (x, y) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1 && mask[y * w + x];
    const fill = (x, y, id) => { // 4-connected flood over non-region pixels of the padded bbox
      const st = [[x, y]], pts = [];
      lab[at(x, y)] = id;
      while (st.length) {
        const [cx, cy] = st.pop(); pts.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < bx0 - 1 || nx > bx1 + 1 || ny < by0 - 1 || ny > by1 + 1) continue;
          if (inRegion(nx, ny) || lab[at(nx, ny)]) continue;
          lab[at(nx, ny)] = id; st.push([nx, ny]);
        }
      }
      return pts;
    };
    fill(bx0 - 1, by0 - 1, -1); // outside
    const holes = [], minHole = Math.max(25, area * 0.0008);
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        if (inRegion(x, y) || lab[at(x, y)]) continue;
        const pts = fill(x, y, 1 + holes.length);
        if (pts.length < minHole) continue;
        const hm = new Uint8Array(w * h);
        let hx0 = w, hy0 = h, hx1 = -1, hy1 = -1;
        for (const [px, py] of pts) {
          hm[py * w + px] = 1;
          if (px < hx0) hx0 = px; if (px > hx1) hx1 = px; if (py < hy0) hy0 = py; if (py > hy1) hy1 = py;
        }
        const poly = simplify(traceOuter(hm, w, h, hx0, hy0, hx1, hy1), eps);
        if (poly.length >= 3) holes.push({ poly, size: pts.length });
      }
    }
    holes.sort((a, b) => b.size - a.size);
    return { outer, holes: holes.slice(0, 12).map(h2 => h2.poly), area };
  }
}


// Box filter via summed-area table: dilate = any set pixel in the (2r+1) window, erode = all set (outside counts as set).
function boxFilter(src, w, h, r, erode) {
  const W1 = w + 1, I = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      out[y * w + x] = erode ? (sum === (x1 - x0) * (y1 - y0) ? 1 : 0) : (sum > 0 ? 1 : 0);
    }
  }
  return out;
}

Vision.prototype.detectObjects = function (M, sens) {
  // Objects standing on a surface: pixels inside the surface mask whose colour differs from the
  // surface's typical colour. M = Float32 mask (0..1) of the Include shapes minus Exclude holes.
  // sens 1..75 (higher = finds more; above ~75 the whole region gets flagged). Returns polygons in image pixels, biggest first.
  this.prep();
  const { w, h, pix } = this;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (M[y * w + x] > 0.5) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (area < 100) return [];
  // typical colour = per-channel median of a sample of the region
  const step = Math.max(1, Math.floor(area / 20000)), sample = [[], [], []];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (M[i] <= 0.5 || (n++ % step)) continue;
    for (let k = 0; k < 3; k++) sample[k].push(pix[i * 4 + k]);
  }
  const med = sample.map(a => { a.sort((p, q) => p - q); return a[a.length >> 1]; });
  const dist = i => Math.hypot(pix[i * 4] - med[0], pix[i * 4 + 1] - med[1], pix[i * 4 + 2] - med[2]);
  const ds = [];
  for (let i = 0, c = 0; i < w * h; i++) if (M[i] > 0.5 && (c++ % step) === 0) ds.push(dist(i));
  ds.sort((p, q) => p - q);
  const p80 = ds[Math.floor(ds.length * 0.8)] || 0;
  // base threshold from the slider; the surface's own texture (p80) raises it, less so at high sensitivity
  const thr = Math.max(15 + (100 - sens) * 1.2, p80 * 1.6 * ((100 - sens) / 50));

  let obj = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (M[i] > 0.5 && dist(i) > thr) obj[i] = 1; }
  const rOpen = 1, rClose = Math.max(2, Math.round(0.008 * Math.max(w, h)));
  obj = boxFilter(boxFilter(obj, w, h, rOpen, true), w, h, rOpen, false); // drop specks
  obj = boxFilter(boxFilter(obj, w, h, rClose, false), w, h, rClose, true); // merge fragments of one object
  for (let i = 0; i < w * h; i++) if (M[i] <= 0.5) obj[i] = 0;

  const minSize = Math.max(60, area * 0.0015), eps = Math.max(1.5, 0.0025 * Math.max(w, h));
  const seen = new Uint8Array(w * h), found = [], stack = new Int32Array(w * h);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const s0 = y * w + x;
      if (!obj[s0] || seen[s0]) continue;
      let sp = 0, size = 0, bx0 = w, by0 = h, bx1 = -1, by1 = -1;
      const mem = [];
      seen[s0] = 1; stack[sp++] = s0;
      while (sp) {
        const i = stack[--sp], cx = i % w, cy = (i / w) | 0;
        mem.push(i); size++;
        if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx; if (cy < by0) by0 = cy; if (cy > by1) by1 = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (obj[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
          }
        }
      }
      if (size < minSize) continue;
      const comp = new Uint8Array(w * h);
      for (const i of mem) comp[i] = 1;
      const poly = simplify(traceOuter(comp, w, h, bx0, by0, bx1, by1), eps);
      if (poly.length >= 3) found.push({ poly, size });
    }
  }
  found.sort((p, q) => q.size - p.size);
  return found.slice(0, 15).map(f => f.poly);
};

// Moore-neighbour outline of the 4-connected blob inside the bbox (pixel centres + 0.5).
const MDX = [-1, -1, 0, 1, 1, 1, 0, -1], MDY = [0, -1, -1, -1, 0, 1, 1, 1]; // W NW N NE E SE S SW
function traceOuter(mask, w, h, x0, y0, x1, y1) {
  let sx = -1, sy = -1;
  for (let y = y0; y <= y1 && sx < 0; y++) for (let x = x0; x <= x1; x++) if (mask[y * w + x]) { sx = x; sy = y; break; }
  if (sx < 0) return [];
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const dirOf = (dx, dy) => { for (let d = 0; d < 8; d++) if (MDX[d] === dx && MDY[d] === dy) return d; return 0; };
  const pts = [];
  let cx = sx, cy = sy, b = 0, guard = 0, firstMove = -1;
  const limit = 4 * (x1 - x0 + y1 - y0 + 2) + (x1 - x0 + 1) * (y1 - y0 + 1);
  for (;;) {
    pts.push([cx + 0.5, cy + 0.5]);
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (b + k) % 8, nx = cx + MDX[d], ny = cy + MDY[d];
      if (!inside(nx, ny)) continue;
      const pd = (d + 7) % 8;
      if (firstMove < 0) firstMove = d;
      else if (nx === sx && ny === sy && d === firstMove && pts.length > 2) return pts;
      b = dirOf(cx + MDX[pd] - nx, cy + MDY[pd] - ny);
      cx = nx; cy = ny; moved = true;
      break;
    }
    if (!moved || ++guard > limit) break;
    if (cx === sx && cy === sy && pts.length > 2) break;
  }
  return pts;
}

// Douglas-Peucker on a closed outline: split at the point farthest from the first, simplify both halves.
function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplify2(pts.slice(0, far + 1), eps);
  const b = simplify2(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// Open-polyline Douglas-Peucker.
function simplify2(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i0, i1] = st.pop();
    const [ax, ay] = pts[i0], [bx, by] = pts[i1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let md = -1, mi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; st.push([i0, mi], [mi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
