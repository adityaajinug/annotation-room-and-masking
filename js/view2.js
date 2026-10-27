// Viewer 2: shows the project made in admin-2 (photo, dots, masks, uploaded textures).

const $ = id => document.getElementById(id);
// entries: one per surface {surface, renderer, texture, tex, params}
const state = { entries: [], active: null, textures: [], result: null, rafId: 0 };

async function init() {
  const project = await Store.load();
  const surfaces = project ? project.surfaces.filter(s => s.polygons.some(p => p.mode === 'include')) : [];
  if (!project || !project.image || !surfaces.length) {
    $('notice').hidden = false;
    $('status').textContent = '';
    return;
  }
  $('layout').hidden = false;
  state.textures = project.textures;

  const photo = await loadImage(Store.urlOf(project.image));
  const orig = $('cv-original'), res = $('cv-result');
  orig.width = res.width = photo.naturalWidth;
  orig.height = res.height = photo.naturalHeight;
  orig.getContext('2d').drawImage(photo, 0, 0);

  for (const s of surfaces) {
    const renderer = new SurfaceRenderer(photo, s, state.result);
    state.result = renderer.result; // all surfaces draw into one shared image
    state.entries.push({ surface: s, renderer, texture: null, tex: null, params: null });
  }

  buildSurfaceChips();
  buildPins();
  bindControls();
  setActive(state.entries[0]);
  $('status').textContent = state.textures.length ? 'Pick a surface, then a texture.' : 'No textures in this project yet. Upload some in admin-2.';
}

function buildSurfaceChips() {
  const box = $('surface-chip');
  box.textContent = '';
  for (const e of state.entries) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = e.surface.label;
    b.onclick = () => setActive(e);
    e.chip = b;
    box.appendChild(b);
  }
}

function buildPins() {
  const stage = $('stage');
  for (const e of state.entries) {
    const [x, y] = pinOf(e.surface);
    const pin = document.createElement('button');
    pin.className = 'pin';
    pin.innerHTML = '<span></span>';
    pin.style.left = x * 100 + '%';
    pin.style.top = y * 100 + '%';
    pin.querySelector('span').textContent = e.surface.label;
    pin.onclick = () => setActive(e);
    stage.appendChild(pin);
    e.pin = pin;
  }
}

function setActive(e) {
  state.active = e;
  state.entries.forEach(x => {
    x.chip.classList.toggle('active', x === e);
    x.pin.classList.toggle('focus', x === e);
  });
  buildTextureList();
  if (e.params) syncAdjustUI(e.params);
}

function buildTextureList() {
  const ul = $('product-list');
  ul.textContent = '';
  for (const t of state.textures.filter(x => surfaceAllows(state.active.surface, x))) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    const im = document.createElement('img');
    im.src = Store.urlOf(t.src);
    im.alt = '';
    const name = document.createElement('span');
    name.textContent = t.name;
    b.append(im, name);
    b.classList.toggle('selected', state.active.texture === t);
    b.onclick = () => selectTexture(t);
    li.appendChild(b);
    ul.appendChild(li);
  }
}

async function selectTexture(t) {
  const e = state.active;
  e.texture = t;
  e.params = {
    tileWidthPx: t.tileWidthPx, rotation: t.rotation, offset: [...t.offset],
    shadeStrength: e.surface.shadeStrength ?? 0.8,
  };
  buildTextureList();
  syncAdjustUI(e.params);
  $('btn-compare').disabled = false;
  e.tex = await Store.textureImage(t);
  if (e.texture !== t) return; // user switched meanwhile
  draw();
}

function draw() {
  const t0 = performance.now();
  let any = false;
  for (const e of state.entries) {
    if (e.texture && e.tex) { e.renderer.render(e.tex, e.params); any = true; }
  }
  if (!any) return;
  $('cv-result').getContext('2d').putImageData(state.result, 0, 0);
  $('cv-result').hidden = false;
  $('status').textContent = `Rendered in ${Math.round(performance.now() - t0)} ms`;
}

function scheduleDraw() {
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(draw);
}

function syncAdjustUI(p) {
  $('adj-tile').value = p.tileWidthPx;
  $('adj-rot').value = String(p.rotation);
  $('adj-ox').value = p.offset[0];
  $('adj-oy').value = p.offset[1];
  $('adj-shade').value = p.shadeStrength;
}

function bindControls() {
  const upd = fn => ev => {
    const e = state.active;
    if (!e || !e.params) return;
    fn(e.params, ev.target.value);
    scheduleDraw();
  };
  $('adj-tile').oninput = upd((p, v) => p.tileWidthPx = +v);
  $('adj-rot').onchange = upd((p, v) => p.rotation = +v);
  $('adj-ox').oninput = upd((p, v) => p.offset[0] = +v);
  $('adj-oy').oninput = upd((p, v) => p.offset[1] = +v);
  $('adj-shade').oninput = upd((p, v) => p.shadeStrength = +v);

  // Compare: result canvas is clipped from the divider to the right edge.
  const range = $('compare-range'), div = $('divider'), res = $('cv-result');
  const setSplit = v => {
    res.style.clipPath = `inset(0 0 0 ${v}%)`;
    div.style.left = v + '%';
  };
  range.oninput = () => setSplit(+range.value);
  $('btn-compare').onclick = ev => {
    const on = !ev.target.classList.contains('on');
    ev.target.classList.toggle('on', on);
    range.hidden = div.hidden = !on;
    if (on) setSplit(+range.value); else res.style.clipPath = '';
  };

  $('btn-reset').onclick = () => {
    for (const e of state.entries) { e.texture = null; e.tex = null; e.params = null; e.renderer.clear(); }
    res.hidden = true;
    range.hidden = div.hidden = true;
    res.style.clipPath = '';
    $('btn-compare').classList.remove('on');
    $('btn-compare').disabled = true;
    buildTextureList();
    $('status').textContent = 'Reset to original.';
  };

  $('btn-download').onclick = () => {
    const src = res.hidden ? $('cv-original') : res;
    src.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'room-preview.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };
}

init().catch(err => { $('status').textContent = 'Error: ' + err.message + ' (run via a local static server)'; });
