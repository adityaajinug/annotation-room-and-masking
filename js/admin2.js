// Mask editor 2: upload your own photo + textures, add your own surfaces (dots), mask them.
// Shapes are drawn with ShapeEditor (js/shape-editor.js): pen / rectangle / ellipse, each tagged with
//   mode = include | exclude | quad  and the surface it belongs to.

const $ = id => document.getElementById(id);
const COLORS = ['#2f6fed', '#e8a200', '#9b51e0', '#00a98f', '#e5484d', '#7a8b00'];
const PHOTO_MAX = 2000, TEX_MAX = 2048;
// How the texture blends with the photo: [slider id, surface key, default] (defaults match render.js look()).
const LOOK_SLIDERS = [['set-detail', 'detailStrength', 0.6], ['set-highlight', 'highlightStrength', 0.5], ['set-contact', 'contactShadow', 0.35], ['set-tint', 'tintStrength', 0.5]];

let project = Store.empty();
let editor = null, vision = null, sam = new Sam(), img = null, surface = null, mode = 'include', tool = 'pen', placing = false, scale = 1;
let wandTol = 25, wandHoles = true, detectSens = 55;

const stage = $('admin-stage');
const scroller = $('admin-scroll');
const surfaceById = id => project.surfaces.find(s => s.id === id);
const colorOf = id => COLORS[Math.max(0, project.surfaces.findIndex(s => s.id === id)) % COLORS.length];
const status = t => { $('admin-status').textContent = t; };

// ---- persistence + undo/redo (snapshots of surfaces: polygons, dots, settings) ----
let persistTimer = 0;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      // a project that came from data/project.json is copied into this browser on the first edit
      if (project.fromFile) { project.fromFile = false; await Store.saveAll(project); } else await Store.saveMeta(project);
    } catch (e) { status('Could not save in this browser: ' + e.message); }
  }, 250);
}
const history = { stack: [], idx: -1 };
function pushHistory() {
  const snap = JSON.stringify(project.surfaces);
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
  project.surfaces = JSON.parse(history.stack[i]);
  surface = surfaceById(surface?.id) || project.surfaces[0] || null;
  refresh();
  persist();
  status(d < 0 ? 'Undone.' : 'Redone.');
}

// Read shapes from the canvas into the project, save, redraw side UI.
function saveAll() {
  if (editor && img) {
    const polys = editor.exportBySurface(project.surfaces.map(s => s.id));
    for (const s of project.surfaces) s.polygons = polys[s.id];
  }
  persist();
  pushHistory();
  const bad = project.surfaces.find(s => s.polygons.some(p => p.mode === 'quad' && p.points.length !== 4));
  status(bad ? `"${bad.label}": a perspective shape needs exactly 4 points.` : 'Saved in this browser.');
  drawPins();
  renderSurfaceList();
}

function loadAll() {
  if (!editor) return;
  editor.setShapes(project.surfaces.flatMap(s => s.polygons.map(polygon => ({ sid: s.id, polygon }))));
}

function refresh() {
  loadAll();
  drawPins();
  renderSurfaceList();
  renderSettings();
  renderTextureList();
  setMode(mode);
}

// ---- dots (pins) ----
function drawPins() {
  stage.querySelectorAll('.admin-pin').forEach(n => n.remove());
  if (!img) return;
  for (const s of project.surfaces) {
    const [x, y] = pinOf(s);
    const el = document.createElement('div');
    el.className = 'admin-pin' + (s === surface ? ' active' : '') + (s.pin ? '' : ' nopin');
    el.textContent = s.label + (s === surface ? ' ✎' : '');
    el.style.left = x * 100 + '%';
    el.style.top = y * 100 + '%';
    el.style.background = colorOf(s.id);
    el.title = 'Drag to move the dot';
    el.onpointerdown = e => startPinDrag(e, s, el);
    stage.appendChild(el);
  }
}

function startPinDrag(e, s, el) {
  e.preventDefault();
  e.stopPropagation();
  selectSurface(s, { pins: false });
  const r = stage.getBoundingClientRect();
  const clamp = v => Math.min(1, Math.max(0, v));
  let moved = false;
  el.setPointerCapture(e.pointerId);
  el.onpointermove = ev => {
    moved = true;
    s.pin = [+clamp((ev.clientX - r.left) / r.width).toFixed(4), +clamp((ev.clientY - r.top) / r.height).toFixed(4)];
    el.style.left = s.pin[0] * 100 + '%';
    el.style.top = s.pin[1] * 100 + '%';
    el.classList.remove('nopin');
  };
  el.onpointerup = () => {
    el.onpointermove = el.onpointerup = null;
    if (moved) saveAll();
  };
}

function setPlacing(on) {
  placing = on;
  $('place-overlay').hidden = !on;
  if (on) $('guide').textContent = `Click the photo to place the dot of "${surface.label}". (Esc = skip)`;
  else setMode(mode);
}

// ---- surfaces ----
// shapes: redraw the overlay (dims other surfaces); pins: rebuild the dots.
// Both are skipped while the user is dragging a dot / editing a shape, which a rebuild would interrupt.
function selectSurface(s, { shapes = true, pins = true } = {}) {
  surface = s;
  renderSurfaceList();
  renderSettings();
  setMode(mode);
  if (pins) drawPins();
  else {
    stage.querySelectorAll('.admin-pin').forEach((n, i) => {
      const on = project.surfaces[i] === s;
      n.classList.toggle('active', on);
      n.textContent = project.surfaces[i].label + (on ? ' ✎' : '');
    });
  }
  if (shapes && editor) editor.render();
}

function addSurface() {
  if (!project.image) { status('Upload a photo first.'); return; }
  const n = project.surfaces.length + 1;
  const label = (prompt('Surface name', 'Surface ' + n) || '').trim();
  if (!label) return;
  const s = { id: Store.newId('s-'), label, pin: null, polygons: [], feather: 1.5, shadeBlur: 30, shadeStrength: 0.8 };
  project.surfaces.push(s);
  surface = s;
  saveAll();
  renderSettings();
  setPlacing(true);
}

function renameSurface(s) {
  const label = (prompt('Surface name', s.label) || '').trim();
  if (!label) return;
  s.label = label;
  saveAll();
}

function removeSurface(s) {
  if (!confirm(`Delete surface "${s.label}" with its shapes?`)) return;
  project.surfaces = project.surfaces.filter(x => x !== s);
  if (surface === s) surface = project.surfaces[0] || null;
  loadAll();
  saveAll();
  renderSettings();
  setMode(mode);
}

function renderSurfaceList() {
  const ul = $('surface-list');
  ul.textContent = '';
  for (const s of project.surfaces) {
    const li = document.createElement('li');
    li.className = s === surface ? 'active' : '';
    const n = s.polygons.filter(p => p.mode === 'include' || p.mode === 'quad').length;
    li.innerHTML = '<span class="dot"></span><span class="name"></span><button class="icon" title="Rename">✎</button><button class="icon" title="Delete">✕</button>';
    li.querySelector('.dot').style.background = colorOf(s.id);
    li.querySelector('.name').textContent = `${s.label} (${s.polygons.length})`;
    li.title = n ? '' : 'No shape drawn yet';
    li.onclick = () => selectSurface(s);
    const [rn, rm] = li.querySelectorAll('.icon');
    rn.onclick = e => { e.stopPropagation(); renameSurface(s); };
    rm.onclick = e => { e.stopPropagation(); removeSurface(s); };
    ul.appendChild(li);
  }
  $('surface-hint').textContent = !project.image ? 'Upload a photo to start.'
    : project.surfaces.length ? 'Click a surface to draw on it. Drag its dot on the photo to move it.'
    : 'No surfaces yet. Click "+ Add", then click the photo to place its dot.';
}

function renderSettings() {
  $('settings').hidden = !surface;
  if (!surface) return;
  $('set-feather').value = surface.feather ?? 1.5;
  $('set-shade').value = surface.shadeStrength ?? 0.8;
  for (const [id, key, def] of LOOK_SLIDERS) $(id).value = surface[key] ?? def;
  $('set-aspect').value = surface.planeAspect ?? '';
  renderAllowed();
}

// Per-surface texture choice. All checked = no restriction (textureIds removed).
function renderAllowed() {
  $('allowed').hidden = !surface || !project.textures.length;
  const ul = $('allowed-list');
  ul.textContent = '';
  if (!surface) return;
  for (const t of project.textures) {
    const li = document.createElement('li');
    li.style.cursor = 'default';
    li.innerHTML = '<label><input type="checkbox"> <img alt=""> <span class="name"></span></label>';
    const cb = li.querySelector('input');
    cb.checked = surfaceAllows(surface, t);
    li.querySelector('img').src = Store.urlOf(t.src);
    li.querySelector('.name').textContent = t.name;
    cb.onchange = () => {
      const on = new Set(project.textures.filter(x => surfaceAllows(surface, x)).map(x => x.id));
      if (cb.checked) on.add(t.id); else on.delete(t.id);
      if (on.size === project.textures.length) delete surface.textureIds; else surface.textureIds = [...on];
      persist();
      pushHistory();
    };
    ul.appendChild(li);
  }
}

// ---- textures ----
function renderTextureList() {
  const ul = $('texture-list'), psel = $('product-select');
  ul.textContent = '';
  const keep = psel.value;
  psel.textContent = '';
  for (const t of project.textures) {
    psel.add(new Option(t.name, t.id));
    const li = document.createElement('li');
    li.style.cursor = 'default';
    li.innerHTML = '<img alt=""><div class="tex-meta"><span class="name"></span><label>Tile px <input type="number" min="50" max="2000" step="10"></label></div><button class="icon" title="Delete">✕</button>';
    li.querySelector('img').src = Store.urlOf(t.src);
    li.querySelector('.name').textContent = t.name;
    const num = li.querySelector('input');
    num.value = t.tileWidthPx;
    num.onchange = () => { t.tileWidthPx = Math.max(50, +num.value || 400); persist(); };
    li.querySelector('.icon').onclick = async () => {
      project.textures = project.textures.filter(x => x !== t);
      for (const s of project.surfaces) if (s.textureIds) s.textureIds = s.textureIds.filter(id => id !== t.id);
      await Store.removeTexture(t.id);
      persist();
      renderTextureList();
    };
    ul.appendChild(li);
  }
  if (!project.textures.length) ul.innerHTML = '<li style="cursor:default;color:#777">No textures yet. Upload some.</li>';
  if (project.textures.some(t => t.id === keep)) psel.value = keep;
  renderAllowed();
}

async function uploadTextures(files) {
  for (const f of files) {
    try {
      const blob = await Store.fitImage(f, TEX_MAX);
      const t = { id: Store.newId('t-'), name: f.name.replace(/\.[^.]+$/, ''), tileWidthPx: 400, rotation: 0, offset: [0, 0], src: blob };
      await Store.setTexture(t.id, blob);
      project.textures.push(t);
    } catch (e) { status(`Cannot read "${f.name}": ${e.message}`); }
  }
  persist();
  renderTextureList();
  status(`${project.textures.length} texture(s).`);
}

// ---- photo / shape editor ----
async function mountPhoto() {
  editor = null;
  vision = null;
  stage.replaceChildren();
  img = null;
  $('empty').hidden = !!project.image;
  if (!project.image) { refresh(); return; }

  img = document.createElement('img');
  img.id = 'room';
  img.alt = 'room';
  const cv = document.createElement('canvas');
  cv.id = 'test';
  cv.hidden = true;
  const ov = document.createElement('div');
  ov.id = 'place-overlay';
  ov.className = 'place-overlay';
  ov.hidden = true;
  ov.onclick = e => {
    const r = stage.getBoundingClientRect();
    surface.pin = [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)];
    setPlacing(false);
    saveAll();
  };
  stage.append(img, cv, ov);
  editor = makeEditor();
  stage.insertBefore(editor.svg, ov);
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('Cannot load the photo.'));
    img.src = Store.urlOf(project.image);
  });
  vision = new Vision(img);
  fitView();
  refresh();
}

async function uploadPhoto(file) {
  if (!file) return;
  if (project.surfaces.length && !confirm('Replace the photo? Your surfaces and shapes stay, but may not line up with the new photo.')) return;
  try {
    project.image = await Store.fitImage(file, PHOTO_MAX);
    project.fromFile = false;
    await Store.setImage(project.image);
    persist();
    await mountPhoto();
    status(`Photo loaded (${img.naturalWidth}×${img.naturalHeight}).`);
  } catch (e) { status('Cannot read that photo: ' + e.message); }
}

function setMode(m) {
  mode = m;
  ['include', 'exclude', 'quad'].forEach(k => $('mode-' + k).classList.toggle('on', m === k));
  if (placing) return;
  if (!project.image) { $('guide').textContent = 'Upload a room photo to start.'; return; }
  if (!surface) { $('guide').textContent = 'Click "+ Add" to create the first surface.'; return; }
  const how = {
    select: 'click a shape to select it, drag to move. Drag its nodes; double-click an outline to add a node, a node to switch corner/smooth, a rectangle/ellipse to turn it into a path. Delete removes the selected node or shape.',
    pen: 'click = corner point, click + drag = curve. Finish: click the first point, press Enter or double-click.',
    rect: 'drag to draw a rectangle (Shift = square, Alt = from the centre).',
    ellipse: 'drag to draw an ellipse or circle (Shift = circle, Alt = from the centre).',
    sam: 'click an object: AI outlines it (first use downloads a ~35-60 MB model, then it is cached). In Exclude mode the object becomes a hole; in Include mode it becomes the area that changes.',
    wand: 'click an object or surface: the area of similar colour becomes a shape. Adjust Tolerance below; objects inside become Exclude.',
  }[tool];
  const what = {
    include: 'area that should CHANGE',
    exclude: 'object that must STAY original (food, faucet...)',
    quad: 'the 4 corners of the flat plane (or press "Auto perspective")',
  }[m];
  $('guide').textContent = `${surface.label} - ${m.toUpperCase()} = ${what}. ${tool.toUpperCase()}: ${how} (Esc = cancel)`;
}

function makeEditor() {
  const ed = new ShapeEditor(img, {
    activeId: () => surface?.id,
    mode: () => mode,
    color: colorOf,
    status,
    onChange: saveAll,
    onSelect: sh => {
      const s = surfaceById(sh.sid);
      if (s && s !== surface) selectSurface(s, { shapes: false, pins: false });
    },
    onCreate: sh => { if (sh.mode === 'quad') setMode('include'); },
    onWand: runWand,
    onDraft: n => {
      $('draft-bar').hidden = !n;
      $('draft-count').textContent = n;
      if (n) status('Ctrl+Z removes the last point, Esc cancels the whole shape.');
    },
  });
  ed.setTool(tool);
  return ed;
}

function setTool(t) {
  tool = t;
  ['select', 'pen', 'rect', 'ellipse', 'wand', 'sam'].forEach(k => $('tool-' + k).classList.toggle('on', t === k));
  $('tool-opts').hidden = t !== 'wand';
  if (editor) editor.setTool(t);
  setMode(mode);
}

// Abort a half-drawn shape (or drop the selection).
function cancelDrawing() {
  if (placing) { setPlacing(false); return; }
  if (!editor) return;
  if (editor.cancelDraft()) status('Drawing cancelled.');
  else editor.select(null);
}

// Build the 4 perspective corners from this surface's Include polygon(s).
function autoQuad() {
  if (!editor || !surface) return;
  saveAll();
  const list = surface.polygons;
  const inc = list.filter(p => p.mode === 'include');
  const pts = inc.flatMap(p => p.points);
  if (pts.length < 3) { status('Draw an Include shape first.'); return; }
  let corners;
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
  surface.polygons = list.filter(p => p.mode !== 'quad').concat({ mode: 'quad', points: corners });
  loadAll();
  saveAll();
  status('Perspective corners created. Drag the dots to fine-tune, then Test texture.');
}

// ---- view: zoom (wheel, buttons) and pan (Space + drag / middle mouse) ----
const MIN_SCALE = 0.05, MAX_SCALE = 8;

function fitScale() {
  return Math.max(MIN_SCALE, Math.min((scroller.clientWidth - 110) / img.naturalWidth, (scroller.clientHeight - 110) / img.naturalHeight));
}

// scale = displayed px per photo px. (cx, cy) = the screen point that stays put (default: view centre).
function setScale(sc, cx, cy) {
  if (!img) return;
  const br = scroller.getBoundingClientRect(), r0 = img.getBoundingClientRect();
  if (cx == null) { cx = br.left + br.width / 2; cy = br.top + br.height / 2; }
  const fx = (cx - r0.left) / r0.width, fy = (cy - r0.top) / r0.height;
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, sc));
  img.style.width = Math.round(img.naturalWidth * scale) + 'px';
  const r1 = img.getBoundingClientRect();
  scroller.scrollLeft += r1.left + fx * r1.width - cx;
  scroller.scrollTop += r1.top + fy * r1.height - cy;
  $('zoom-pct').textContent = Math.round(scale * 100) + '%';
  if (editor) editor.render();
}

function fitView() {
  if (!img) return;
  setScale(fitScale());
  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
  scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
}

let spaceDown = false, pan = null;
function bindView() {
  $('zoom-in').onclick = () => setScale(scale * 1.25);
  $('zoom-out').onclick = () => setScale(scale / 1.25);
  $('zoom-100').onclick = () => setScale(1);
  $('zoom-fit').onclick = fitView;
  scroller.addEventListener('wheel', e => {
    e.preventDefault();
    setScale(scale * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
  scroller.addEventListener('pointerdown', e => {
    if (!(spaceDown && e.button === 0) && e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation(); // do not draw while panning
    pan = { x: e.clientX, y: e.clientY, l: scroller.scrollLeft, t: scroller.scrollTop };
    scroller.setPointerCapture(e.pointerId);
    scroller.classList.add('panning');
  }, true);
  scroller.addEventListener('pointermove', e => {
    if (!pan) return;
    scroller.scrollLeft = pan.l - (e.clientX - pan.x);
    scroller.scrollTop = pan.t - (e.clientY - pan.y);
  });
  const endPan = () => { pan = null; scroller.classList.remove('panning'); };
  scroller.addEventListener('pointerup', endPan);
  scroller.addEventListener('pointercancel', endPan);
  document.addEventListener('keyup', e => {
    if (e.key === ' ') { e.preventDefault(); spaceDown = false; scroller.classList.remove('pan-ready'); }
  });
}

// ---- magic wand (js/vision.js) ----
function runWand(p, kind) {
  if (kind === 'sam') { runSam(p); return; }
  if (!surface) { status('Add a surface first (+ Add).'); return; }
  if (mode === 'quad') { status('A perspective plane needs 4 corners: use Pen or Rect.'); return; }
  const { w, h } = vision;
  status('Selecting...');
  setTimeout(() => { // let the status paint before the flood fill
    const r = vision.wand(p[0] * w, p[1] * h, wandTol);
    if (!r) { status('Nothing found there. Try a higher tolerance.'); return; }
    const norm = pts => pts.map(([x, y]) => [+(x / w).toFixed(4), +(y / h).toFixed(4)]);
    const list = [{ mode, points: norm(r.outer) }];
    if (mode === 'include' && wandHoles) for (const hole of r.holes) list.push({ mode: 'exclude', points: norm(hole) });
    editor.addPolygons(list);
    const big = r.area > 0.6 * w * h ? ' The area is huge: lower the tolerance.' : '';
    status(`Wand: ${list.length} shape(s). Refine the nodes with Select (V), or Ctrl+Z.${big}`);
  }, 0);
}

// Find objects standing on this surface (colour differs from the surface) and add them as Exclude shapes.
function runDetect() {
  if (!surface || !vision) { status('Add a surface first (+ Add).'); return; }
  const polys = editor.exportBySurface([surface.id])[surface.id].filter(p => p.mode !== 'quad');
  if (!polys.some(p => p.mode === 'include')) { status('Draw or wand an Include shape on this surface first.'); return; }
  const { w, h } = vision;
  status('Looking for objects...');
  setTimeout(() => {
    const mask = buildMask(w, h, polys, 0);
    const objs = vision.detectObjects(mask.data, detectSens);
    if (!objs.length) { status('No objects found. Raise "Object sensitivity" or draw them by hand.'); return; }
    const norm = pts => pts.map(([x, y]) => [+(x / w).toFixed(4), +(y / h).toFixed(4)]);
    editor.addPolygons(objs.map(poly => ({ mode: 'exclude', points: norm(poly) })));
    status(`${objs.length} object(s) added as Exclude. Fix them with Select (V), or Ctrl+Z.`);
  }, 0);
}

// AI select: SlimSAM outlines whatever is under the click.
let samBusy = false;
async function runSam(p) {
  if (!surface) { status('Add a surface first (+ Add).'); return; }
  if (mode === 'quad') { status('A perspective plane needs 4 corners: use Pen or Rect.'); return; }
  if (samBusy) return;
  samBusy = true;
  try {
    await sam.load(status);
    await sam.setPhoto(img.src, project.image, status);
    status('Segmenting...');
    const res = await sam.segment([{ x: p[0], y: p[1], label: 1 }]);
    const w = vision.w, h = vision.h;
    const r = vision.outlineOfMask(res.mask, p[0] * w, p[1] * h);
    if (!r) { status('The AI found nothing there. Try another spot on the object.'); return; }
    const norm = pts => pts.map(([x, y]) => [+(x / w).toFixed(4), +(y / h).toFixed(4)]);
    const list = [{ mode, points: norm(r.outer) }];
    if (mode === 'include' && wandHoles) for (const hole of r.holes) list.push({ mode: 'exclude', points: norm(hole) });
    editor.addPolygons(list);
    status(`AI select: ${list.length} shape(s) (confidence ${Math.round(res.score * 100)}%). Refine with Select (V), or Ctrl+Z.`);
  } catch (e) {
    status('AI select failed: ' + (e && e.message || e) + ' (needs internet the first time).');
    console.error(e);
  } finally { samBusy = false; }
}

// Ctrl+Z / Undo button: while drawing it removes the last pen point, otherwise it steps through history.
function undoAction(d) {
  if (d < 0 && editor && editor.undoPoint()) return;
  stepHistory(d);
}

function deleteSelected() {
  if (editor) editor.deleteShape();
}

// Render exactly like the viewer. textureId '' = checkerboard test.
async function togglePreview(textureId) {
  const cv = $('test');
  if (!img || !cv) return;
  if (!cv.hidden) { cv.hidden = true; $('btn-test').classList.remove('on'); $('btn-preview').classList.remove('on'); return; }
  const t = project.textures.find(x => x.id === textureId);
  if (textureId && !t) { status('Upload a texture first.'); return; }
  let tex;
  if (t) {
    tex = await Store.textureImage(t);
  } else {
    tex = document.createElement('canvas');
    tex.width = tex.height = 16;
    const g = tex.getContext('2d');
    g.fillStyle = '#ff00aa'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#00ffd0'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  }
  const polys = editor.exportBySurface(project.surfaces.map(x => x.id));
  let shared = null;
  for (const s of project.surfaces) {
    const r = new SurfaceRenderer(img, { ...s, polygons: polys[s.id] }, shared);
    shared = r.result;
    if (t && !surfaceAllows(s, t)) continue; // this surface does not offer that texture
    r.render(tex, t
      ? { tileWidthPx: t.tileWidthPx, rotation: t.rotation, offset: [...t.offset], shadeStrength: s.shadeStrength ?? 0.8 }
      : { tileWidthPx: 40, rotation: 0, offset: [0, 0], shadeStrength: 0 });
    cv.width = r.w; cv.height = r.h;
  }
  if (!shared) { status('Add a surface first.'); return; }
  cv.getContext('2d').putImageData(shared, 0, 0);
  cv.hidden = false;
  $(t ? 'btn-preview' : 'btn-test').classList.add('on');
}

// ---- project-level actions ----
async function exportJson() {
  saveAll();
  const blob = new Blob([JSON.stringify(await Store.toJson(project), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'project.json';
  a.click();
  URL.revokeObjectURL(a.href);
  status('Exported project.json. Save it as data/project.json to ship it with the site.');
}

async function replaceProject(p) {
  project = p;
  project.fromFile = false;
  surface = project.surfaces[0] || null;
  await Store.saveAll(project);
  history.stack = []; history.idx = -1;
  await mountPhoto();
  pushHistory();
}

async function importJson(file) {
  try { await replaceProject(await Store.fromJson(JSON.parse(await file.text()))); status('Project imported.'); }
  catch (e) { status('Import failed: ' + e.message); }
}

async function loadSample() {
  if (project.surfaces.length && !confirm('Replace the current project with the sample kitchen?')) return;
  try {
    const [rooms, prods] = await Promise.all([fetch('data/rooms.json').then(r => r.json()), fetch('data/products.json').then(r => r.json())]);
    const room = rooms.rooms[0];
    await replaceProject({
      ...Store.empty(),
      image: room.image,
      surfaces: room.surfaces.map(s => ({ ...s, pin: null })),
      textures: prods.products.map(p => ({ id: p.id, name: p.name, tileWidthPx: p.tileWidthPx, rotation: p.rotation, offset: [...p.offset], src: p.texture })),
    });
    status('Sample loaded.');
  } catch (e) { status('Cannot load sample: ' + e.message); }
}

async function init() {
  project = (await Store.load()) || Store.empty();
  surface = project.surfaces[0] || null;

  $('file-photo').onchange = $('file-photo-2').onchange = e => { uploadPhoto(e.target.files[0]); e.target.value = ''; };
  $('file-tex').onchange = e => { uploadTextures([...e.target.files]); e.target.value = ''; };
  $('btn-add-surface').onclick = addSurface;
  ['include', 'exclude', 'quad'].forEach(k => ($('mode-' + k).onclick = () => setMode(k)));
  ['select', 'pen', 'rect', 'ellipse', 'wand', 'sam'].forEach(k => ($('tool-' + k).onclick = () => setTool(k)));
  $('wand-tol').oninput = e => { wandTol = +e.target.value; $('wand-tol-val').textContent = wandTol; };
  $('detect-sens').oninput = e => { detectSens = +e.target.value; $('detect-sens-val').textContent = detectSens; };
  $('btn-detect').onclick = runDetect;
  $('wand-holes').onchange = e => { wandHoles = e.target.checked; };
  $('draft-undo').onclick = () => editor && editor.undoPoint();
  $('draft-cancel').onclick = () => editor && editor.cancelDraft();
  $('draft-finish').onclick = () => editor && editor.finishDraft();
  bindView();
  $('btn-delete').onclick = deleteSelected;
  $('btn-undo').onclick = () => undoAction(-1);
  $('btn-redo').onclick = () => stepHistory(1);
  $('btn-autoquad').onclick = autoQuad;
  $('btn-overlay').onclick = e => {
    const hide = document.body.classList.toggle('hide-mask');
    e.target.textContent = hide ? 'Show overlay' : 'Hide overlay';
  };
  $('btn-test').onclick = () => togglePreview('');
  $('btn-preview').onclick = () => togglePreview($('product-select').value);
  $('btn-export').onclick = exportJson;
  $('btn-sample').onclick = loadSample;
  $('btn-reset').onclick = async () => {
    if (!confirm('Delete the photo, surfaces and textures stored in this browser?')) return;
    await Store.clear();
    await replaceProject(Store.empty());
    status('Everything cleared.');
  };
  $('file-import').onchange = e => { e.target.files[0] && importJson(e.target.files[0]); e.target.value = ''; };

  $('set-feather').oninput = e => { surface.feather = +e.target.value; persist(); };
  $('set-shade').oninput = e => { surface.shadeStrength = +e.target.value; persist(); };
  for (const [id, key] of LOOK_SLIDERS) $(id).oninput = e => { surface[key] = +e.target.value; persist(); };
  $('set-aspect').onchange = e => {
    if (+e.target.value > 0) surface.planeAspect = +e.target.value; else delete surface.planeAspect;
    persist();
  };

  document.addEventListener('keydown', e => {
    if (/^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (placing && k === 'escape') { setPlacing(false); return; }
    if (editor && !e.ctrlKey && !e.metaKey && editor.key(e)) return;
    if (k === 'delete' || k === 'backspace') { if (editor) editor.deleteKey(); }
    else if (k === 'escape') cancelDrawing();
    else if (k === 'v') setTool('select');
    else if (k === 'p') setTool('pen');
    else if (k === 'r') setTool('rect');
    else if (k === 'o') setTool('ellipse');
    else if (k === 'w') setTool('wand');
    else if (k === 'a') setTool('sam');
    else if (k === ' ') { e.preventDefault(); spaceDown = true; scroller.classList.add('pan-ready'); }
    else if (k === '+' || k === '=') setScale(scale * 1.25);
    else if (k === '-') setScale(scale / 1.25);
    else if (k === '0') fitView();
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undoAction(e.shiftKey ? 1 : -1); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); stepHistory(1); }
    else if (k === '1') setMode('include');
    else if (k === '2') setMode('exclude');
    else if (k === '3') setMode('quad');
  });

  await mountPhoto();
  pushHistory();
  if (project.fromFile) status('Loaded data/project.json. Your first edit copies it into this browser.');
}

init().catch(err => { status('Error: ' + err.message); });
