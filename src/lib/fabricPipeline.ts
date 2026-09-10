/**
 * Client for the four-stage fabric pipeline.
 *
 *   1. segment  -- pixel-accurate garment mask (SegFormer)
 *   2. rectify  -- flatten a wrinkled crop into a tileable swatch (FabricDiffusion)
 *   3. tile     -- repeat at a fixed pixels-per-centimetre ratio, never stretched
 *   4. blend    -- modulate by the destination's own shading to keep its drape
 *
 * Stages 1-2 run on copy and are cached; stages 1, 3 and 4 run on paste.
 * The heavy lifting is in fabric-pipeline-service/; this module only marshals
 * images to and from it.
 */

export type FabricClipboard = {
  /** Flat, tileable swatch produced by the diffusion stage. */
  swatchDataUrl: string;
  /** Pixel size of the original crop, needed to preserve its aspect on tiling. */
  cropWidth: number;
  cropHeight: number;
  /** Pixel density of the source photo, the numerator of the scale transfer. */
  srcPxPerCm: number;
  sourceGarment: string;
  sourceGarmentFound: boolean;
  sourceSilhouette: string;
  sourceScaleConfidence: number;
  sourceScaleNote: string;
  sourcePersonPresent: boolean;
  rectified: boolean;
  /** Raw crop, kept so the UI can show what was sampled. */
  rawCropDataUrl: string;
  /** True when the service moved the sample off a non-fabric region. */
  patchRelocated: boolean;
  patchReason: string;
};

/**
 * Quality tier for the flatten stage, mirrored from the service's runtime.py.
 * `auto` sends nothing and lets the service pick by hardware (full on a GPU,
 * fast on a CPU, classic when RAM is short).
 */
export type FabricQuality = "auto" | "classic" | "fast" | "full";

export const FABRIC_QUALITY_OPTIONS: { value: FabricQuality; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Server picks by hardware" },
  { value: "classic", label: "Instant", hint: "No AI pass; crisp, seamless, folds only de-shaded" },
  { value: "fast", label: "Fast", hint: "10-step AI flatten; ~10-25 s on a CPU" },
  { value: "full", label: "Best", hint: "20-step AI flatten; seconds on a GPU, ~30-60 s on a CPU" },
];

export type FabricCopyResponse = {
  swatchDataUrl: string;
  /** Tier actually used: full | fast | classic | raw. */
  quality: string;
  cropWidth: number;
  cropHeight: number;
  srcPxPerCm: number;
  sourceGarment: string;
  sourceGarmentFound: boolean;
  /** straight | flared | legged -- read from the mask's shape, not the class. */
  sourceSilhouette: string;
  sourceLandmark: string;
  /** 0..1. Low when the face and garment scale references disagree. */
  sourceScaleConfidence: number;
  sourceScaleSources: string[];
  sourceScaleNote: string;
  /** True when a face was found, i.e. a worn photo rather than a flat shot. */
  sourcePersonPresent: boolean;
  sourceCoverage: number;
  segmentSeconds: number;
  rectifySeconds: number;
  rectified: boolean;
  fromCache: boolean;
  /**
   * Where the fabric was actually sampled from. The service moves the sample
   * off necklines, straps and background, so this can differ from what was
   * selected — the UI says so rather than silently overriding the user.
   */
  patchRect: { x: number; y: number; width: number; height: number };
  patchCoverage: number;
  patchRelocated: boolean;
  patchReason: string;
};

export type FabricPasteResponse = {
  imageDataUrl: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  repeatsX: number;
  repeatsY: number;
  scaleRatio: number;
  dstPxPerCm: number;
  destGarment: string;
  destGarmentFound: boolean;
  destSilhouette: string;
  destLandmark: string;
  destScaleConfidence: number;
  destScaleNote: string;
  destCoverage: number;
  segmentSeconds: number;
};

export class FabricPipelineError extends Error {
  readonly hint?: string;
  readonly status: number;

  constructor(message: string, status: number, hint?: string) {
    super(message);
    this.name = "FabricPipelineError";
    this.status = status;
    this.hint = hint;
  }
}

/**
 * Upper bound on one pipeline call. Copy runs a 20-step diffusion on a 256px
 * patch (about 1.3 s warm on the RTX 3070, tens of seconds on a cold model),
 * so this is generous -- its job is to stop a hung service leaving the copy
 * and paste buttons disabled forever, not to police normal latency.
 */
export const FABRIC_REQUEST_TIMEOUT_MS = 120_000;

async function postJson<T>(url: string, body: unknown, timeoutMs: number = FABRIC_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new FabricPipelineError(
        `Fabric pipeline did not answer within ${Math.round(timeoutMs / 1000)}s`,
        0,
        "The fabric service is not responding. Check that it is running on port 8010.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fall through to the raw text below.
  }

  if (!res.ok) {
    const payload = parsed as { error?: string; details?: string; hint?: string } | null;
    throw new FabricPipelineError(
      payload?.error || text || `Request failed (${res.status})`,
      res.status,
      payload?.hint,
    );
  }

  return parsed as T;
}

/** Load an image and re-encode it as a PNG data URL, optionally resized. */
export function imageToDataUrl(src: string, width?: number, height?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = Math.max(1, Math.round(width || img.naturalWidth || img.width));
      const h = Math.max(1, Math.round(height || img.naturalHeight || img.height));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        // A cross-origin image taints the canvas and blocks the export.
        reject(error);
      }
    };
    img.onerror = () => reject(new Error(`Could not load image for fabric pipeline`));
    img.src = src;
  });
}

/**
 * Longest side the *source photo* is sent at. The segmenter runs at 1024px
 * or less anyway and the sampled crop is resized to 256px, so nothing above
 * this helps the result; what it does is keep a phone photo (often 12MP, tens
 * of MB as PNG) under the 4.5 MB request-body limit of a Vercel function and
 * off a slow upload. JPEG at this quality lands a 1280px photo around 300 KB.
 */
export const SOURCE_MAX_SIDE = 1280;
export const SOURCE_JPEG_QUALITY = 0.92;

export type BoundedImage = {
  dataUrl: string;
  width: number;
  height: number;
  /** Multiply natural-pixel coordinates by this to land in the sent image. */
  scale: number;
};

/**
 * Load an image and re-encode it no larger than `maxSide` on its longest
 * edge, as JPEG unless it needs transparency. Returns the scale factor so
 * callers can map a selection made in natural pixels onto what was sent.
 */
export function imageToBoundedDataUrl(
  src: string,
  maxSide: number = SOURCE_MAX_SIDE,
  quality: number = SOURCE_JPEG_QUALITY,
): Promise<BoundedImage> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const naturalW = Math.max(1, img.naturalWidth || img.width);
      const naturalH = Math.max(1, img.naturalHeight || img.height);
      const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
      const w = Math.max(1, Math.round(naturalW * scale));
      const h = Math.max(1, Math.round(naturalH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      try {
        // PNG sources may carry transparency the segmenter uses as background;
        // JPEG would flatten it to black. Keep PNG for those, JPEG otherwise.
        const isPng = /^data:image\/png|\.png(\?|$)/i.test(src);
        const dataUrl = isPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, width: w, height: h, scale });
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error("Could not load image for fabric pipeline"));
    img.src = src;
  });
}

/** Scale a rectangle given in natural pixels onto the bounded image. */
export function scaleRect(
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
): { x: number; y: number; width: number; height: number } {
  return { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale };
}

export function measureImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error("Could not measure image"));
    img.src = src;
  });
}

/**
 * Stages 1-2. `imageDataUrl` must be the *whole* source photo, not just the
 * crop: the garment has to be visible in full for its pixel density to be
 * estimated, and a lone patch carries no clue how big it is in the world.
 */
export async function runFabricCopy(
  imageDataUrl: string,
  rect: { x: number; y: number; width: number; height: number } | null,
  options: { seed?: number; rectify?: boolean; seamBlendPx?: number; quality?: FabricQuality } = {},
): Promise<FabricCopyResponse> {
  return postJson<FabricCopyResponse>("/api/fabric/copy", {
    imageDataUrl,
    rect,
    seed: options.seed ?? null,
    rectify: options.rectify ?? true,
    seamBlendPx: options.seamBlendPx ?? 0,
    quality: options.quality && options.quality !== "auto" ? options.quality : null,
  });
}

/**
 * Stages 1, 3 and 4. Returns an RGBA image sized exactly to
 * `targetWidth x targetHeight`, so the SVG <image> that displays it can sit at
 * 1:1 and its preserveAspectRatio="none" becomes a no-op rather than a stretch.
 */
export async function runFabricPaste(
  clipboard: FabricClipboard,
  destImageDataUrl: string,
  targetWidth: number,
  targetHeight: number,
  options: { multiplier?: number; shadingStrength?: number; featherPx?: number } = {},
): Promise<FabricPasteResponse> {
  return postJson<FabricPasteResponse>("/api/fabric/paste", {
    swatchDataUrl: clipboard.swatchDataUrl,
    destImageDataUrl,
    cropWidth: clipboard.cropWidth,
    cropHeight: clipboard.cropHeight,
    srcPxPerCm: clipboard.srcPxPerCm,
    multiplier: options.multiplier ?? 1.0,
    shadingStrength: options.shadingStrength ?? 1.0,
    featherPx: options.featherPx ?? 2,
    targetWidth: Math.max(1, Math.round(targetWidth)),
    targetHeight: Math.max(1, Math.round(targetHeight)),
  });
}
