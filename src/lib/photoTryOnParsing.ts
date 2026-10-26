// Parses a photo for photoTryOn.ts, in the browser: fashion classes per pixel (the SegFormer model in
// garmentSegmenter.ts, on this thread), and human classes per pixel and the pose (MediaPipe, in
// photoParse.worker.ts: in a worker of its own so it can't collide with the page's older MediaPipe
// solutions).

import { parseFashionClasses } from "./garmentSegmenter";
import type { Landmark, PhotoParse } from "./photoTryOn";

// Photos are parsed (and tried on) at most this many pixels on the long side
export const PARSE_MAX_SIDE = 1024;

type HumanReply = { id: number; human?: Uint8Array; pose?: Landmark[] | null; error?: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (r: HumanReply) => void; reject: (e: Error) => void }>();

// The parsing worker, started once and kept (it keeps its models loaded between photos)
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./photoParse.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<HumanReply>) => {
      const request = pending.get(e.data.id);
      if (!request) return;
      pending.delete(e.data.id);
      if (e.data.error) request.reject(new Error(e.data.error));
      else request.resolve(e.data);
    };
    worker.onerror = (e) => {
      // A worker that failed to start can't answer: fail everything waiting, and start afresh next time
      for (const request of pending.values()) request.reject(new Error(e.message || "Photo parsing failed"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function parseHumanAndPose(image: ImageData): Promise<{ human: Uint8Array; pose: Landmark[] | null }> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (r) => resolve({ human: r.human!, pose: r.pose ?? null }),
      reject,
    });
    const data = new Uint8ClampedArray(image.data);
    getWorker().postMessage({ id, data, width: image.width, height: image.height }, [data.buffer]);
  });
}

// The image on a white canvas (transparent cut-outs become white), scaled down to fit maxSide
export function toParseCanvas(img: CanvasImageSource & { width: number; height: number }, maxSide = PARSE_MAX_SIDE) {
  const source = img as HTMLImageElement;
  const iw = source.naturalWidth || img.width;
  const ih = source.naturalHeight || img.height;
  const fit = Math.min(1, maxSide / Math.max(iw, ih));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(iw * fit));
  canvas.height = Math.max(1, Math.round(ih * fit));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

// Everything photoTryOn needs to know about a photo (already drawn on a canvas by toParseCanvas)
export async function parsePhoto(canvas: HTMLCanvasElement): Promise<PhotoParse> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D canvas context");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const [fashion, { human, pose }] = await Promise.all([parseFashionClasses(canvas), parseHumanAndPose(imageData)]);
  return {
    image: { data: imageData.data, width: canvas.width, height: canvas.height },
    fashion,
    human,
    pose,
  };
}
