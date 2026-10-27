

const SAM_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const SAM_MODEL = 'Xenova/slimsam-50-uniform';

class Sam {
  constructor() {
    this.lib = null;
    this.model = null;
    this.processor = null;
    this.raw = null;        // RawImage of the current photo
    this.inputs = null;     // processed image (sizes needed to scale clicks / masks)
    this.embeddings = null; // image embeddings for the current photo
    this.photoKey = null;
    this.loading = null;
    this.wasm = false; // forced fallback after a WebGPU failure
  }

  // Load library + model once. report(text) is called with progress messages.
  async load(report) {
    if (this.model) return;
    if (!this.loading) {
      this.loading = (async () => {
        report('Loading the AI library...');
        this.lib = await import(SAM_LIB);
        const files = {};
        const progress = d => {
          if (d.status !== 'progress' || !d.file) return;
          files[d.file] = d;
          const done = Object.values(files).reduce((a, f) => a + (f.loaded || 0), 0);
          const total = Object.values(files).reduce((a, f) => a + (f.total || 0), 0);
          if (total) report(`Downloading the AI model (first time only): ${Math.round((100 * done) / total)}% of ${(total / 1e6).toFixed(0)} MB`);
        };
        const gpuOpts = { device: 'webgpu', dtype: 'fp16', progress_callback: progress };
        const cpuOpts = { dtype: 'q8', progress_callback: progress };
        try {
          this.model = await this.lib.SamModel.from_pretrained(SAM_MODEL, navigator.gpu && !this.wasm ? gpuOpts : cpuOpts);
        } catch (e) {
          if (this.wasm || !navigator.gpu) throw e;
          this.wasm = true; // WebGPU model would not start: use the CPU one
          this.model = await this.lib.SamModel.from_pretrained(SAM_MODEL, cpuOpts);
        }
        this.processor = await this.lib.AutoProcessor.from_pretrained(SAM_MODEL);
      })();
      this.loading.catch(() => { this.loading = null; });
    }
    await this.loading;
  }

  // Analyse the photo (the slow part, once per photo).
  async setPhoto(src, key, report) {
    if (this.photoKey === key && this.embeddings) return;
    report('Analysing the photo (once per photo)...');
    try {
      this.raw = await this.lib.RawImage.read(src);
      this.inputs = await this.processor(this.raw);
      this.embeddings = await this.model.get_image_embeddings(this.inputs);
    } catch (e) {
      if (this.wasm || !navigator.gpu) throw e;
      // WebGPU unusable here (e.g. no fp16 support): reload the model on the CPU (WASM) and retry once
      this.wasm = true; this.model = null; this.processor = null; this.loading = null;
      report('WebGPU failed, switching to the slower CPU model...');
      await this.load(report);
      return this.setPhoto(src, key, report);
    }
    this.photoKey = key;
  }

  reset() { this.embeddings = null; this.photoKey = null; }

  // points: [{ x, y, label }] with x, y normalized 0..1 and label 1 (inside) / 0 (outside).
  // Returns { mask: Uint8Array(w*h), w, h } for the best-scoring mask.
  async segment(points) {
    const [rh, rw] = this.inputs.reshaped_input_sizes[0];
    const coords = points.flatMap(p => [p.x * rw, p.y * rh]);
    const labels = points.map(p => BigInt(p.label));
    const { Tensor } = this.lib;
    const out = await this.model({
      ...this.embeddings,
      input_points: new Tensor('float32', coords, [1, 1, points.length, 2]),
      input_labels: new Tensor('int64', labels, [1, 1, points.length]),
    });
    const masks = await this.processor.post_process_masks(out.pred_masks, this.inputs.original_sizes, this.inputs.reshaped_input_sizes);
    const m = masks[0]; // [1, 3, H, W]
    const [, n, h, w] = m.dims;
    const scores = Array.from(out.iou_scores.data);
    let best = 0;
    for (let i = 1; i < n; i++) if (scores[i] > scores[best]) best = i;
    const mask = new Uint8Array(w * h);
    const off = best * w * h;
    for (let i = 0; i < w * h; i++) mask[i] = m.data[off + i] ? 1 : 0;
    return { mask, w, h, score: scores[best] };
  }
}
