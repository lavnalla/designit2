// Runs MediaPipe's human parsing (multiclass selfie segmenter: background, hair, body skin, face skin,
// clothes, other) and pose landmarker for photoTryOnParsing.ts, in a worker of its own: the page's older
// MediaPipe solutions (holistic, selfie segmentation) keep their wasm runtime on the page's global `Module`,
// which tasks-vision's loader would otherwise collide with. Model files are served from /static-libs.
//
// Message in: { id, data, width, height } (RGBA pixels). Message out: { id, human, pose } or { id, error }.

import { FilesetResolver, ImageSegmenter, PoseLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH = "/static-libs/tasks-vision";
const SEGMENTER_MODEL = "/static-libs/selfie_multiclass_256x256.tflite";
const POSE_MODEL = "/static-libs/pose_landmarker_full.task";
const HUMAN_CLASSES = 6;

// tasks-vision's wasm glue comes in two builds: a classic script (loaded with importScripts in a classic
// worker) and an ES module (loaded with import() in a module worker). The bundler decides which kind of
// worker this is, so check: importScripts() with nothing to load does nothing in a classic worker and throws
// in a module worker.
const isModuleWorker = (() => {
  try {
    (self as unknown as { importScripts: () => void }).importScripts();
    return false;
  } catch {
    return true;
  }
})();
// In a module worker tasks-vision imports its glue through this hook: a plain runtime import() the bundler
// leaves alone
(self as unknown as { import: (url: string) => Promise<unknown> }).import = (url: string) =>
  import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);

let modelsPromise: Promise<{ segmenter: ImageSegmenter; pose: PoseLandmarker }> | null = null;

function getModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH, isModuleWorker);
      const segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate: "CPU" },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      const pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: "CPU" },
        runningMode: "IMAGE",
        numPoses: 1,
      });
      return { segmenter, pose };
    })();
    modelsPromise.catch(() => {
      modelsPromise = null;
    });
  }
  return modelsPromise;
}

// Confidences of the six human classes for every pixel of the image, resampled from the model's output
function humanConfidences(segmenter: ImageSegmenter, image: ImageData): Float32Array {
  const { width: w, height: h } = image;
  const out = new Float32Array(w * h * HUMAN_CLASSES);
  segmenter.segment(image, (result) => {
    const masks = result.confidenceMasks ?? [];
    for (let c = 0; c < Math.min(HUMAN_CLASSES, masks.length); c += 1) {
      const mask = masks[c];
      const data = mask.getAsFloat32Array();
      const mw = mask.width;
      const mh = mask.height;
      for (let y = 0; y < h; y += 1) {
        const sy = Math.min(mh - 1, Math.max(0, ((y + 0.5) * mh) / h - 0.5));
        const y0 = Math.floor(sy);
        const y1 = Math.min(mh - 1, y0 + 1);
        const fy = sy - y0;
        for (let x = 0; x < w; x += 1) {
          const sx = Math.min(mw - 1, Math.max(0, ((x + 0.5) * mw) / w - 0.5));
          const x0 = Math.floor(sx);
          const x1 = Math.min(mw - 1, x0 + 1);
          const fx = sx - x0;
          const v =
            (data[y0 * mw + x0] * (1 - fx) + data[y0 * mw + x1] * fx) * (1 - fy) +
            (data[y1 * mw + x0] * (1 - fx) + data[y1 * mw + x1] * fx) * fy;
          out[(y * w + x) * HUMAN_CLASSES + c] = v;
        }
      }
    }
  });
  return out;
}

// A square crop of the image
function crop(image: ImageData, left: number, top: number, side: number): ImageData {
  const out = new ImageData(side, side);
  for (let y = 0; y < side; y += 1) {
    const from = ((top + y) * image.width + left) * 4;
    out.data.set(image.data.subarray(from, from + side * 4), y * side * 4);
  }
  return out;
}

// Human class per pixel. The model squeezes the whole photo into 256x256, which blurs a tall full-length
// photo, so it's also run on overlapping square tiles along the long side, and the two are averaged.
function parseHuman(segmenter: ImageSegmenter, image: ImageData): Uint8Array {
  const { width: w, height: h } = image;
  const whole = humanConfidences(segmenter, image);
  const side = Math.min(w, h);
  const long = Math.max(w, h);
  const vertical = h >= w;
  const tiled = new Float32Array(w * h * HUMAN_CLASSES);
  const weight = new Float32Array(w * h);
  const count = long > side ? Math.ceil((long - side) / (side * 0.5)) + 1 : 1;
  // Each tile counts less toward its own edges, so tiles blend where they overlap
  const ramp = (i: number) => Math.min(1, Math.min(i + 1, side - i) / (side * 0.25));
  for (let t = 0; t < count; t += 1) {
    const offset = count === 1 ? 0 : Math.round(((long - side) * t) / (count - 1));
    const conf = humanConfidences(segmenter, crop(image, vertical ? 0 : offset, vertical ? offset : 0, side));
    for (let ty = 0; ty < side; ty += 1) {
      for (let tx = 0; tx < side; tx += 1) {
        const x = vertical ? tx : tx + offset;
        const y = vertical ? ty + offset : ty;
        const r = ramp(vertical ? ty : tx);
        const p = y * w + x;
        weight[p] += r;
        for (let c = 0; c < HUMAN_CLASSES; c += 1) tiled[p * HUMAN_CLASSES + c] += conf[(ty * side + tx) * HUMAN_CLASSES + c] * r;
      }
    }
  }
  const human = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) {
    let best = 0;
    let bestValue = -Infinity;
    for (let c = 0; c < HUMAN_CLASSES; c += 1) {
      const v = whole[p * HUMAN_CLASSES + c] + tiled[p * HUMAN_CLASSES + c] / Math.max(1e-6, weight[p]);
      if (v > bestValue) {
        bestValue = v;
        best = c;
      }
    }
    human[p] = best;
  }
  return human;
}

self.onmessage = async (e: MessageEvent<{ id: number; data: Uint8ClampedArray; width: number; height: number }>) => {
  const { id, data, width, height } = e.data;
  try {
    const { segmenter, pose } = await getModels();
    const image = new ImageData(new Uint8ClampedArray(data), width, height);
    const human = parseHuman(segmenter, image);
    const landmarks = pose.detect(image).landmarks[0] ?? null;
    (self as unknown as Worker).postMessage(
      {
        id,
        human,
        pose: landmarks ? landmarks.map((l) => ({ x: l.x, y: l.y, visibility: l.visibility })) : null,
      },
      [human.buffer],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
