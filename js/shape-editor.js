// Vector mask editor drawn over the photo (Figma-style): pen (corner + bezier nodes), rectangle, ellipse.
// Shapes live in normalized 0..1 coordinates. Every shape also exports a flattened polygon `points`,
// which is all the renderer / viewer reads, so older projects and the viewer keep working unchanged.
//
//   stored polygon = { mode, points, shape?: 'rect'|'ellipse', box?: [x0,y0,x1,y1], nodes?: [{x,y,ix,iy,ox,oy,smooth}] }
//   node: anchor (x,y) + bezier handles as offsets from the anchor: in (ix,iy) and out (ox,oy)

const SVGNS = 'http://www.w3.org/2000/svg';
const KAPPA = 0.5522847498; // circle -> 4 bezier arcs
const STEPS = 20;           // samples per curved segment when flattening

const svgEl = (tag, attrs, parent) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const c01 = v => Math.min(1, Math.max(0, v));
const r4 = v => +v.toFixed(4);
const hasH = n => n.ix || n.iy || n.ox || n.oy;
const segHasH = (a, b) => a.ox || a.oy || b.ix || b.iy;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const bezierOf = (a, b) => [[a.x, a.y], [a.x + a.ox, a.y + a.oy], [b.x + b.ix, b.y + b.iy], [b.x, b.y]];
const bezierAt = (p, t) => {
  const u = 1 - t;
  return [0, 1].map(k => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
};
const orderBox = b => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
const corner = (x, y) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0, smooth: false });

function nodesOfBox(box, kind) {
  const l = Math.min(box[0], box[2]), r = Math.max(box[0], box[2]);
  const t = Math.min(box[1], box[3]), b = Math.max(box[1], box[3]);
  if (kind === 'rect') return [corner(l, t), corner(r, t), corner(r, b), corner(l, b)];
  const cx = (l + r) / 2, cy = (t + b) / 2, kx = ((r - l) / 2) * KAPPA, ky = ((b - t) / 2) * KAPPA;
  return [ // clockwise from the top
    { x: cx, y: t, ix: -kx, iy: 0, ox: kx, oy: 0 },
    { x: r, y: cy, ix: 0, iy: -ky, ox: 0, oy: ky },
    { x: cx, y: b, ix: kx, iy: 0, ox: -kx, oy: 0 },
    { x: l, y: cy, ix: 0, iy: ky, ox: 0, oy: -ky },
  ].map(n => ({ ...n, smooth: true }));
}

function flatten(nodes) {
  const out = [];
  nodes.forEach((a, i) => {
    const b = nodes[(i + 1) % nodes.length];
    out.push([a.x, a.y]);
    if (segHasH(a, b)) {
      const p = bezierOf(a, b);
      for (let k = 1; k < STEPS; k++) out.push(bezierAt(p, k / STEPS));
    }
  });
  return out;
}

function pathD(nodes, W, H, closed = true) {
  const P = (x, y) => `${(x * W).toFixed(1)} ${(y * H).toFixed(1)}`;
  let d = `M${P(nodes[0].x, nodes[0].y)}`;
  const n = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < n; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    d += segHasH(a, b)
      ? `C${P(a.x + a.ox, a.y + a.oy)} ${P(b.x + b.ix, b.y + b.iy)} ${P(b.x, b.y)}`
      : `L${P(b.x, b.y)}`;
  }
  return d + (closed ? 'Z' : '');
}

class ShapeEditor {
  // hooks: activeId(), mode(), color(sid), status(text), onChange(), onSelect(shape), onCreate(shape),
  //        optional: onWand(p, tool), onDraft(pointCount)
  constructor(img, hooks) {
    this.img = img;
    this.hooks = hooks;
    this.shapes = [];
    this.sel = null;     // selected shape
    this.selNode = -1;   // selected node of a path
    this.tool = 'pen';
    this.draft = null;   // pen path being drawn: { sid, nodes, cursor }
    this.boxDraft = null;
    this.drag = null;
    this.uid = 1;

    const svg = this.svg = svgEl('svg', { class: 'shape-layer tool-pen' });
    this.bg = svgEl('rect', { fill: 'transparent' }, svg);
    this.gShapes = svgEl('g', {}, svg);
    this.gDraft = svgEl('g', { 'pointer-events': 'none' }, svg);
    this.gEdit = svgEl('g', {}, svg);
    svg.addEventListener('pointerdown', e => this.down(e));
    svg.addEventListener('pointermove', e => this.move(e));
    svg.addEventListener('pointerup', e => this.up(e));
    svg.addEventListener('pointercancel', e => this.up(e));
  }

  // ---- data in / out ----
  setShapes(list) { // [{ sid, polygon }]
    this.shapes = list.map(({ sid, polygon }) => this.fromPolygon(sid, polygon)).filter(Boolean);
    this.sel = null; this.selNode = -1; this.draft = null; this.boxDraft = null;
    this.render();
  }

  fromPolygon(sid, p) {
    const s = { uid: this.uid++, sid, mode: p.mode };
    if ((p.shape === 'rect' || p.shape === 'ellipse') && p.box) {
      s.kind = p.shape; s.box = [...p.box]; s.nodes = nodesOfBox(s.box, s.kind);
    } else if (p.nodes && p.nodes.length >= 3) {
      s.kind = 'path'; s.nodes = p.nodes.map(n => ({ ix: 0, iy: 0, ox: 0, oy: 0, smooth: false, ...n }));
    } else if (p.points && p.points.length >= 3) {
      s.kind = 'path'; s.nodes = p.points.map(([x, y]) => corner(x, y));
    } else return null;
    return s;
  }

  toPolygon(s) {
    const o = { mode: s.mode, points: flatten(s.nodes).map(([x, y]) => [r4(x), r4(y)]) };
    if (s.kind !== 'path') { o.shape = s.kind; o.box = s.box.map(r4); }
    else if (s.nodes.some(hasH)) {
      o.nodes = s.nodes.map(n => ({ x: r4(n.x), y: r4(n.y), ix: r4(n.ix), iy: r4(n.iy), ox: r4(n.ox), oy: r4(n.oy), smooth: !!n.smooth }));
    }
    return o;
  }

  exportBySurface(ids) {
    const out = Object.fromEntries(ids.map(id => [id, []]));
    for (const s of this.shapes) if (out[s.sid]) out[s.sid].push(this.toPolygon(s));
    return out;
  }

  // ---- tools / state ----
  setTool(t) {
    this.cancelDraft();
    this.tool = t;
    this.svg.setAttribute('class', 'shape-layer tool-' + t);
    this.render();
  }

  cancelDraft() {
    if (!this.draft && !this.boxDraft) return false;
    this.draft = null; this.boxDraft = null; this.drag = null;
    this.render();
    return true;
  }

  select(s, node = -1) {
    this.sel = s; this.selNode = node;
    this.render();
    if (s) this.hooks.onSelect(s);
  }

  deleteShape() {
    if (!this.sel) return false;
    this.shapes = this.shapes.filter(s => s !== this.sel);
    this.sel = null; this.selNode = -1;
    this.render();
    this.hooks.onChange();
    return true;
  }

  // Delete key: the selected node if one was clicked, else the whole shape (or the last pen point while drawing).
  deleteKey() {
    if (this.draft) return this.undoPoint();
    const s = this.sel;
    if (s && s.kind === 'path' && this.selNode >= 0 && s.nodes.length > (s.mode === 'quad' ? 4 : 3)) {
      s.nodes.splice(this.selNode, 1);
      this.selNode = -1;
      this.render();
      this.hooks.onChange();
      return true;
    }
    return this.deleteShape();
  }

  key(e) { // returns true when the key was used
    if (e.key === 'Enter' && this.draft) { this.finishDraft(); return true; }
    if (e.key === 'Escape') { if (this.cancelDraft()) return true; if (this.sel) { this.select(null); return true; } return false; }
    return false;
  }

  // ---- geometry helpers ----
  pt(e) {
    const r = this.svg.getBoundingClientRect();
    return [c01((e.clientX - r.left) / r.width), c01((e.clientY - r.top) / r.height)];
  }
  px(p) { return [p[0] * this.W, p[1] * this.H]; }
  pxDist(a, b) { return Math.hypot((a[0] - b[0]) * this.W, (a[1] - b[1]) * this.H); }

  // ---- pointer handling ----
  down(e) {
    if (e.button !== 0) return;
    // Double-click is detected here: re-rendering between the two clicks makes the browser drop `dblclick`.
    const ld = this.lastDown;
    const isDbl = ld && e.timeStamp - ld.t < 350 && Math.hypot(e.clientX - ld.x, e.clientY - ld.y) < 5;
    this.lastDown = isDbl ? null : { t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (isDbl) { this.dbl(e); return; }
    const t = e.target, p = this.pt(e);
    const h = t.dataset && t.dataset.h;
    if (h && this.sel) { // handles of the selected shape work with every tool
      const i = +t.dataset.i;
      if (h === 'a' && e.altKey) { this.selNode = i; this.deleteKey(); return; } // Alt+click a node = delete it
      this.svg.setPointerCapture(e.pointerId);
      if (h === 'a') this.selNode = i;
      this.drag = { type: h, i, start: p, orig: JSON.parse(JSON.stringify(this.sel.nodes)), box0: this.sel.box && [...this.sel.box], moved: false };
      this.render();
      return;
    }
    if (this.tool === 'select') {
      const uid = t.dataset && t.dataset.uid;
      const s = uid && this.shapes.find(x => x.uid === +uid);
      if (!s) { this.select(null); return; }
      this.select(s);
      this.svg.setPointerCapture(e.pointerId);
      this.drag = { type: 'move', start: p, orig: JSON.parse(JSON.stringify(s.nodes)), box: s.box && [...s.box], moved: false };
      return;
    }
    if (!this.hooks.activeId()) { this.hooks.status('Add a surface first (+ Add).'); return; }
    if (this.tool === 'wand' || this.tool === 'sam') { this.hooks.onWand(p, this.tool); return; }
    this.svg.setPointerCapture(e.pointerId);
    if (this.tool === 'pen') this.penDown(p);
    else { this.boxDraft = { kind: this.tool, p0: p, box: null }; this.drag = { type: 'box' }; }
  }

  move(e) {
    const p = this.pt(e), d = this.drag;
    if (!d) {
      if (this.draft) { this.draft.cursor = p; this.renderDraft(); }
      return;
    }
    const s = this.sel;
    if (d.type === 'pen') {
      const n = d.node, q = this.px(p), a = this.px([n.x, n.y]);
      if (this.hooks.mode() !== 'quad' && Math.hypot(q[0] - a[0], q[1] - a[1]) > 3) {
        n.ox = p[0] - n.x; n.oy = p[1] - n.y; n.ix = -n.ox; n.iy = -n.oy; n.smooth = true;
      }
      this.renderDraft();
    } else if (d.type === 'box') {
      this.boxDraft.box = this.boxFrom(this.boxDraft.p0, p, e);
      this.renderDraft();
    } else if (d.type === 'a' && s) {
      const n = s.nodes[d.i], o = d.orig[d.i];
      n.x = c01(o.x + p[0] - d.start[0]); n.y = c01(o.y + p[1] - d.start[1]);
      d.moved = true;
      this.render();
    } else if ((d.type === 'i' || d.type === 'o') && s) {
      const n = s.nodes[d.i];
      if (e.altKey) n.smooth = false;
      n[d.type + 'x'] = p[0] - n.x; n[d.type + 'y'] = p[1] - n.y;
      if (n.smooth) this.mirror(n, d.type);
      d.moved = true;
      this.render();
    } else if (d.type === 'c' && s) { // box corner of a rectangle / ellipse: the opposite corner stays put
      const b = d.box0, opp = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]][(d.i + 2) % 4];
      s.box = orderBox([opp[0], opp[1], p[0], p[1]]);
      s.nodes = nodesOfBox(s.box, s.kind);
      d.moved = true;
      this.render();
    } else if (d.type === 'move' && s) {
      const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      s.nodes.forEach((n, i) => { n.x = d.orig[i].x + dx; n.y = d.orig[i].y + dy; });
      if (d.box) s.box = [d.box[0] + dx, d.box[1] + dy, d.box[2] + dx, d.box[3] + dy];
      d.moved = true;
      this.render();
    }
  }

  up(e) {
    const d = this.drag;
    if (!d) return;
    try { this.svg.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
    this.drag = null;
    if (d.type === 'pen') { this.renderDraft(); return; }
    if (d.type === 'box') {
      const b = this.boxDraft && this.boxDraft.box, kind = this.boxDraft && this.boxDraft.kind;
      this.boxDraft = null;
      const big = b && Math.abs(b[2] - b[0]) * this.W > 4 && Math.abs(b[3] - b[1]) * this.H > 4;
      if (big) this.addBox(kind, b); else this.render();
      return;
    }
    if (d.moved) this.hooks.onChange();
  }

  dbl(e) {
    const t = document.elementFromPoint(e.clientX, e.clientY) || e.target, p = this.pt(e);
    if (this.draft) {
      this.finishDraft();
      return;
    }
    const s = this.sel;
    if (t.dataset && t.dataset.h === 'a' && s && s.kind === 'path' && s.mode !== 'quad') { this.toggleSmooth(s, +t.dataset.i); return; }
    if (this.tool !== 'select') return;
    const uid = t.dataset && t.dataset.uid;
    const hit = uid && this.shapes.find(x => x.uid === +uid);
    if (!hit) return;
    if (hit.kind !== 'path') { // rectangle / ellipse -> editable path
      hit.kind = 'path'; delete hit.box;
      this.select(hit);
      this.hooks.onChange();
      this.hooks.status('Converted to a path: drag its nodes, double-click a node to switch corner/smooth.');
    } else if (hit.mode !== 'quad') this.insertNode(hit, p);
  }

  // Add ready-made polygons (e.g. from the magic wand) as one undo step.
  addPolygons(list, { smooth = false } = {}) {
    const sid = this.hooks.activeId();
    const made = list.map(poly => this.fromPolygon(sid, poly)).filter(Boolean);
    if (!made.length) return;
    if (smooth) for (const m of made) this.smoothNodes(m);
    for (const m of made) this.shapes.push(m);
    this.sel = made[0]; this.selNode = -1;
    this.render();
    this.hooks.onChange();
  }

  // Turn corner nodes into smooth curve nodes: handles follow the line between the two neighbours, but nodes
  // that turn sharper than `corner` degrees stay corners, so real corners are not rounded off.
  smoothNodes(s, corner = 55) {
    if (s.kind !== 'path' || s.mode === 'quad' || s.nodes.length < 3) return false;
    const W = this.W || 1, H = this.H || 1, n = s.nodes.length;
    const P = nd => [nd.x * W, nd.y * H];
    const src = s.nodes.map(nd => ({ ...nd }));
    s.nodes.forEach((nd, i) => {
      const a = P(src[(i + n - 1) % n]), c = P(src[i]), b = P(src[(i + 1) % n]);
      const d1 = [c[0] - a[0], c[1] - a[1]], d2 = [b[0] - c[0], b[1] - c[1]];
      const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
      nd.ix = nd.iy = nd.ox = nd.oy = 0; nd.smooth = false;
      if (!l1 || !l2) return;
      const turn = (Math.acos(Math.max(-1, Math.min(1, (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2)))) * 180) / Math.PI;
      if (turn > corner) return; // a real corner
      const t = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...t) || 1;
      nd.ox = ((t[0] / tl) * l2 / 3) / W; nd.oy = ((t[1] / tl) * l2 / 3) / H;
      nd.ix = -((t[0] / tl) * l1 / 3) / W; nd.iy = -((t[1] / tl) * l1 / 3) / H;
      nd.smooth = true;
    });
    return true;
  }

  // Selected shape -> smooth curves / back to straight corners. Returns false when it does not apply.
  smoothSelected(smooth) {
    const s = this.sel;
    if (!s || s.kind !== 'path' || s.mode === 'quad') return false;
    if (smooth) this.smoothNodes(s);
    else s.nodes.forEach(nd => { nd.ix = nd.iy = nd.ox = nd.oy = 0; nd.smooth = false; });
    this.render();
    this.hooks.onChange();
    return true;
  }

  // Drop redundant nodes of the selected path (Douglas-Peucker on the flattened outline). `tol` is in screen px.
  // Curves are kept as plain corners afterwards; use "Smooth shape" to round them again.
  simplifySelected(tol = 3) {
    const s = this.sel;
    if (!s || s.kind !== 'path' || s.mode === 'quad' || s.nodes.length <= 3) return false;
    const W = this.W || 1, H = this.H || 1;
    const pts = flatten(s.nodes).map(([x, y]) => [x * W, y * H]);
    const dp = (a, b) => { // indices kept strictly between a and b
      let far = -1, max = tol;
      const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
        if (d > max) { max = d; far = i; }
      }
      return far < 0 ? [] : [...dp(a, far), far, ...dp(far, b)];
    };
    // closed ring: split at the point farthest from point 0 so both halves are open polylines
    let m = 1, md = 0;
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > md) { md = d; m = i; } });
    pts.push(pts[0]);
    const keep = [0, ...dp(0, m), m, ...dp(m, pts.length - 1)];
    if (keep.length < 3) return false;
    s.nodes = keep.map(i => corner(c01(pts[i][0] / W), c01(pts[i][1] / H)));
    this.selNode = -1;
    this.render();
    this.hooks.onChange();
    return true;
  }

  // ---- pen ----
  penDown(p) {
    const quad = this.hooks.mode() === 'quad';
    const d = this.draft || (this.draft = { sid: this.hooks.activeId(), nodes: [], cursor: p });
    if (d.nodes.length >= 3 && this.pxDist(p, [d.nodes[0].x, d.nodes[0].y]) < 10) { this.drag = null; this.finishDraft(); return; }
    const n = corner(p[0], p[1]);
    d.nodes.push(n);
    if (quad && d.nodes.length === 4) { this.drag = null; this.finishDraft(); return; }
    this.drag = { type: 'pen', node: n };
    this.renderDraft();
  }

  // Remove the last pen point (Ctrl+Z while drawing); the last one left cancels the shape.
  undoPoint() {
    if (!this.draft) return false;
    this.draft.nodes.pop();
    if (!this.draft.nodes.length) this.draft = null;
    this.drag = null;
    this.render();
    return true;
  }

  finishDraft() {
    const d = this.draft;
    this.draft = null;
    if (!d || d.nodes.length < 3) { this.render(); return; }
    this.addShape({ sid: d.sid, mode: this.hooks.mode(), kind: 'path', nodes: d.nodes });
  }

  addBox(kind, box) {
    const sid = this.hooks.activeId();
    if (this.hooks.mode() === 'quad') {
      if (kind === 'ellipse') { this.hooks.status('A perspective plane needs 4 corners: use the Pen or Rect tool.'); this.render(); return; }
      this.addShape({ sid, mode: 'quad', kind: 'path', nodes: nodesOfBox(box, 'rect') });
    } else {
      box = orderBox(box);
      this.addShape({ sid, mode: this.hooks.mode(), kind, box, nodes: nodesOfBox(box, kind) });
    }
  }

  addShape(s) {
    if (s.mode === 'quad') {
      if (s.nodes.length !== 4) { this.hooks.status('A perspective plane needs exactly 4 corners.'); this.render(); return; }
      s.nodes.forEach(n => { n.ix = n.iy = n.ox = n.oy = 0; n.smooth = false; });
      this.shapes = this.shapes.filter(x => !(x.sid === s.sid && x.mode === 'quad')); // one plane per surface
    }
    s.uid = this.uid++;
    this.shapes.push(s);
    this.sel = s; this.selNode = -1;
    this.render();
    this.hooks.onChange();
    if (this.hooks.onCreate) this.hooks.onCreate(s);
  }

  // ---- node editing ----
  mirror(n, from) { // keep the opposite handle collinear (smooth node), preserving its length
    const to = from === 'o' ? 'i' : 'o';
    const ax = n[from + 'x'] * this.W, ay = n[from + 'y'] * this.H;
    const len = Math.hypot(ax, ay);
    if (!len) return;
    const bl = Math.hypot(n[to + 'x'] * this.W, n[to + 'y'] * this.H) || len;
    n[to + 'x'] = (-ax / len) * bl / this.W;
    n[to + 'y'] = (-ay / len) * bl / this.H;
  }

  toggleSmooth(s, i) {
    const n = s.nodes[i];
    if (hasH(n)) { n.ix = n.iy = n.ox = n.oy = 0; n.smooth = false; }
    else {
      const a = s.nodes[(i + s.nodes.length - 1) % s.nodes.length], b = s.nodes[(i + 1) % s.nodes.length];
      n.ox = (b.x - a.x) / 6; n.oy = (b.y - a.y) / 6; n.ix = -n.ox; n.iy = -n.oy; n.smooth = true;
    }
    this.selNode = i;
    this.render();
    this.hooks.onChange();
  }

  insertNode(s, p) { // double-click on an outline: add a node there, keeping the curve shape
    const target = this.px(p);
    let best = null;
    s.nodes.forEach((a, i) => {
      const b = s.nodes[(i + 1) % s.nodes.length];
      const curved = segHasH(a, b), m = curved ? STEPS : 1, bz = bezierOf(a, b);
      const at = k => this.px(curved ? bezierAt(bz, k / m) : lerp(bz[0], bz[3], k));
      for (let k = 0; k < m; k++) {
        const A = at(k), B = at(k + 1), dx = B[0] - A[0], dy = B[1] - A[1];
        const u = Math.min(1, Math.max(0, ((target[0] - A[0]) * dx + (target[1] - A[1]) * dy) / (dx * dx + dy * dy || 1)));
        const dist = Math.hypot(A[0] + dx * u - target[0], A[1] + dy * u - target[1]);
        if (!best || dist < best.dist) best = { dist, i, t: (k + u) / m };
      }
    });
    if (!best || best.dist > 10) return;
    const a = s.nodes[best.i], b = s.nodes[(best.i + 1) % s.nodes.length], t = best.t;
    const [A, B, C, D] = bezierOf(a, b);
    const AB = lerp(A, B, t), BC = lerp(B, C, t), CD = lerp(C, D, t), ABC = lerp(AB, BC, t), BCD = lerp(BC, CD, t), S = lerp(ABC, BCD, t);
    const flat = !segHasH(a, b);
    const n = flat ? corner(S[0], S[1]) : { x: S[0], y: S[1], ix: ABC[0] - S[0], iy: ABC[1] - S[1], ox: BCD[0] - S[0], oy: BCD[1] - S[1], smooth: true };
    if (!flat) { a.ox = AB[0] - A[0]; a.oy = AB[1] - A[1]; b.ix = CD[0] - D[0]; b.iy = CD[1] - D[1]; }
    s.nodes.splice(best.i + 1, 0, n);
    this.selNode = best.i + 1;
    this.render();
    this.hooks.onChange();
  }

  boxFrom(p0, p, e) {
    let [x, y] = p;
    if (e.shiftKey) { // square in screen pixels
      const w = (x - p0[0]) * this.W, h = (y - p0[1]) * this.H, m = Math.max(Math.abs(w), Math.abs(h));
      x = c01(p0[0] + Math.sign(w || 1) * m / this.W); y = c01(p0[1] + Math.sign(h || 1) * m / this.H);
    }
    if (e.altKey) return [2 * p0[0] - x, 2 * p0[1] - y, x, y].map(c01); // from the centre
    return [p0[0], p0[1], x, y];
  }

  // ---- drawing ----
  render() {
    const W = this.W = this.img.clientWidth, H = this.H = this.img.clientHeight;
    const svg = this.svg;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.bg.setAttribute('width', W); this.bg.setAttribute('height', H);

    this.gShapes.replaceChildren();
    const active = this.hooks.activeId();
    for (const s of this.shapes) {
      const c = this.hooks.color(s.sid);
      const style = s.mode === 'exclude' ? { stroke: '#ff3b30', fill: 'rgba(255,59,48,.28)', 'stroke-dasharray': '5 3' }
        : s.mode === 'quad' ? { stroke: c, fill: 'transparent', 'stroke-dasharray': '6 4' }
        : { stroke: c, fill: c, 'fill-opacity': '.3' };
      svgEl('path', {
        d: pathD(s.nodes, W, H), class: 'shape', 'data-uid': s.uid, 'stroke-width': s === this.sel ? 2.5 : 1.5,
        opacity: s.sid === active ? 1 : 0.45, ...style,
      }, this.gShapes);
    }
    this.renderEdit();
    this.renderDraft();
  }

  renderEdit() {
    const g = this.gEdit, s = this.sel, W = this.W, H = this.H;
    g.replaceChildren();
    if (!s) return;
    const handle = (cls, attrs, x, y) => svgEl('rect', {
      class: cls, x: x * W - 4.5, y: y * H - 4.5, width: 9, height: 9, ...attrs,
    }, g);
    if (s.kind !== 'path') {
      const b = s.box, corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
      corners.forEach(([x, y], k) => handle('h-anchor', { 'data-h': 'c', 'data-i': k }, x, y));
      return;
    }
    const curves = s.mode !== 'quad';
    s.nodes.forEach((n, i) => {
      if (curves && (hasH(n) || i === this.selNode)) {
        for (const k of ['i', 'o']) {
          const hx = (n.x + n[k + 'x']) * W, hy = (n.y + n[k + 'y']) * H;
          if (!n[k + 'x'] && !n[k + 'y'] && i !== this.selNode) continue;
          svgEl('line', { x1: n.x * W, y1: n.y * H, x2: hx, y2: hy, class: 'h-line', 'pointer-events': 'none' }, g);
          svgEl('circle', { cx: hx, cy: hy, r: 4, class: 'h-ctrl', 'data-h': k, 'data-i': i }, g);
        }
      }
    });
    s.nodes.forEach((n, i) => handle('h-anchor' + (i === this.selNode ? ' on' : '') + (n.smooth ? ' smooth' : ''), { 'data-h': 'a', 'data-i': i }, n.x, n.y));
  }

  renderDraft() {
    const g = this.gDraft, W = this.W, H = this.H;
    g.replaceChildren();
    const count = this.draft ? this.draft.nodes.length : 0;
    if (count !== this.draftCount) { this.draftCount = count; if (this.hooks.onDraft) this.hooks.onDraft(count); }
    const bd = this.boxDraft;
    if (bd && bd.box) {
      svgEl('path', { d: pathD(nodesOfBox(bd.box, bd.kind), W, H), class: 'draft-line', fill: 'rgba(47,111,237,.15)' }, g);
      return;
    }
    const d = this.draft;
    if (!d || !d.nodes.length) return;
    const nodes = d.nodes;
    svgEl('path', { d: pathD(nodes, W, H, false), class: 'draft-line', fill: 'none' }, g);
    if (d.cursor && !this.drag) {
      const last = nodes[nodes.length - 1];
      svgEl('line', { x1: last.x * W, y1: last.y * H, x2: d.cursor[0] * W, y2: d.cursor[1] * H, class: 'draft-line', 'stroke-dasharray': '3 3' }, g);
    }
    nodes.forEach((n, i) => {
      if (hasH(n)) for (const k of ['i', 'o']) {
        svgEl('line', { x1: n.x * W, y1: n.y * H, x2: (n.x + n[k + 'x']) * W, y2: (n.y + n[k + 'y']) * H, class: 'h-line' }, g);
        svgEl('circle', { cx: (n.x + n[k + 'x']) * W, cy: (n.y + n[k + 'y']) * H, r: 3.5, class: 'h-ctrl' }, g);
      }
      svgEl('rect', { x: n.x * W - 4.5, y: n.y * H - 4.5, width: 9, height: 9, class: 'h-anchor' + (i === 0 && nodes.length >= 3 ? ' first' : '') }, g);
    });
  }
}
