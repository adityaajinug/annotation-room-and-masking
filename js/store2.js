// Project storage for admin-2 / view-2.
// Meta (surfaces, dots, polygons, texture settings) and the binary images are kept in IndexedDB,
// so uploads survive refreshes and are shared between admin-2.html and view-2.html (same origin).
// "Export JSON" bundles everything (images as data URLs) into one file; put that file at
// data/project.json to ship it as the permanent version (view-2 falls back to it when IndexedDB is empty).
//
// project = { version, image: Blob|url, surfaces: [...], textures: [{id, name, tileWidthPx, rotation, offset, src: Blob|url}] }
//   surface = { id, label, pin: [x, y] | null, polygons: [{mode, points}], feather, shadeBlur, shadeStrength, planeAspect? }

const Store = (() => {
  let dbp;
  const db = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('room-texture-2', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
    });
  };
  const get = k => tx('readonly', s => s.get(k));
  const put = (k, v) => tx('readwrite', s => s.put(v, k));
  const del = k => tx('readwrite', s => s.delete(k));

  const empty = () => ({ version: 2, image: null, surfaces: [], textures: [] });
  const newId = p => p + Math.random().toString(36).slice(2, 8);

  const metaOf = p => ({
    version: 2,
    surfaces: p.surfaces,
    textures: p.textures.map(({ src, ...t }) => t),
  });

  async function saveMeta(p) { await put('meta', metaOf(p)); }

  // Write everything (used after import / first edit of a project that came from a file).
  async function saveAll(p) {
    await clear();
    if (p.image) await put('image', p.image);
    for (const t of p.textures) await put('tex:' + t.id, t.src);
    await saveMeta(p);
  }

  async function clear() {
    const d = await db();
    await new Promise((res, rej) => {
      const t = d.transaction('kv', 'readwrite');
      t.objectStore('kv').clear();
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    textureCache.clear();
  }

  const setImage = blob => put('image', blob);
  const setTexture = (id, blob) => put('tex:' + id, blob);
  const removeTexture = id => { textureCache.delete(id); return del('tex:' + id); };

  async function load() {
    const meta = await get('meta');
    if (meta) {
      const image = (await get('image')) || null;
      const textures = await Promise.all(meta.textures.map(async t => ({ ...t, src: await get('tex:' + t.id) })));
      return { ...empty(), ...meta, image, textures: textures.filter(t => t.src), fromFile: false };
    }
    try { // nothing saved in this browser: use the shipped data/project.json if there is one
      const r = await fetch('data/project.json', { cache: 'no-store' });
      if (r.ok) return { ...(await fromJson(await r.json())), fromFile: true };
    } catch (e) { /* no file, that's fine */ }
    return null;
  }

  // ---- URLs / images ----
  const urls = new WeakMap();
  function urlOf(src) {
    if (typeof src === 'string') return src;
    if (!urls.has(src)) urls.set(src, URL.createObjectURL(src));
    return urls.get(src);
  }

  const textureCache = new Map(); // id -> Promise<HTMLImageElement>
  function textureImage(t) {
    if (!textureCache.has(t.id)) {
      textureCache.set(t.id, new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Cannot load texture ' + t.name));
        img.src = urlOf(t.src);
      }));
    }
    return textureCache.get(t.id);
  }

  // Downscale big uploads so mask/render stay fast. Returns the original file when already small.
  async function fitImage(file, max) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && /^image\/(jpeg|png|webp)$/.test(file.type)) { bmp.close(); return file; }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
  }

  // ---- JSON export / import ----
  const toDataUrl = async src => {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  };
  const fromSrc = async s => (typeof s === 'string' && s.startsWith('data:') ? (await fetch(s)).blob() : s);

  async function toJson(p) {
    return {
      ...metaOf(p),
      image: p.image ? await toDataUrl(p.image) : null,
      textures: await Promise.all(p.textures.map(async t => ({ ...metaOf(p).textures.find(m => m.id === t.id), src: await toDataUrl(t.src) }))),
    };
  }

  async function fromJson(j) {
    if (!j || !Array.isArray(j.surfaces)) throw new Error('Not a project JSON (no "surfaces").');
    return {
      ...empty(),
      surfaces: j.surfaces.map(s => ({ feather: 1.5, shadeBlur: 30, shadeStrength: 0.8, pin: null, polygons: [], ...s })),
      image: await fromSrc(j.image),
      textures: await Promise.all((j.textures || []).map(async t => ({
        tileWidthPx: 400, rotation: 0, offset: [0, 0], ...t, src: await fromSrc(t.src),
      }))),
    };
  }

  return { empty, newId, load, saveMeta, saveAll, clear, setImage, setTexture, removeTexture, urlOf, textureImage, fitImage, toJson, fromJson };
})();

// Which textures a surface offers: surface.textureIds (array) or, when unset, all of them.
function surfaceAllows(surface, texture) {
  return !surface.textureIds || surface.textureIds.includes(texture.id);
}

// Photo centre of a surface's dot: the manual pin, else the middle of its Include shapes.
function pinOf(surface) {
  return surface.pin || polygonCentroid(surface.polygons);
}
