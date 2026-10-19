// Mask editor: Annotorious polygons <-> normalized polygons in rooms.json.
// All surfaces are shown together (same as the viewer); every shape carries two tags:
//   tagging "mode"    = include | exclude | quad
//   tagging "surface" = surface id

const $ = id => document.getElementById(id);
const DRAFT_KEY = 'room-mask-draft';
const COLORS = ['#2f6fed', '#e8a200', '#9b51e0', '#00a98f'];

let anno, img, rooms, surfaces, products, surface, mode = 'include', selected = null;
const polysBySurface = {}; // surfaceId -> [{mode, points}]

const tagValue = (a, purpose) => (a.body || []).find(b => b.purpose === purpose)?.value;
const modeOf = a => tagValue(a, 'mode') || 'include';
const surfaceOf = a => tagValue(a, 'surface') || surfaces[0].id;
const colorOf = id => COLORS[Math.max(0, surfaces.findIndex(s => s.id === id)) % COLORS.length];

function bodyFor(m, sid) {
  return [
    { type: 'TextualBody', purpose: 'mode', value: m },
    { type: 'TextualBody', purpose: 'surface', value: sid },
  ];
}

function toAnnotation(poly, sid, i) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const pts = poly.points.map(([x, y]) => `${(x * w).toFixed(1)},${(y * h).toFixed(1)}`).join(' ');
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    type: 'Annotation',
    id: `#${sid}-${i}`,
    body: bodyFor(poly.mode, sid),
    target: { selector: { type: 'SvgSelector', value: `<svg><polygon points="${pts}"></polygon></svg>` } },
  };
}

// Annotorious -> { surfaceId: [{mode, points}] }
function fromAnnotations() {
  const w = img.naturalWidth, h = img.naturalHeight;
  const out = Object.fromEntries(surfaces.map(s => [s.id, []]));
  for (const a of anno.getAnnotations()) {
    const sel = a.target.selector;
    const m = sel && sel.value && sel.value.match(/points=["']([^"']+)["']/);
    if (!m) continue;
    const points = m[1].trim().split(/\s+/).map(p => {
      const [x, y] = p.split(',').map(Number);
      return [+(x / w).toFixed(4), +(y / h).toFixed(4)];
    });
    (out[surfaceOf(a)] ||= []).push({ mode: modeOf(a), points });
  }
  return out;
}

// Undo/redo: snapshots of all polygons after every change.
const history = { stack: [], idx: -1 };
function persist() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ surfaces: polysBySurface })); } catch (e) { /* ignore */ }
}
function pushHistory() {
  const snap = JSON.stringify(polysBySurface);
  if (history.stack[history.idx] === snap) return;
  history.stack = history.stack.slice(0, history.idx + 1);
  history.stack.push(snap);
  if (history.stack.length > 100) history.stack.shift();
  history.idx = history.stack.length - 1;
}
function stepHistory(d) {
  const i = history.idx + d;
  if (i < 0 || i >= history.stack.length) return;
  history.idx = i;
  for (const k of Object.keys(polysBySurface)) delete polysBySurface[k];
  Object.assign(polysBySurface, JSON.parse(history.stack[i]));
  loadAll();
  persist();
  $('admin-status').textContent = d < 0 ? 'Undone.' : 'Redone.';
}

function saveAll() {
  Object.assign(polysBySurface, fromAnnotations());
  persist();
  pushHistory();
  const warn = Object.entries(polysBySurface).filter(([, ps]) => ps.filter(p => p.mode === 'quad').some(p => p.points.length !== 4));
  $('admin-status').textContent = warn.length
    ? 'Perspective polygon needs exactly 4 points.'
    : 'Draft saved. ' + surfaces.map(s => `${s.label}: ${polysBySurface[s.id].length}`).join(' · ');
  drawPins();
}

function loadAll() {
  anno.setAnnotations(surfaces.flatMap(s => (polysBySurface[s.id] || []).map((p, i) => toAnnotation(p, s.id, i))));
  selected = null;
  drawPins();
}

// Same pin labels as the viewer, at the centroid of each surface's include polygons.
function drawPins() {
  const stage = $('admin-stage');
  stage.querySelectorAll('.admin-pin').forEach(n => n.remove());
  for (const s of surfaces) {
    const [cx, cy] = polygonCentroid(polysBySurface[s.id] || []);
    const el = document.createElement('div');
    el.className = 'admin-pin' + (s === surface ? ' active' : '');
    el.textContent = s.label + (s === surface ? ' ✎' : '');
    el.style.left = cx * 100 + '%';
    el.style.top = cy * 100 + '%';
    el.style.background = colorOf(s.id);
    stage.appendChild(el);
  }
}

function loadAllKeepSel() { const sel = selected; loadAll(); selected = sel; }

function setMode(m) {
  mode = m;
  ['include', 'exclude', 'quad'].forEach(k => $('mode-' + k).classList.toggle('on', m === k));
  const what = {
    include: 'click points around the area that should CHANGE. Finish: click the first point or double-click.',
    exclude: 'click points around an object that must STAY original (food, faucet...). Finish: click the first point or double-click.',
    quad: 'click the 4 corners of the flat plane, or just press "Auto perspective".',
  }[m];
  $('guide').textContent = `Drawing on "${surface.label}" - ${m.toUpperCase()}: ${what} (Esc = cancel)`;
}

function setupAnnotorious() {
  anno = Annotorious.init({
    image: 'room',
    disableEditor: true,
    formatter: a => {
      const sid = surfaceOf(a), m = modeOf(a), c = colorOf(sid);
      const dim = sid !== surface.id ? ' dim' : '';
      if (m === 'exclude') return { className: 'exclude' + dim, style: 'stroke:#ff3b30;fill:rgba(255,59,48,.28)' };
      if (m === 'quad') return { className: 'quad' + dim, style: `stroke:${c};fill:none` };
      return { className: 'include' + dim, style: `stroke:${c};fill:${c};fill-opacity:.3` };
    },
  });
  anno.setDrawingTool('polygon');

  // Tag every new shape with the current mode + surface and save immediately (no popup).
  anno.on('createSelection', async selection => {
    selection.body = bodyFor(mode, surface.id);
    if (mode === 'quad') { // only one perspective shape per surface
      for (const a of anno.getAnnotations()) if (surfaceOf(a) === surface.id && modeOf(a) === 'quad') anno.removeAnnotation(a);
    }
    await anno.updateSelected(selection, true);
    saveAll();
    if (mode === 'quad') setMode('include');
  });
  anno.on('updateAnnotation', saveAll);
  anno.on('deleteAnnotation', saveAll);
  anno.on('selectAnnotation', a => {
    selected = a;
    const s = surfaces.find(x => x.id === surfaceOf(a));
    if (s && s !== surface) { surface = s; $('surface-select').value = s.id; setMode(mode); drawPins(); }
  });
  anno.on('cancelSelected', () => { selected = null; });
}

// Abort a half-drawn shape: toggling the drawing tool drops the unfinished one.
function cancelDrawing() {
  anno.cancelSelected();
  anno.setDrawingEnabled(false);
  anno.setDrawingEnabled(true);
  $('admin-status').textContent = 'Drawing cancelled.';
}

// Build the 4 perspective corners from this surface's Include polygon(s).
function autoQuad() {
  Object.assign(polysBySurface, fromAnnotations());
  const list = polysBySurface[surface.id];
  const pts = list.filter(p => p.mode === 'include').flatMap(p => p.points);
  if (pts.length < 3) { $('admin-status').textContent = 'Draw an Include shape first.'; return; }
  let corners;
  const inc = list.filter(p => p.mode === 'include');
  if (inc.length === 1 && inc[0].points.length === 4) {
    corners = inc[0].points;
  } else {
    const pick = f => pts.reduce((b, p) => (f(p) > f(b) ? p : b));
    corners = [pick(p => -(p[0] + p[1])), pick(p => p[0] - p[1]), pick(p => p[0] + p[1]), pick(p => p[1] - p[0])];
    if (new Set(corners.map(String)).size < 4) { // degenerate: fall back to bounding box
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const [a, b, c, d] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      corners = [[a, c], [b, c], [b, d], [a, d]];
    }
  }
  polysBySurface[surface.id] = list.filter(p => p.mode !== 'quad').concat({ mode: 'quad', points: corners });
  loadAll();
  persist();
  pushHistory();
  $('admin-status').textContent = 'Perspective corners created. Drag the dots to fine-tune, then Test texture.';
}

// Zoom = resize the image; Annotorious' SVG layer scales with it.
let zoom = 1;
function setZoom(z) {
  const box = document.querySelector('.admin-scroll');
  const fit = (box.clientWidth - 2) / img.naturalWidth;
  zoom = Math.min(4, Math.max(0.5, z));
  img.style.width = Math.round(img.naturalWidth * fit * zoom) + 'px';
  window.dispatchEvent(new Event('resize'));
}

function deleteSelected() {
  const a = selected || anno.getSelected();
  if (!a) return;
  anno.removeAnnotation(a);
  selected = null;
  saveAll();
}

// Render exactly like the viewer. productId '' = checkerboard test.
function togglePreview(productId) {
  const cv = $('test');
  if (!cv.hidden) { cv.hidden = true; $('btn-test').classList.remove('on'); $('btn-preview').classList.remove('on'); return; }
  const all = fromAnnotations();
  let shared = null, tex, params;
  const product = products.find(p => p.id === productId);
  if (product) {
    tex = null; // loaded below
  } else {
    tex = document.createElement('canvas');
    tex.width = tex.height = 16;
    const g = tex.getContext('2d');
    g.fillStyle = '#ff00aa'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#00ffd0'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  }
  const run = t => {
    for (const s of surfaces) {
      const r = new SurfaceRenderer(img, { ...s, polygons: all[s.id] }, shared);
      shared = r.result;
      if (product && !product.surfaceTypes.includes(s.type)) continue;
      params = product
        ? { tileWidthPx: product.tileWidthPx, rotation: product.rotation, offset: [...product.offset], shadeStrength: s.shadeStrength ?? 0.8 }
        : { tileWidthPx: 40, rotation: 0, offset: [0, 0], shadeStrength: 0 };
      r.render(t, params);
      cv.width = r.w; cv.height = r.h;
    }
    cv.getContext('2d').putImageData(shared, 0, 0);
    cv.hidden = false;
    $(product ? 'btn-preview' : 'btn-test').classList.add('on');
  };
  if (product) loadTexture(product).then(run); else run(tex);
}

function exportJson() {
  saveAll();
  const out = { surfaces: surfaces.map(s => ({ ...s, polygons: polysBySurface[s.id] })) };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'surfaces.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(file) {
  file.text().then(txt => {
    const data = JSON.parse(txt);
    // accept either {surfaces:[...]} or a full rooms.json
    const list = data.surfaces || (data.rooms && data.rooms[0].surfaces) || [];
    for (const s of list) polysBySurface[s.id] = s.polygons;
    loadAll();
    saveAll();
  });
}

async function init() {
  img = $('room');
  await (img.complete && img.naturalWidth ? Promise.resolve() : new Promise(r => (img.onload = r)));
  [rooms, products] = await Promise.all([
    fetch('data/rooms.json').then(r => r.json()),
    fetch('data/products.json').then(r => r.json()).then(d => d.products),
  ]);
  surfaces = rooms.rooms[0].surfaces;
  surface = surfaces[0];

  const sel = $('surface-select'), psel = $('product-select');
  for (const s of surfaces) {
    polysBySurface[s.id] = s.polygons;
    sel.add(new Option(s.label, s.id));
  }
  for (const p of products) psel.add(new Option(p.name, p.id));
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (draft && draft.surfaces) {
      // an empty list is never a useful surface, so keep rooms.json's polygons instead
      for (const [id, ps] of Object.entries(draft.surfaces)) if (ps && ps.length) polysBySurface[id] = ps;
    }
  } catch (e) { /* ignore */ }

  setupAnnotorious();
  loadAll();
  setMode('include');

  sel.onchange = () => { surface = surfaces.find(s => s.id === sel.value); setMode(mode); loadAllKeepSel(); };
  ['include', 'exclude', 'quad'].forEach(k => ($('mode-' + k).onclick = () => setMode(k)));
  $('btn-delete').onclick = deleteSelected;
  $('btn-undo').onclick = () => stepHistory(-1);
  $('btn-redo').onclick = () => stepHistory(1);
  $('btn-autoquad').onclick = autoQuad;
  $('zoom-in').onclick = () => setZoom(zoom * 1.25);
  $('zoom-out').onclick = () => setZoom(zoom / 1.25);
  $('zoom-fit').onclick = () => setZoom(1);
  document.querySelector('.admin-scroll').addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  $('btn-clear').onclick = () => {
    if (!confirm(`Remove all polygons of "${surface.label}"?`)) return;
    polysBySurface[surface.id] = [];
    anno.setAnnotations(anno.getAnnotations().filter(a => surfaceOf(a) !== surface.id));
    saveAll();
  };
  $('btn-overlay').onclick = e => {
    const hide = document.body.classList.toggle('hide-mask');
    e.target.textContent = hide ? 'Show overlay' : 'Hide overlay';
  };
  $('btn-test').onclick = () => togglePreview('');
  $('btn-preview').onclick = () => togglePreview(psel.value);
  $('btn-export').onclick = exportJson;
  $('file-import').onchange = e => e.target.files[0] && importJson(e.target.files[0]);
  document.addEventListener('keydown', e => {
    if (/^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'delete' || k === 'backspace') deleteSelected();
    else if (k === 'escape') cancelDrawing();
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 1 : -1); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); stepHistory(1); }
    else if (k === '1') setMode('include');
    else if (k === '2') setMode('exclude');
    else if (k === '3') setMode('quad');
  });
  saveAll();
  setZoom(1);
}

init().catch(err => { $('admin-status').textContent = 'Error: ' + err.message; });
