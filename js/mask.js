// Polygon -> mask raster (PRD section 5). Everything runs at the photo's natural size.

function blurPass(src, dst, w, h, r, horizontal) {
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const lineStep = horizontal ? w : 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    let sum = 0, cnt = 0;
    for (let i = 0; i <= Math.min(r, n - 1); i++) { sum += src[base + i * step]; cnt++; }
    for (let i = 0; i < n; i++) {
      dst[base + i * step] = sum / cnt;
      const add = i + r + 1, rem = i - r;
      if (add < n) { sum += src[base + add * step]; cnt++; }
      if (rem >= 0) { sum -= src[base + rem * step]; cnt--; }
    }
  }
}

// Repeated box blur ~ gaussian. Returns a new Float32Array.
function boxBlur(src, w, h, r, passes = 3) {
  r = Math.max(1, Math.round(r));
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    blurPass(a, b, w, h, r, true);
    blurPass(b, a, w, h, r, false);
  }
  return a;
}

// polygons: [{mode:'include'|'exclude', points:[[x,y]...]}] with x,y normalized 0..1
function buildMask(w, h, polygons, feather = 1.5) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  for (const mode of ['include', 'exclude']) {
    g.fillStyle = mode === 'include' ? '#fff' : '#000';
    for (const poly of polygons) {
      if (poly.mode !== mode || poly.points.length < 3) continue;
      g.beginPath();
      poly.points.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
      g.closePath();
      g.fill();
    }
  }
  const px = g.getImageData(0, 0, w, h).data;
  let data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4] / 255;
  if (feather > 0) data = boxBlur(data, w, h, feather, 2);

  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] > 0.002) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const empty = x1 < 0;
  return { data, w, h, bbox: empty ? { x0: 0, y0: 0, x1: -1, y1: -1 } : { x0, y0, x1, y1 } };
}

function polygonCentroid(polygons) {
  const pts = polygons.filter(p => p.mode === 'include').flatMap(p => p.points);
  if (!pts.length) return [0.5, 0.5];
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}
