// Precompute shade map + per-texture compositing (PRD section 6).

class SurfaceRenderer {
  // photo: HTMLImageElement, surface: entry from rooms.json
  constructor(photo, surface, shared) {
    this.w = photo.naturalWidth;
    this.h = photo.naturalHeight;
    this.surface = surface;

    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(photo, 0, 0);
    this.photoData = g.getImageData(0, 0, this.w, this.h);
    this.result = shared || new ImageData(new Uint8ClampedArray(this.photoData.data), this.w, this.h);
    this.quad = this.buildQuad(surface);

    this.tile = document.createElement('canvas');
    this.tile.width = this.w; this.tile.height = this.h;
    this.tileCtx = this.tile.getContext('2d', { willReadFrequently: true });

    this.mask = buildMask(this.w, this.h, surface.polygons, surface.feather ?? 1.5);
    this.computeShade();
  }

  // 4-point perspective plane (mode 'quad' polygon: TL,TR,BR,BL after sorting).
  buildQuad(surface) {
    const q = surface.polygons.find(p => p.mode === 'quad' && p.points.length === 4);
    if (!q) return null;
    const pts = q.points.map(([x, y]) => [x * this.w, y * this.h]);
    const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4;
    pts.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let tl = 0; // top-left = smallest x+y
    pts.forEach((p, i) => { if (p[0] + p[1] < pts[tl][0] + pts[tl][1]) tl = i; });
    const [a, b, c, d] = [0, 1, 2, 3].map(i => pts[(tl + i) % 4]);
    const dist = (p, r) => Math.hypot(p[0] - r[0], p[1] - r[1]);
    const Wp = (dist(a, b) + dist(d, c)) / 2;
    const Hp = surface.planeAspect ? Wp / surface.planeAspect : (dist(a, d) + dist(b, c)) / 2;
    // image -> plane homography
    this.H = homography([a, b, c, d], [[0, 0], [Wp, 0], [Wp, Hp], [0, Hp]]);
    return { Wp, Hp };
  }

  clear() {
    const { x0, y0, x1, y1 } = this.mask.bbox;
    for (let y = y0; y <= y1; y++) {
      const a = (y * this.w + x0) * 4, b = (y * this.w + x1 + 1) * 4;
      this.result.data.set(this.photoData.data.subarray(a, b), a);
    }
  }

  // image point -> plane point, with rotation about the plane centre and offset applied
  toPlane(px, py, cs, sn, ox, oy) {
    const { Wp, Hp } = this.quad, H = this.H;
    const ww = H[6] * px + H[7] * py + H[8];
    const u = (H[0] * px + H[1] * py + H[2]) / ww - Wp / 2;
    const v = (H[3] * px + H[4] * py + H[5]) / ww - Hp / 2;
    return [u * cs - v * sn - ox + Wp / 2, u * sn + v * cs - oy + Hp / 2];
  }

  // Perspective path: inverse-map every masked pixel into plane space, sample a pre-scaled tile.
  renderQuad(tex, params) {
    const { w, h } = this;
    const tw = Math.max(8, Math.round(params.tileWidthPx));
    const th = Math.max(8, Math.round(tw * tex.height / tex.width));
    const c = this.scaled || (this.scaled = document.createElement('canvas'));
    c.width = tw; c.height = th; // also clears
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(tex, 0, 0, tw, th);
    const T = g.getImageData(0, 0, tw, th).data;
    const rad = (params.rotation * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
    const ox = params.offset[0], oy = params.offset[1];

    const { x0, y0, x1, y1 } = this.mask.bbox;
    const M = this.mask.data, S = this.shade, P = this.photoData.data, out = this.result.data;
    const k = params.shadeStrength ?? this.surface.shadeStrength ?? 0.8;
    const mod = (v, n) => ((v % n) + n) % n;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x, j = i * 4, m = M[i];
        if (m < 0.002) { for (let c3 = 0; c3 < 3; c3++) out[j + c3] = P[j + c3]; continue; }
        // Map the pixel's vertical extent into plane space and average taps along it (anti-aliasing).
        const px = x + 0.5;
        const p0 = this.toPlane(px, y, cs, sn, ox, oy), p1 = this.toPlane(px, y + 1, cs, sn, ox, oy);
        const span = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const taps = Math.min(8, Math.max(1, Math.ceil(span)));
        let r = 0, gg = 0, bb = 0;
        for (let q = 0; q < taps; q++) {
          const f = (q + 0.5) / taps;
          const fx = mod(p0[0] + (p1[0] - p0[0]) * f, tw), fy = mod(p0[1] + (p1[1] - p0[1]) * f, th);
          const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
          const ix2 = (ix + 1) % tw, iy2 = (iy + 1) % th;
          const a00 = (iy * tw + ix) * 4, a10 = (iy * tw + ix2) * 4, a01 = (iy2 * tw + ix) * 4, a11 = (iy2 * tw + ix2) * 4;
          const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
          r += T[a00] * w00 + T[a10] * w10 + T[a01] * w01 + T[a11] * w11;
          gg += T[a00 + 1] * w00 + T[a10 + 1] * w10 + T[a01 + 1] * w01 + T[a11 + 1] * w11;
          bb += T[a00 + 2] * w00 + T[a10 + 2] * w10 + T[a01 + 2] * w01 + T[a11 + 2] * w11;
        }
        const sh = (1 + k * (S[i] - 1)) / taps;
        out[j] = P[j] * (1 - m) + Math.min(255, r * sh) * m;
        out[j + 1] = P[j + 1] * (1 - m) + Math.min(255, gg * sh) * m;
        out[j + 2] = P[j + 2] * (1 - m) + Math.min(255, bb * sh) * m;
      }
    }
    return this.result;
  }

  // Low-frequency lighting only: masked blur of luminance, normalised by its mean.
  computeShade() {
    const { w, h } = this, M = this.mask.data, P = this.photoData.data;
    const n = w * h;
    const LM = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      LM[i] = (0.299 * P[i * 4] + 0.587 * P[i * 4 + 1] + 0.114 * P[i * 4 + 2]) / 255 * M[i];
    }
    const r = (this.surface.shadeBlur ?? 30) * w / 1600;
    const bl = boxBlur(LM, w, h, r);
    const bm = boxBlur(M, w, h, r);
    const lb = new Float32Array(n);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      lb[i] = bm[i] > 1e-4 ? bl[i] / bm[i] : 0;
      if (M[i] > 0.5) { sum += lb[i]; cnt++; }
    }
    const mean = cnt ? sum / cnt : 1;
    this.shade = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.shade[i] = lb[i] ? Math.min(1.4, Math.max(0.6, lb[i] / mean)) : 1;
    }
  }

  // tex: image/canvas. params: {tileWidthPx, rotation (deg), offset:[x,y], shadeStrength}
  // Returns ImageData to put on a canvas.
  render(tex, params) {
    if (this.quad) return this.renderQuad(tex, params);
    const { w, h, tileCtx: g } = this;
    const s = params.tileWidthPx / tex.width;
    const R = ((w + h) * 2) / s;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(1, 0, 0, 1, w / 2 + params.offset[0], h / 2 + params.offset[1]);
    g.rotate((params.rotation * Math.PI) / 180);
    g.scale(s, s);
    g.fillStyle = g.createPattern(tex, 'repeat');
    g.fillRect(-R, -R, 2 * R, 2 * R);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const T = g.getImageData(0, 0, w, h).data;

    const { x0, y0, x1, y1 } = this.mask.bbox;
    const M = this.mask.data, S = this.shade, P = this.photoData.data, out = this.result.data;
    const k = params.shadeStrength ?? this.surface.shadeStrength ?? 0.8;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x, j = i * 4, m = M[i];
        const sh = 1 + k * (S[i] - 1);
        for (let c = 0; c < 3; c++) {
          const t = Math.min(255, T[j + c] * sh);
          out[j + c] = P[j + c] * (1 - m) + t * m;
        }
      }
    }
    return this.result;
  }
}

// Texture cache: each file is fetched once (FR-4). Supports optional crop {x,y,w,h}.
const textureCache = new Map();
function loadTexture(product) {
  if (textureCache.has(product.id)) return textureCache.get(product.id);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!product.crop) return resolve(img);
      const { x, y, w, h } = product.crop;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(c);
    };
    img.onerror = () => reject(new Error('Cannot load ' + product.texture));
    img.src = product.texture;
  });
  textureCache.set(product.id, p);
  return p;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Cannot load ' + src));
    img.src = src;
  });
}

// Solve 3x3 homography mapping 4 src points to 4 dst points (returns 9 numbers, row-major).
function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) { // gaussian elimination with pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}
