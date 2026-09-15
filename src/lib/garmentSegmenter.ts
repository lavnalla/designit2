// Runs the garment part segmentation model (sayeed99/segformer-b3-fashion,
// exported to ONNX by tools/export_garment_model.py) directly in the
// browser via onnxruntime-web. No server/Python process involved, so this
// works the same on Vercel as it does locally.
//
// Model input:  "pixel_values", float32 [1, 3, 512, 512], ImageNet-normalized
// Model output: "logits", float32 [1, 47, 128, 128] (47 fashion classes)

import type { GarmentPart } from "../components/GarmentPartPainter";

const MODEL_URL = "/models/garment-segformer/model.onnx";
const ONNXRUNTIME_WEB_VERSION = "1.17.3";
const INPUT_SIZE = 512;

const IMAGE_MEAN = [0.485, 0.456, 0.406];
const IMAGE_STD = [0.229, 0.224, 0.225];

// Same class-id mapping as the original Python script.
const ARM_CLASS_IDS = new Set([32]); // sleeve
const BODY_CLASS_IDS = new Set([1, 2, 3, 4, 5, 6, 10, 11, 12, 13]); // shirt/top/sweater/cardigan/jacket/vest/coat/dress/jumpsuit/cape
const NECK_CLASS_IDS = new Set([29, 34]); // collar, neckline
const SHOULDER_CLASS_IDS = new Set([31]); // epaulette (only shoulder-ish class this model has)

const PART_COLORS: Record<GarmentPart, [number, number, number]> = {
  arm: [255, 0, 0],
  body: [0, 255, 0],
  neck: [0, 0, 255],
  shoulders: [255, 255, 0],
};

function classifyLabelId(id: number): GarmentPart | null {
  if (ARM_CLASS_IDS.has(id)) return "arm";
  if (BODY_CLASS_IDS.has(id)) return "body";
  if (NECK_CLASS_IDS.has(id)) return "neck";
  if (SHOULDER_CLASS_IDS.has(id)) return "shoulders";
  return null;
}

export type GarmentSegmentResult = {
  maskDataUrl: string;
  width: number;
  height: number;
  detectedParts: GarmentPart[];
};

let ortModulePromise: Promise<typeof import("onnxruntime-web")> | null = null;
let sessionPromise: Promise<import("onnxruntime-web").InferenceSession> | null = null;

async function getOrt() {
  if (!ortModulePromise) {
    ortModulePromise = import("onnxruntime-web").then((ort) => {
      // onnxruntime-web needs its .wasm runtime files; load them from the
      // same CDN pattern already used elsewhere in this app for MediaPipe's
      // WASM assets, rather than wiring up bundler asset copying.
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_WEB_VERSION}/dist/`;
      return ort;
    });
  }
  return ortModulePromise;
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = getOrt().then((ort) =>
      ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
      }),
    );
  }
  return sessionPromise;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for garment segmentation"));
    img.src = src;
  });
}

/** Resize the image to the model's expected input size and build a
 * normalized, channel-planar [1,3,512,512] float32 tensor. */
function buildInputTensor(img: HTMLImageElement, ort: typeof import("onnxruntime-web")) {
  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create canvas context");
  ctx.drawImage(img, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  const floatData = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    floatData[i] = (r - IMAGE_MEAN[0]) / IMAGE_STD[0];
    floatData[plane + i] = (g - IMAGE_MEAN[1]) / IMAGE_STD[1];
    floatData[2 * plane + i] = (b - IMAGE_MEAN[2]) / IMAGE_STD[2];
  }

  return new ort.Tensor("float32", floatData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

export async function detectGarmentParts(imageDataUrl: string): Promise<GarmentSegmentResult> {
  const [ort, session, img] = await Promise.all([getOrt(), getSession(), loadImage(imageDataUrl)]);

  const inputTensor = buildInputTensor(img, ort);
  const outputs = await session.run({ pixel_values: inputTensor });
  const logits = outputs.logits;
  const [, numClasses, outH, outW] = logits.dims as number[];
  const logitsData = logits.data as Float32Array;
  const plane = outH * outW;

  // Argmax across the class dimension for every low-res pixel.
  const classMap = new Int32Array(plane);
  for (let p = 0; p < plane; p++) {
    let bestClass = 0;
    let bestVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const v = logitsData[c * plane + p];
      if (v > bestVal) {
        bestVal = v;
        bestClass = c;
      }
    }
    classMap[p] = bestClass;
  }

  // Paint the low-res class map onto a small canvas, then let the browser's
  // own image scaling upsample it to the original image size (approximates
  // the bilinear upsampling the Python version did explicitly).
  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = outW;
  smallCanvas.height = outH;
  const smallCtx = smallCanvas.getContext("2d");
  if (!smallCtx) throw new Error("Could not create canvas context");
  const smallImageData = smallCtx.createImageData(outW, outH);
  const detectedParts = new Set<GarmentPart>();

  for (let p = 0; p < plane; p++) {
    const part = classifyLabelId(classMap[p]);
    const idx = p * 4;
    if (part) {
      detectedParts.add(part);
      const [r, g, b] = PART_COLORS[part];
      smallImageData.data[idx] = r;
      smallImageData.data[idx + 1] = g;
      smallImageData.data[idx + 2] = b;
      smallImageData.data[idx + 3] = 255;
    } else {
      smallImageData.data[idx + 3] = 0;
    }
  }
  smallCtx.putImageData(smallImageData, 0, 0);

  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Could not create canvas context");
  outCtx.imageSmoothingEnabled = true;
  outCtx.drawImage(smallCanvas, 0, 0, width, height);

  return {
    maskDataUrl: outCanvas.toDataURL("image/png"),
    width,
    height,
    detectedParts: Array.from(detectedParts),
  };
}
