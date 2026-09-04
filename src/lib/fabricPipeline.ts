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

export type FabricCopyResponse = {
  swatchDataUrl: string;
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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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
  options: { seed?: number; rectify?: boolean; seamBlendPx?: number } = {},
): Promise<FabricCopyResponse> {
  return postJson<FabricCopyResponse>("/api/fabric/copy", {
    imageDataUrl,
    rect,
    seed: options.seed ?? null,
    rectify: options.rectify ?? true,
    seamBlendPx: options.seamBlendPx ?? 0,
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
