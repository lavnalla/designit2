/**
 * Edge-aware refinement of a segmentation mask.
 *
 * Selfie segmentation returns a low-resolution, soft boundary that rarely lands
 * exactly on the person — it floats several pixels off the shoulder and smears
 * through hair. A guided filter fixes that by treating the camera frame as a
 * guide: within each window it fits the mask to the image as a local linear
 * model, so the mask's transition gets pulled onto the frame's real gradients.
 *
 * This is He & Sun's *fast* guided filter — the linear coefficients are solved
 * on a downsampled copy and then upsampled, which is what makes it cheap enough
 * to run every frame.
 */

export interface MaskEdgeRegion {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MaskEdgeOptions {
  /**
   * Window radius in full-resolution pixels. The filter can only correct a
   * misalignment it can see, so this needs to be roughly twice the error you
   * expect to fix; measured against a soft boundary, radius 32 pulls a 12px
   * error to under a pixel while radius 8 barely moves it.
   */
  radius?: number;
  /** Regularization. Smaller follows the guide harder and keeps more noise. */
  epsilon?: number;
  /** Coefficients are solved at 1/subsample resolution. */
  subsample?: number;
  /**
   * Restricts the (expensive) full-resolution write to this box. Pixels outside
   * keep their original bytes, so only pass a region whose exterior is going to
   * be discarded anyway.
   */
  region?: MaskEdgeRegion;
}

const DEFAULT_RADIUS = 32;
const DEFAULT_EPSILON = 1e-4;
const DEFAULT_SUBSAMPLE = 4;
/** Below this peak the mask must be alpha-only, so confidence is read differently. */
const EMPTY_MASK_PEAK = 0.05;
/** Windows this uniform hold no edge to snap to, so the model is a no-op there. */
const SATURATED_HIGH = 0.999;
const SATURATED_LOW = 0.001;

/**
 * Reusable working buffers.
 *
 * This runs on every frame, and the low-resolution planes add up to well over a
 * megabyte per call. Allocating that per frame cost more than all the arithmetic
 * combined, so the buffers are held between calls and only reallocated when the
 * working resolution changes. Every buffer is fully overwritten before it is
 * read; the summed-area table's zero border is never written, so it stays zero
 * for the lifetime of the allocation.
 */
interface FilterScratch {
  lowWidth: number;
  lowHeight: number;
  planes: Float32Array[];
  table: Float64Array;
}

const SCRATCH_PLANE_COUNT = 12;
let scratch: FilterScratch | null = null;

function getScratch(lowWidth: number, lowHeight: number): FilterScratch {
  if (scratch && scratch.lowWidth === lowWidth && scratch.lowHeight === lowHeight) {
    return scratch;
  }
  const lowTotal = lowWidth * lowHeight;
  scratch = {
    lowWidth,
    lowHeight,
    planes: Array.from(
      { length: SCRATCH_PLANE_COUNT },
      () => new Float32Array(lowTotal),
    ),
    table: new Float64Array((lowWidth + 1) * (lowHeight + 1)),
  };
  return scratch;
}

/** Summed-area table into `table`, sized (width + 1) x (height + 1). */
function summedAreaTable(
  src: Float32Array,
  width: number,
  height: number,
  table: Float64Array,
): void {
  const stride = width + 1;
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const srcRow = y * width;
    const above = y * stride;
    const current = (y + 1) * stride;
    for (let x = 0; x < width; x += 1) {
      rowSum += src[srcRow + x];
      table[current + x + 1] = table[above + x + 1] + rowSum;
    }
  }
}

/**
 * Window bounds and reciprocal extents, shared by all six box filter passes.
 *
 * Window area varies only at the frame border, but recomputing it per pixel
 * means a division per pixel per pass. Precomputing turns the normalization into
 * two multiplies.
 */
interface BoxPlan {
  left: Int32Array;
  right: Int32Array;
  inverseColumns: Float32Array;
  top: Int32Array;
  bottom: Int32Array;
  inverseRows: Float32Array;
}

function planBoxFilter(width: number, height: number, radius: number): BoxPlan {
  const left = new Int32Array(width);
  const right = new Int32Array(width);
  const inverseColumns = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    const x0 = Math.max(0, x - radius);
    const x1 = Math.min(width - 1, x + radius);
    left[x] = x0;
    right[x] = x1;
    inverseColumns[x] = 1 / (x1 - x0 + 1);
  }

  const top = new Int32Array(height);
  const bottom = new Int32Array(height);
  const inverseRows = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    top[y] = y0;
    bottom[y] = y1;
    inverseRows[y] = 1 / (y1 - y0 + 1);
  }

  return { left, right, inverseColumns, top, bottom, inverseRows };
}

/** Mean over a (2r + 1)^2 window, normalized by the clipped window area. */
function boxFilter(
  src: Float32Array,
  width: number,
  height: number,
  table: Float64Array,
  plan: BoxPlan,
  out: Float32Array,
): Float32Array {
  summedAreaTable(src, width, height, table);
  const stride = width + 1;

  for (let y = 0; y < height; y += 1) {
    const top = plan.top[y] * stride;
    const bottom = (plan.bottom[y] + 1) * stride;
    const inverseRow = plan.inverseRows[y];
    const outRow = y * width;
    for (let x = 0; x < width; x += 1) {
      const x0 = plan.left[x];
      const x1 = plan.right[x] + 1;
      const sum = table[bottom + x1] - table[top + x1] - table[bottom + x0] + table[top + x0];
      out[outRow + x] = sum * inverseRow * plan.inverseColumns[x];
    }
  }

  return out;
}

/** True when the mask turned out to be alpha-only. */
type AlphaOnly = boolean;

/**
 * Builds the downsampled guide and mask planes by point-sampling the frame.
 *
 * Sampling rather than averaging every source pixel is what keeps this cheap:
 * at subsample 4 it touches a sixteenth of the frame. The box filter that
 * follows smooths over the aliasing this introduces, and nothing full-resolution
 * is retained — the apply step reads the guide straight from the ImageData.
 *
 * MediaPipe hands the mask back in one of a few encodings — grayscale on opaque
 * black, white on transparent, or confidence replicated across every channel.
 * The per-pixel minimum of red and alpha recovers the confidence in all three.
 * An alpha-only mask reads as empty, and is retried with the max.
 */
function buildLowResPlanes(
  mask: ImageData,
  guide: ImageData,
  width: number,
  height: number,
  subsample: number,
  lowWidth: number,
  lowHeight: number,
  guideLow: Float32Array,
  maskLow: Float32Array,
): AlphaOnly {
  const guideData = guide.data;
  const maskData = mask.data;
  // Two taps per axis, so each cell still sees inside its block.
  const half = subsample > 1 ? subsample >> 1 : 0;

  let peak = 0;
  for (let lowY = 0; lowY < lowHeight; lowY += 1) {
    const y0 = Math.min(height - 1, lowY * subsample);
    const y1 = Math.min(height - 1, y0 + half);
    const row0 = y0 * width;
    const row1 = y1 * width;
    const lowRow = lowY * lowWidth;

    for (let lowX = 0; lowX < lowWidth; lowX += 1) {
      const x0 = Math.min(width - 1, lowX * subsample);
      const x1 = Math.min(width - 1, x0 + half);

      let luma: number;
      let confidence: number;
      if (half === 0) {
        const offset = (row0 + x0) * 4;
        luma =
          guideData[offset] * 0.299 +
          guideData[offset + 1] * 0.587 +
          guideData[offset + 2] * 0.114;
        confidence = Math.min(maskData[offset], maskData[offset + 3]);
      } else {
        // Unrolled deliberately: a four-element array here allocates once per
        // cell and costs more than every other low-resolution pass combined.
        const a = (row0 + x0) * 4;
        const b = (row0 + x1) * 4;
        const c = (row1 + x0) * 4;
        const d = (row1 + x1) * 4;
        luma =
          (guideData[a] * 0.299 + guideData[a + 1] * 0.587 + guideData[a + 2] * 0.114 +
            guideData[b] * 0.299 + guideData[b + 1] * 0.587 + guideData[b + 2] * 0.114 +
            guideData[c] * 0.299 + guideData[c + 1] * 0.587 + guideData[c + 2] * 0.114 +
            guideData[d] * 0.299 + guideData[d + 1] * 0.587 + guideData[d + 2] * 0.114) /
          4;
        confidence =
          (Math.min(maskData[a], maskData[a + 3]) +
            Math.min(maskData[b], maskData[b + 3]) +
            Math.min(maskData[c], maskData[c + 3]) +
            Math.min(maskData[d], maskData[d + 3])) /
          4;
      }

      const cell = lowRow + lowX;
      guideLow[cell] = luma / 255;
      maskLow[cell] = confidence / 255;
      if (maskLow[cell] > peak) peak = maskLow[cell];
    }
  }

  if (peak >= EMPTY_MASK_PEAK) return false;

  for (let lowY = 0; lowY < lowHeight; lowY += 1) {
    const y0 = Math.min(height - 1, lowY * subsample);
    const row0 = y0 * width;
    const lowRow = lowY * lowWidth;
    for (let lowX = 0; lowX < lowWidth; lowX += 1) {
      const offset = (row0 + Math.min(width - 1, lowX * subsample)) * 4;
      maskLow[lowRow + lowX] = Math.max(maskData[offset], maskData[offset + 3]) / 255;
    }
  }

  return true;
}

/**
 * Snaps the mask boundary onto the guide frame's edges.
 *
 * Mutates and returns the supplied mask. Refined confidence is written to every
 * channel so downstream readers agree on it regardless of which they sample.
 */
export function refineMaskEdges(
  mask: ImageData,
  guide: ImageData,
  width: number,
  height: number,
  options: MaskEdgeOptions = {},
): ImageData {
  const radius = options.radius ?? DEFAULT_RADIUS;
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;
  const subsample = Math.max(1, Math.floor(options.subsample ?? DEFAULT_SUBSAMPLE));

  if (width < 2 || height < 2) return mask;

  const minX = Math.max(0, Math.floor(options.region?.minX ?? 0));
  const minY = Math.max(0, Math.floor(options.region?.minY ?? 0));
  const maxX = Math.min(width - 1, Math.ceil(options.region?.maxX ?? width - 1));
  const maxY = Math.min(height - 1, Math.ceil(options.region?.maxY ?? height - 1));
  if (maxX < minX || maxY < minY) return mask;

  const lowWidth = Math.max(1, Math.ceil(width / subsample));
  const lowHeight = Math.max(1, Math.ceil(height / subsample));
  const lowRadius = Math.max(1, Math.round(radius / subsample));
  const lowTotal = lowWidth * lowHeight;

  const { planes, table } = getScratch(lowWidth, lowHeight);
  const [
    guideLow,
    maskLow,
    guideSq,
    guideTimesMask,
    meanGuide,
    meanMask,
    meanGuideSq,
    meanGuideMask,
    slope,
    intercept,
    meanSlope,
    meanIntercept,
  ] = planes;

  const alphaOnly = buildLowResPlanes(
    mask,
    guide,
    width,
    height,
    subsample,
    lowWidth,
    lowHeight,
    guideLow,
    maskLow,
  );

  for (let cell = 0; cell < lowTotal; cell += 1) {
    const g = guideLow[cell];
    guideSq[cell] = g * g;
    guideTimesMask[cell] = g * maskLow[cell];
  }

  const plan = planBoxFilter(lowWidth, lowHeight, lowRadius);
  boxFilter(guideLow, lowWidth, lowHeight, table, plan, meanGuide);
  boxFilter(maskLow, lowWidth, lowHeight, table, plan, meanMask);
  boxFilter(guideSq, lowWidth, lowHeight, table, plan, meanGuideSq);
  boxFilter(guideTimesMask, lowWidth, lowHeight, table, plan, meanGuideMask);

  // Per-window linear model: mask ~= slope * guide + intercept.
  for (let cell = 0; cell < lowTotal; cell += 1) {
    const variance = meanGuideSq[cell] - meanGuide[cell] * meanGuide[cell];
    const covariance = meanGuideMask[cell] - meanGuide[cell] * meanMask[cell];
    const a = covariance / (variance + epsilon);
    slope[cell] = a;
    intercept[cell] = meanMask[cell] - a * meanGuide[cell];
  }

  boxFilter(slope, lowWidth, lowHeight, table, plan, meanSlope);
  boxFilter(intercept, lowWidth, lowHeight, table, plan, meanIntercept);

  // Per-column sampling weights, hoisted out of the inner loop.
  const columnCount = maxX - minX + 1;
  const colLeft = new Int32Array(columnCount);
  const colRight = new Int32Array(columnCount);
  const colWeight = new Float32Array(columnCount);
  for (let index = 0; index < columnCount; index += 1) {
    const source = subsample === 1 ? minX + index : (minX + index + 0.5) / subsample - 0.5;
    const clamped = source < 0 ? 0 : source > lowWidth - 1 ? lowWidth - 1 : source;
    const left = Math.floor(clamped);
    colLeft[index] = left;
    colRight[index] = Math.min(lowWidth - 1, left + 1);
    colWeight[index] = clamped - left;
  }

  const data = mask.data;
  const guideData = guide.data;
  for (let y = minY; y <= maxY; y += 1) {
    const sourceY = subsample === 1 ? y : (y + 0.5) / subsample - 0.5;
    const clampedY = sourceY < 0 ? 0 : sourceY > lowHeight - 1 ? lowHeight - 1 : sourceY;
    const top = Math.floor(clampedY);
    const bottom = Math.min(lowHeight - 1, top + 1);
    const rowWeight = clampedY - top;
    const inverseRowWeight = 1 - rowWeight;
    const topRow = top * lowWidth;
    const bottomRow = bottom * lowWidth;
    const pixelRow = y * width;

    for (let index = 0; index < columnCount; index += 1) {
      const left = colLeft[index];
      const right = colRight[index];

      // Deep interior and far background are already saturated, and the linear
      // model just reproduces them there, so skip straight to the constant.
      const neighbourhood = meanMask[topRow + left];
      if (neighbourhood > SATURATED_HIGH || neighbourhood < SATURATED_LOW) {
        const encoded = neighbourhood > SATURATED_HIGH ? 255 : 0;
        const offset = (pixelRow + minX + index) * 4;
        data[offset] = encoded;
        data[offset + 1] = encoded;
        data[offset + 2] = encoded;
        data[offset + 3] = encoded;
        continue;
      }

      const weight = colWeight[index];
      const inverseWeight = 1 - weight;

      const a =
        (meanSlope[topRow + left] * inverseWeight + meanSlope[topRow + right] * weight) *
          inverseRowWeight +
        (meanSlope[bottomRow + left] * inverseWeight +
          meanSlope[bottomRow + right] * weight) *
          rowWeight;
      const b =
        (meanIntercept[topRow + left] * inverseWeight +
          meanIntercept[topRow + right] * weight) *
          inverseRowWeight +
        (meanIntercept[bottomRow + left] * inverseWeight +
          meanIntercept[bottomRow + right] * weight) *
          rowWeight;

      const offset = (pixelRow + minX + index) * 4;
      const luma =
        (guideData[offset] * 0.299 +
          guideData[offset + 1] * 0.587 +
          guideData[offset + 2] * 0.114) /
        255;

      let value = a * luma + b;
      if (!Number.isFinite(value)) {
        // Fall back to this pixel's own confidence, still unwritten at this point.
        value =
          (alphaOnly
            ? Math.max(data[offset], data[offset + 3])
            : Math.min(data[offset], data[offset + 3])) / 255;
      }
      value = value < 0 ? 0 : value > 1 ? 1 : value;

      const encoded = (value * 255 + 0.5) | 0;
      data[offset] = encoded;
      data[offset + 1] = encoded;
      data[offset + 2] = encoded;
      data[offset + 3] = encoded;
    }
  }

  return mask;
}
