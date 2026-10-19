// Viewer logic: load data, surfaces, product list, adjustments, compare/reset/download.

const $ = id => document.getElementById(id);
// entries: one per surface {surface, renderer, product, tex, params}
const state = { entries: [], active: null, products: [], result: null, rafId: 0 };

async function init() {
  const useDraft = new URLSearchParams(location.search).has('draft');
  const [rooms, products] = await Promise.all([
    fetch('data/rooms.json').then(r => r.json()),
    fetch('data/products.json').then(r => r.json()),
  ]);
  const room = rooms.rooms[0];
  state.products = products.products;

  if (useDraft) {
    try {
      const draft = JSON.parse(localStorage.getItem('room-mask-draft') || 'null');
      for (const s of room.surfaces) if (draft && draft.surfaces && draft.surfaces[s.id] && draft.surfaces[s.id].length) s.polygons = draft.surfaces[s.id];
    } catch (e) { /* ignore */ }
  }

  const photo = await loadImage(room.image);
  const orig = $('cv-original'), res = $('cv-result');
  orig.width = res.width = photo.naturalWidth;
  orig.height = res.height = photo.naturalHeight;
  orig.getContext('2d').drawImage(photo, 0, 0);

  for (const s of room.surfaces) {
    const renderer = new SurfaceRenderer(photo, s, state.result);
    state.result = renderer.result; // all surfaces draw into one shared image
    state.entries.push({ surface: s, renderer, product: null, tex: null, params: null });
  }

  buildSurfaceChips();
  buildPins();
  bindControls();
  setActive(state.entries[0]);
  $('status').textContent = 'Pick a surface, then a product.';
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
    const [cx, cy] = polygonCentroid(e.surface.polygons);
    const pin = $('pin').cloneNode(true);
    pin.removeAttribute('id');
    pin.hidden = false;
    pin.style.left = cx * 100 + '%';
    pin.style.top = cy * 100 + '%';
    pin.querySelector('span').textContent = e.surface.label;
    pin.onclick = () => setActive(e);
    stage.appendChild(pin);
    e.pin = pin;
  }
  $('pin').remove();
}

function setActive(e) {
  state.active = e;
  state.entries.forEach(x => {
    x.chip.classList.toggle('active', x === e);
    x.pin.classList.toggle('focus', x === e);
  });
  buildProductList(state.products.filter(p => p.surfaceTypes.includes(e.surface.type)));
  if (e.params) syncAdjustUI(e.params);
}

function buildProductList(products) {
  const ul = $('product-list');
  ul.textContent = '';
  for (const p of products) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.innerHTML = `<img src="${p.texture}" alt=""><span>${p.name}</span>`;
    b.classList.toggle('selected', state.active.product === p);
    b.onclick = () => selectProduct(p);
    li.appendChild(b);
    ul.appendChild(li);
  }
}

async function selectProduct(p) {
  const e = state.active;
  e.product = p;
  e.params = {
    tileWidthPx: p.tileWidthPx, rotation: p.rotation, offset: [...p.offset],
    shadeStrength: e.surface.shadeStrength ?? 0.8,
  };
  buildProductList(state.products.filter(x => x.surfaceTypes.includes(e.surface.type)));
  syncAdjustUI(e.params);
  $('btn-compare').disabled = false;
  e.tex = await loadTexture(p);
  if (e.product !== p) return; // user switched meanwhile
  draw();
}

function draw() {
  const t0 = performance.now();
  let any = false;
  for (const e of state.entries) {
    if (e.product && e.tex) { e.renderer.render(e.tex, e.params); any = true; }
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
    for (const e of state.entries) { e.product = null; e.tex = null; e.params = null; e.renderer.clear(); }
    res.hidden = true;
    range.hidden = div.hidden = true;
    res.style.clipPath = '';
    $('btn-compare').classList.remove('on');
    $('btn-compare').disabled = true;
    buildProductList(state.products.filter(p => p.surfaceTypes.includes(state.active.surface.type)));
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
