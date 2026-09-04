import type { UpperBodyPoints } from "@/src/utils/bodyLandmarks";

export interface SilhouetteSpan {
  left: number;
  right: number;
}

const PERSON_LUMA_THRESHOLD = 128;

function isPersonPixel(data: Uint8ClampedArray, offset: number) {
  return data[offset] > PERSON_LUMA_THRESHOLD || data[offset + 3] > PERSON_LUMA_THRESHOLD;
}

export function rasterizePersonMask(
  workCanvas: HTMLCanvasElement,
  mask: CanvasImageSource,
  width: number,
  height: number,
): ImageData | null {
  if (workCanvas.width !== width) workCanvas.width = width;
  if (workCanvas.height !== height) workCanvas.height = height;

  const context = workCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.clearRect(0, 0, width, height);
  context.drawImage(mask, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

export function silhouetteSpanAtY(
  imageData: ImageData,
  y: number,
  width: number,
  height: number,
): SilhouetteSpan | null {
  const row = Math.max(0, Math.min(height - 1, Math.round(y)));
  const data = imageData.data;
  let left = -1;
  let right = -1;
  const rowStart = row * width * 4;

  for (let x = 0; x < width; x += 1) {
    if (!isPersonPixel(data, rowStart + x * 4)) continue;
    if (left < 0) left = x;
    right = x;
  }

  if (left < 0 || right <= left) return null;
  return { left, right };
}

interface Vec {
  x: number;
  y: number;
}

/** Generous padding so sleeves, hair, and loose clothing survive the gate. */
const HEAD_RADIUS_TO_SHOULDER = 0.72;
const HEAD_LIFT_TO_SHOULDER = 0.55;
/** Arms taper: an upper arm near the deltoid is far thicker than a wrist. */
const ARM_RADIUS_AT_SHOULDER = 0.34;
const ARM_RADIUS_AT_ELBOW = 0.26;
const ARM_RADIUS_AT_WRIST = 0.2;
/**
 * Bounds for growing the mask outward into limbs the landmarks did not describe.
 *
 * Sizing a blind disc around the shoulder does not work — one big enough to
 * hold a raised arm also swallows the wall and furniture behind it. Shape is
 * the discriminator instead: an arm is thin and attached to the body, while a
 * chair or cabinet is a bulky blob. So growth is allowed only through mask that
 * is within arm's reach, connected to the confident body, and no thicker than a
 * limb.
 */
const ARM_REACH_TO_SHOULDER = 1.45;
const FOREARM_REACH_TO_SHOULDER = 0.8;
/**
 * Half-width of the fattest thing growth will call a limb, against the
 * inter-shoulder distance. An upper arm in a sleeve runs about 0.18 of it, so
 * this leaves room for a foreshortened pose shrinking the shoulder span.
 */
const LIMB_THICKNESS_TO_SHOULDER = 0.3;
const TORSO_SIDE_PAD = 0.16;
const TORSO_TOP_PAD = 0.14;
const TORSO_BOTTOM_PAD = 0.45;
/** Coarse grid the body/furniture gate runs on, for frames big enough to need it. */
const GATE_GRID_STEP = 2;
const GATE_GRID_MIN_WIDTH = 320;

function toCanvas(point: { x: number; y: number }, width: number, height: number): Vec {
  return { x: point.x * width, y: point.y * height };
}

function unitBetween(from: Vec, to: Vec, fallback: Vec): Vec {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return fallback;
  return { x: dx / length, y: dy / length };
}

function add(point: Vec, direction: Vec, amount: number): Vec {
  return { x: point.x + direction.x * amount, y: point.y + direction.y * amount };
}

/** Convex polygon test via consistent cross-product sign. */
function pointInPolygon(px: number, py: number, polygon: Vec[]): boolean {
  let positive = false;
  let negative = false;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross > 0) positive = true;
    else if (cross < 0) negative = true;
    if (positive && negative) return false;
  }
  return true;
}

interface Disc {
  center: Vec;
  radius: number;
  radiusSq: number;
}

/** Capsule whose radius interpolates from `a` to `b`. */
interface Capsule {
  a: Vec;
  b: Vec;
  radiusA: number;
  radiusB: number;
}

interface LimbReach {
  center: Vec;
  radiusSq: number;
}

interface BodyEnvelope {
  discs: Disc[];
  torso: Vec[];
  limbs: Capsule[];
  seeds: Vec[];
  /**
   * Where limb growth may start, and how far it may run.
   *
   * Only limbs the landmarks failed to describe get an anchor. An arm with a
   * traced elbow and wrist is already covered by capsules, so growing beyond
   * them would buy nothing and risk absorbing whatever the arm is resting on.
   */
  reachAnchors: LimbReach[];
  limbThickness: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function disc(center: Vec, radius: number): Disc {
  return { center, radius, radiusSq: radius * radius };
}

function buildBodyEnvelope(
  points: UpperBodyPoints,
  width: number,
  height: number,
): BodyEnvelope | null {
  const { leftShoulder, rightShoulder } = points;
  if (!leftShoulder || !rightShoulder) return null;

  const leftShoulderPx = toCanvas(leftShoulder, width, height);
  const rightShoulderPx = toCanvas(rightShoulder, width, height);
  const shoulderWidth = Math.hypot(
    rightShoulderPx.x - leftShoulderPx.x,
    rightShoulderPx.y - leftShoulderPx.y,
  );
  if (shoulderWidth < 8) return null;

  const shoulderMid = {
    x: (leftShoulderPx.x + rightShoulderPx.x) / 2,
    y: (leftShoulderPx.y + rightShoulderPx.y) / 2,
  };
  const leftHipPx = points.leftHip ? toCanvas(points.leftHip, width, height) : null;
  const rightHipPx = points.rightHip ? toCanvas(points.rightHip, width, height) : null;
  const hipMid =
    leftHipPx && rightHipPx
      ? { x: (leftHipPx.x + rightHipPx.x) / 2, y: (leftHipPx.y + rightHipPx.y) / 2 }
      : { x: shoulderMid.x, y: shoulderMid.y + shoulderWidth * 1.5 };

  const down = unitBetween(shoulderMid, hipMid, { x: 0, y: 1 });
  const up = { x: -down.x, y: -down.y };
  // Lateral axis runs along the shoulder line, oriented left-to-right in image space.
  const lateral = unitBetween(leftShoulderPx, rightShoulderPx, { x: 1, y: 0 });
  const toRight = lateral.x >= 0 ? lateral : { x: -lateral.x, y: -lateral.y };
  const toLeft = { x: -toRight.x, y: -toRight.y };

  const neckPx = points.neck ? toCanvas(points.neck, width, height) : shoulderMid;
  const outerLeft = points.leftShoulderOuter
    ? toCanvas(points.leftShoulderOuter, width, height)
    : add(leftShoulderPx, toLeft, shoulderWidth * 0.175);
  const outerRight = points.rightShoulderOuter
    ? toCanvas(points.rightShoulderOuter, width, height)
    : add(rightShoulderPx, toRight, shoulderWidth * 0.175);
  // Outers follow the person's sides, which may be flipped in image space.
  const imageLeftOuter = outerLeft.x <= outerRight.x ? outerLeft : outerRight;
  const imageRightOuter = outerLeft.x <= outerRight.x ? outerRight : outerLeft;

  const sidePad = shoulderWidth * TORSO_SIDE_PAD;
  const topPad = shoulderWidth * TORSO_TOP_PAD;
  const bottomPad = shoulderWidth * TORSO_BOTTOM_PAD;
  const hipLeft = leftHipPx && rightHipPx
    ? (leftHipPx.x <= rightHipPx.x ? leftHipPx : rightHipPx)
    : add(hipMid, toLeft, shoulderWidth * 0.55);
  const hipRight = leftHipPx && rightHipPx
    ? (leftHipPx.x <= rightHipPx.x ? rightHipPx : leftHipPx)
    : add(hipMid, toRight, shoulderWidth * 0.55);

  const torso: Vec[] = [
    add(add(imageLeftOuter, toLeft, sidePad), up, topPad),
    add(add(imageRightOuter, toRight, sidePad), up, topPad),
    add(add(hipRight, toRight, sidePad * 1.2), down, bottomPad),
    add(add(hipLeft, toLeft, sidePad * 1.2), down, bottomPad),
  ];

  const shoulderRadius = shoulderWidth * ARM_RADIUS_AT_SHOULDER;
  const discs: Disc[] = [
    disc(
      add(neckPx, up, shoulderWidth * HEAD_LIFT_TO_SHOULDER),
      shoulderWidth * HEAD_RADIUS_TO_SHOULDER,
    ),
  ];
  const limbs: Capsule[] = [
    {
      a: leftShoulderPx,
      b: outerLeft,
      radiusA: shoulderRadius,
      radiusB: shoulderRadius,
    },
    {
      a: rightShoulderPx,
      b: outerRight,
      radiusA: shoulderRadius,
      radiusB: shoulderRadius,
    },
  ];

  const reachAnchors: LimbReach[] = [];
  const anchor = (center: Vec, radius: number) => {
    reachAnchors.push({ center, radiusSq: radius * radius });
  };

  const chain = (
    shoulder: Vec,
    elbow: { x: number; y: number } | undefined,
    wrist: { x: number; y: number } | undefined,
  ) => {
    // Where a joint is missing the limb is handed to the growth pass, anchored
    // at the last joint we do know so the search stays as tight as possible.
    if (!elbow) {
      anchor(shoulder, shoulderWidth * ARM_REACH_TO_SHOULDER);
      return;
    }
    const elbowPx = toCanvas(elbow, width, height);
    limbs.push({
      a: shoulder,
      b: elbowPx,
      radiusA: shoulderRadius,
      radiusB: shoulderWidth * ARM_RADIUS_AT_ELBOW,
    });
    if (!wrist) {
      anchor(elbowPx, shoulderWidth * FOREARM_REACH_TO_SHOULDER);
      return;
    }
    limbs.push({
      a: elbowPx,
      b: toCanvas(wrist, width, height),
      radiusA: shoulderWidth * ARM_RADIUS_AT_ELBOW,
      radiusB: shoulderWidth * ARM_RADIUS_AT_WRIST,
    });
  };
  chain(outerLeft, points.leftElbow, points.leftWrist);
  chain(outerRight, points.rightElbow, points.rightWrist);

  let minX = Math.min(...torso.map((point) => point.x));
  let maxX = Math.max(...torso.map((point) => point.x));
  let minY = Math.min(...torso.map((point) => point.y));
  let maxY = Math.max(...torso.map((point) => point.y));
  for (const shape of discs) {
    minX = Math.min(minX, shape.center.x - shape.radius);
    maxX = Math.max(maxX, shape.center.x + shape.radius);
    minY = Math.min(minY, shape.center.y - shape.radius);
    maxY = Math.max(maxY, shape.center.y + shape.radius);
  }
  for (const limb of limbs) {
    const radius = Math.max(limb.radiusA, limb.radiusB);
    minX = Math.min(minX, limb.a.x - radius, limb.b.x - radius);
    maxX = Math.max(maxX, limb.a.x + radius, limb.b.x + radius);
    minY = Math.min(minY, limb.a.y - radius, limb.b.y - radius);
    maxY = Math.max(maxY, limb.a.y + radius, limb.b.y + radius);
  }

  const torsoCenter = points.torsoCenter
    ? toCanvas(points.torsoCenter, width, height)
    : { x: (shoulderMid.x + hipMid.x) / 2, y: (shoulderMid.y + hipMid.y) / 2 };

  return {
    discs,
    torso,
    limbs,
    reachAnchors,
    limbThickness: shoulderWidth * LIMB_THICKNESS_TO_SHOULDER,
    seeds: [torsoCenter, shoulderMid, neckPx, hipMid, discs[0].center],
    minX: Math.max(1, Math.floor(minX)),
    minY: Math.max(1, Math.floor(minY)),
    maxX: Math.min(width - 2, Math.ceil(maxX)),
    maxY: Math.min(height - 2, Math.ceil(maxY)),
  };
}

/**
 * Two-pass chamfer distance transform, in place.
 *
 * Seeds must already hold 0 for the source set and a large value elsewhere. The
 * chamfer metric overestimates Euclidean distance by a few percent, which is
 * well inside the tolerance of the thickness judgement it feeds.
 */
function chamferDistance(
  distance: Float32Array,
  gridWidth: number,
  gridHeight: number,
): void {
  const diagonal = Math.SQRT2;

  for (let y = 0; y < gridHeight; y += 1) {
    const row = y * gridWidth;
    for (let x = 0; x < gridWidth; x += 1) {
      const cell = row + x;
      if (distance[cell] === 0) continue;
      let best = distance[cell];
      if (x > 0) best = Math.min(best, distance[cell - 1] + 1);
      if (y > 0) best = Math.min(best, distance[cell - gridWidth] + 1);
      if (x > 0 && y > 0) {
        best = Math.min(best, distance[cell - gridWidth - 1] + diagonal);
      }
      if (x < gridWidth - 1 && y > 0) {
        best = Math.min(best, distance[cell - gridWidth + 1] + diagonal);
      }
      distance[cell] = best;
    }
  }

  for (let y = gridHeight - 1; y >= 0; y -= 1) {
    const row = y * gridWidth;
    for (let x = gridWidth - 1; x >= 0; x -= 1) {
      const cell = row + x;
      if (distance[cell] === 0) continue;
      let best = distance[cell];
      if (x < gridWidth - 1) best = Math.min(best, distance[cell + 1] + 1);
      if (y < gridHeight - 1) best = Math.min(best, distance[cell + gridWidth] + 1);
      if (x < gridWidth - 1 && y < gridHeight - 1) {
        best = Math.min(best, distance[cell + gridWidth + 1] + diagonal);
      }
      if (x > 0 && y < gridHeight - 1) {
        best = Math.min(best, distance[cell + gridWidth - 1] + diagonal);
      }
      distance[cell] = best;
    }
  }
}

/**
 * The limb-shaped part of the mask: everything a limb-radius disc cannot fit
 * inside. Formally the mask minus its morphological opening by that disc.
 *
 * Thickness alone is not enough to reject furniture, because the outer shell of
 * a cabinet is locally as thin as an arm. Subtracting the opening rejects the
 * shell along with the core, so a bulky object is excluded whole while an arm,
 * which the disc never fits inside, survives intact.
 */
function limbCorridor(
  gridMask: Uint8Array,
  gridWidth: number,
  gridHeight: number,
  limbRadius: number,
): Uint8Array {
  const total = gridWidth * gridHeight;
  const far = gridWidth + gridHeight;

  const thickness = new Float32Array(total);
  for (let cell = 0; cell < total; cell += 1) {
    thickness[cell] = gridMask[cell] === 1 ? far : 0;
  }
  chamferDistance(thickness, gridWidth, gridHeight);

  // Distance to the nearest point the disc does fit around, which is what the
  // opening dilates back out.
  const toBulk = new Float32Array(total);
  let anyBulk = false;
  for (let cell = 0; cell < total; cell += 1) {
    if (thickness[cell] > limbRadius) {
      toBulk[cell] = 0;
      anyBulk = true;
    } else {
      toBulk[cell] = far;
    }
  }

  const corridor = new Uint8Array(total);
  if (!anyBulk) {
    corridor.set(gridMask);
    return corridor;
  }

  chamferDistance(toBulk, gridWidth, gridHeight);
  for (let cell = 0; cell < total; cell += 1) {
    if (gridMask[cell] === 1 && toBulk[cell] > limbRadius) corridor[cell] = 1;
  }
  return corridor;
}

function withinReach(x: number, y: number, envelope: BodyEnvelope): boolean {
  for (const reach of envelope.reachAnchors) {
    const dx = x - reach.center.x;
    const dy = y - reach.center.y;
    if (dx * dx + dy * dy <= reach.radiusSq) return true;
  }
  return false;
}

export interface MaskRegion {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounding box of the landmark-derived body envelope.
 *
 * Everything outside this box gets discarded by `refinePersonMask`, so callers
 * can use it to skip per-pixel work that would be thrown away.
 */
export function bodyEnvelopeBounds(
  points: UpperBodyPoints,
  width: number,
  height: number,
): MaskRegion | null {
  const envelope = buildBodyEnvelope(points, width, height);
  if (!envelope) return null;

  // Cover where limb growth can go, not just the traced envelope, so an arm the
  // landmarks missed still gets its edges refined.
  let minX = envelope.minX;
  let minY = envelope.minY;
  let maxX = envelope.maxX;
  let maxY = envelope.maxY;
  for (const reach of envelope.reachAnchors) {
    const radius = Math.sqrt(reach.radiusSq);
    minX = Math.min(minX, reach.center.x - radius);
    minY = Math.min(minY, reach.center.y - radius);
    maxX = Math.max(maxX, reach.center.x + radius);
    maxY = Math.max(maxY, reach.center.y + radius);
  }

  return {
    minX: Math.max(1, Math.floor(minX)),
    minY: Math.max(1, Math.floor(minY)),
    maxX: Math.min(width - 2, Math.ceil(maxX)),
    maxY: Math.min(height - 2, Math.ceil(maxY)),
  };
}

function insideEnvelope(x: number, y: number, envelope: BodyEnvelope): boolean {
  for (const shape of envelope.discs) {
    const dx = x - shape.center.x;
    const dy = y - shape.center.y;
    if (dx * dx + dy * dy <= shape.radiusSq) return true;
  }
  if (pointInPolygon(x, y, envelope.torso)) return true;
  for (const limb of envelope.limbs) {
    const dx = limb.b.x - limb.a.x;
    const dy = limb.b.y - limb.a.y;
    const lengthSq = dx * dx + dy * dy;
    let t =
      lengthSq < 1e-6 ? 0 : ((x - limb.a.x) * dx + (y - limb.a.y) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const closestX = limb.a.x + dx * t;
    const closestY = limb.a.y + dy * t;
    const radius = limb.radiusA + (limb.radiusB - limb.radiusA) * t;
    const offsetX = x - closestX;
    const offsetY = y - closestY;
    if (offsetX * offsetX + offsetY * offsetY <= radius * radius) return true;
  }
  return false;
}

/**
 * Restricts the segmentation mask to the detected body.
 *
 * The selfie-segmentation model regularly absorbs whatever the person touches —
 * a chair, a desk, a headrest. Two passes remove that: pixels must fall inside a
 * landmark-derived body envelope, and must be connected to the torso, so stray
 * blobs that merely sit inside the envelope are dropped too.
 *
 * Mutates and returns the supplied ImageData. Returns it untouched when the
 * landmarks are too sparse to define an envelope.
 */
export function refinePersonMask(
  imageData: ImageData,
  points: UpperBodyPoints,
  width: number,
  height: number,
): ImageData {
  const envelope = buildBodyEnvelope(points, width, height);
  if (!envelope) return imageData;

  const data = imageData.data;
  // The gate decides which *regions* are body, so it runs on a coarse grid. Its
  // boundary sits in the padding well clear of the person, where a cell of slop
  // is invisible, and the mask's own edge detail inside a kept cell is retained.
  const step = width >= GATE_GRID_MIN_WIDTH ? GATE_GRID_STEP : 1;
  const gridWidth = Math.ceil(width / step);
  const gridHeight = Math.ceil(height / step);
  const gridTotal = gridWidth * gridHeight;

  const gridMinX = Math.floor(envelope.minX / step);
  const gridMaxX = Math.min(gridWidth - 1, Math.ceil(envelope.maxX / step));
  const gridMinY = Math.floor(envelope.minY / step);
  const gridMaxY = Math.min(gridHeight - 1, Math.ceil(envelope.maxY / step));

  // gridMask covers the whole frame because limbs reach outside the envelope;
  // candidate is the confident subset that sits inside it.
  const gridMask = new Uint8Array(gridTotal);
  const candidate = new Uint8Array(gridTotal);
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    const y = Math.min(height - 1, gridY * step);
    const row = y * width;
    const gridRow = gridY * gridWidth;
    const insideRows = gridY >= gridMinY && gridY <= gridMaxY;
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const x = Math.min(width - 1, gridX * step);
      if (!isPersonPixel(data, (row + x) * 4)) continue;
      gridMask[gridRow + gridX] = 1;
      if (!insideRows || gridX < gridMinX || gridX > gridMaxX) continue;
      if (!insideEnvelope(x, y, envelope)) continue;
      candidate[gridRow + gridX] = 1;
    }
  }

  // Flood fill from the torso so only the connected body region survives.
  const kept = new Uint8Array(gridTotal);
  const queue = new Int32Array(gridTotal);
  let head = 0;
  let tail = 0;

  for (const seed of envelope.seeds) {
    const gridX = Math.round(seed.x / step);
    const gridY = Math.round(seed.y / step);
    if (gridX < 0 || gridY < 0 || gridX >= gridWidth || gridY >= gridHeight) continue;
    const cell = gridY * gridWidth + gridX;
    if (candidate[cell] !== 1 || kept[cell] === 1) continue;
    kept[cell] = 1;
    queue[tail] = cell;
    tail += 1;
  }

  // A seed can land on a mask hole; fall back to scanning the torso band.
  if (tail === 0) {
    for (let gridY = gridMinY; gridY <= gridMaxY && tail === 0; gridY += 1) {
      const gridRow = gridY * gridWidth;
      for (let gridX = gridMinX; gridX <= gridMaxX; gridX += 1) {
        const cell = gridRow + gridX;
        if (candidate[cell] !== 1) continue;
        if (!pointInPolygon(gridX * step, gridY * step, envelope.torso)) continue;
        kept[cell] = 1;
        queue[tail] = cell;
        tail += 1;
        break;
      }
    }
  }

  while (head < tail) {
    const cell = queue[head];
    head += 1;
    const gridX = cell % gridWidth;
    const gridY = (cell - gridX) / gridWidth;

    if (gridX > 0 && candidate[cell - 1] === 1 && kept[cell - 1] === 0) {
      kept[cell - 1] = 1;
      queue[tail] = cell - 1;
      tail += 1;
    }
    if (gridX < gridWidth - 1 && candidate[cell + 1] === 1 && kept[cell + 1] === 0) {
      kept[cell + 1] = 1;
      queue[tail] = cell + 1;
      tail += 1;
    }
    if (gridY > 0 && candidate[cell - gridWidth] === 1 && kept[cell - gridWidth] === 0) {
      kept[cell - gridWidth] = 1;
      queue[tail] = cell - gridWidth;
      tail += 1;
    }
    if (
      gridY < gridHeight - 1 &&
      candidate[cell + gridWidth] === 1 &&
      kept[cell + gridWidth] === 0
    ) {
      kept[cell + gridWidth] = 1;
      queue[tail] = cell + gridWidth;
      tail += 1;
    }
  }

  // Nothing survived, so keep the original mask rather than blanking the overlay.
  if (tail === 0) return imageData;

  // Grow out of the envelope along limbs the landmarks could not describe. The
  // core found above is the whole starting boundary, so restart from the front
  // of the queue with the looser test. Skipped when every limb was traced,
  // which also skips the distance transform.
  if (envelope.reachAnchors.length > 0) {
    const corridor = limbCorridor(
      gridMask,
      gridWidth,
      gridHeight,
      envelope.limbThickness / step,
    );
    head = 0;

    const grow = (cell: number, gridX: number, gridY: number): void => {
      if (kept[cell] === 1 || corridor[cell] !== 1) return;
      if (!withinReach(gridX * step, gridY * step, envelope)) return;
      kept[cell] = 1;
      queue[tail] = cell;
      tail += 1;
    };

    while (head < tail) {
      const cell = queue[head];
      head += 1;
      const gridX = cell % gridWidth;
      const gridY = (cell - gridX) / gridWidth;

      if (gridX > 0) grow(cell - 1, gridX - 1, gridY);
      if (gridX < gridWidth - 1) grow(cell + 1, gridX + 1, gridY);
      if (gridY > 0) grow(cell - gridWidth, gridX, gridY - 1);
      if (gridY < gridHeight - 1) grow(cell + gridWidth, gridX, gridY + 1);
    }
  }

  // Growth can reach past the envelope, so the clear works off what was kept.
  let keptMinGridY = gridHeight - 1;
  let keptMaxGridY = 0;
  for (let index = 0; index < tail; index += 1) {
    const gridY = ((queue[index] / gridWidth) | 0);
    if (gridY < keptMinGridY) keptMinGridY = gridY;
    if (gridY > keptMaxGridY) keptMaxGridY = gridY;
  }
  const minY = Math.max(0, keptMinGridY * step);
  const maxY = Math.min(height - 1, (keptMaxGridY + 1) * step - 1);

  // Rows above and below clear wholesale, which is far cheaper than testing
  // them pixel by pixel.
  data.fill(0, 0, Math.min(data.length, minY * width * 4));
  data.fill(0, Math.min(data.length, (maxY + 1) * width * 4));

  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    const gridRow = Math.min(gridHeight - 1, (y / step) | 0) * gridWidth;
    for (let x = 0; x < width; x += 1) {
      if (kept[gridRow + Math.min(gridWidth - 1, (x / step) | 0)] === 1) continue;
      const offset = (row + x) * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }

  return imageData;
}

function armsAreRaised(points: UpperBodyPoints) {
  const leftRaised =
    points.leftElbow &&
    points.leftShoulder &&
    points.leftElbow.y < points.leftShoulder.y - 0.02;
  const rightRaised =
    points.rightElbow &&
    points.rightShoulder &&
    points.rightElbow.y < points.rightShoulder.y - 0.02;
  return Boolean(leftRaised || rightRaised);
}

function tightestShoulderSpan(
  imageData: ImageData,
  leftShoulder: { x: number; y: number },
  rightShoulder: { x: number; y: number },
  width: number,
  height: number,
): SilhouetteSpan | null {
  const innerWidth = Math.max(8, Math.abs(rightShoulder.x - leftShoulder.x) * width);
  const midY = ((leftShoulder.y + rightShoulder.y) / 2) * height;
  const searchTop = midY - innerWidth * 0.38;
  const searchBottom = midY + innerWidth * 0.05;
  const minAcceptable = innerWidth * 0.9;
  const maxAcceptable = innerWidth * 1.38;

  let best: SilhouetteSpan | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let y = searchTop; y <= searchBottom; y += 1) {
    const span = silhouetteSpanAtY(imageData, y, width, height);
    if (!span) continue;
    const spanWidth = span.right - span.left;
    if (spanWidth < minAcceptable || spanWidth > maxAcceptable) continue;
    const score = Math.abs(spanWidth - innerWidth * 1.18);
    if (score < bestScore) {
      best = span;
      bestScore = score;
    }
  }

  return best;
}

export function snapUpperBodyToSilhouette(
  points: UpperBodyPoints,
  imageData: ImageData,
  width: number,
  height: number,
): UpperBodyPoints {
  const snapped: UpperBodyPoints = { ...points };
  const hipY = pixelY(points.leftHip, points.rightHip, height, 0);

  if (points.leftShoulder && points.rightShoulder) {
    const shoulderSpan = tightestShoulderSpan(
      imageData,
      points.leftShoulder,
      points.rightShoulder,
      width,
      height,
    );
    if (shoulderSpan) {
      snapped.leftShoulderOuter = {
        x: shoulderSpan.left / width,
        y: points.leftShoulder.y,
      };
      snapped.rightShoulderOuter = {
        x: shoulderSpan.right / width,
        y: points.rightShoulder.y,
      };
    }
  }

  const hipSpan = hipY === null ? null : silhouetteSpanAtY(imageData, hipY, width, height);
  if (hipSpan && points.leftHip && points.rightHip && !armsAreRaised(points)) {
    const hipLineY = (points.leftHip.y + points.rightHip.y) / 2;
    const expected = Math.abs((points.rightHip.x - points.leftHip.x) * width);
    const spanWidth = hipSpan.right - hipSpan.left;
    if (expected < 8 || spanWidth <= expected * 1.35) {
      snapped.leftHip = { x: hipSpan.left / width, y: hipLineY };
      snapped.rightHip = { x: hipSpan.right / width, y: hipLineY };
    }
  }

  return snapped;
}

const SHOULDER_DOT = "rgba(34, 197, 94, 0.95)";
const ARM_DOT = "rgba(250, 204, 21, 0.95)";
const OTHER_DOT = "rgba(251, 113, 133, 0.88)";

type Region = "shoulder" | "arm" | "other";

function canvasPointsFrom(
  points: UpperBodyPoints | undefined,
  names: Array<keyof UpperBodyPoints>,
  width: number,
  height: number,
) {
  const result: Array<{ x: number; y: number }> = [];
  for (const name of names) {
    const point = points?.[name];
    if (!point) continue;
    result.push({ x: point.x * width, y: point.y * height });
  }
  return result;
}

function nearestDistance(
  x: number,
  y: number,
  anchors: Array<{ x: number; y: number }>,
) {
  let best = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const dx = x - anchor.x;
    const dy = y - anchor.y;
    const distance = dx * dx + dy * dy;
    if (distance < best) best = distance;
  }
  return best;
}

function regionForDot(
  x: number,
  y: number,
  shoulderAnchors: Array<{ x: number; y: number }>,
  armAnchors: Array<{ x: number; y: number }>,
  shoulderLineY: number | null,
  shoulderWidthPx: number,
): Region {
  if (shoulderAnchors.length === 0 && armAnchors.length === 0) return "other";

  const shoulderDist = nearestDistance(x, y, shoulderAnchors);
  const armDist = nearestDistance(x, y, armAnchors);
  const shoulderRadius = Math.max(22, shoulderWidthPx * 0.26);
  const armRadius = Math.max(28, shoulderWidthPx * 0.42);
  const shoulderBand = Math.max(14, shoulderWidthPx * 0.2);
  const inShoulderBand =
    shoulderLineY === null || Math.abs(y - shoulderLineY) <= shoulderBand;

  if (armDist + 20 * 20 < shoulderDist && armDist <= armRadius * armRadius) {
    return "arm";
  }
  if (inShoulderBand && shoulderDist <= shoulderRadius * shoulderRadius) {
    return "shoulder";
  }
  if (armDist <= armRadius * armRadius) {
    return "arm";
  }
  return "other";
}

export function drawBodySilhouetteOutline(
  context: CanvasRenderingContext2D,
  imageData: ImageData,
  width: number,
  height: number,
  points?: UpperBodyPoints,
) {
  const source = imageData.data;
  const spacing = 9;
  const radius = 2.15;
  const cols = Math.ceil(width / spacing);
  const used = new Uint8Array(cols * Math.ceil(height / spacing));
  const shoulderAnchors = canvasPointsFrom(
    points,
    ["leftShoulder", "rightShoulder"],
    width,
    height,
  );
  const armAnchors = canvasPointsFrom(
    points,
    ["leftElbow", "rightElbow", "leftWrist", "rightWrist"],
    width,
    height,
  );
  const shoulderLineY =
    points?.leftShoulder && points.rightShoulder
      ? ((points.leftShoulder.y + points.rightShoulder.y) / 2) * height
      : null;
  const shoulderWidthPx =
    points?.leftShoulder && points.rightShoulder
      ? Math.hypot(
          (points.rightShoulder.x - points.leftShoulder.x) * width,
          (points.rightShoulder.y - points.leftShoulder.y) * height,
        )
      : 80;
  const grouped: Record<Region, Array<{ x: number; y: number }>> = {
    shoulder: [],
    arm: [],
    other: [],
  };

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      if (!isPersonPixel(source, index)) continue;

      const onEdge =
        !isPersonPixel(source, index - 4) ||
        !isPersonPixel(source, index + 4) ||
        !isPersonPixel(source, index - width * 4) ||
        !isPersonPixel(source, index + width * 4);
      if (!onEdge) continue;

      const cell = Math.floor(y / spacing) * cols + Math.floor(x / spacing);
      if (used[cell]) continue;
      used[cell] = 1;

      grouped[
        regionForDot(x, y, shoulderAnchors, armAnchors, shoulderLineY, shoulderWidthPx)
      ].push({ x, y });
    }
  }

  context.save();
  const colors: Record<Region, string> = {
    shoulder: SHOULDER_DOT,
    arm: ARM_DOT,
    other: OTHER_DOT,
  };
  for (const region of ["shoulder", "arm", "other"] as const) {
    const dots = grouped[region];
    if (dots.length === 0) continue;
    context.fillStyle = colors[region];
    context.beginPath();
    for (const dot of dots) {
      context.moveTo(dot.x + radius, dot.y);
      context.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
    }
    context.fill();
  }
  context.restore();
}

function pixelY(
  left: { y: number } | undefined,
  right: { y: number } | undefined,
  height: number,
  offset: number,
) {
  if (!left && !right) return null;
  const y = left && right ? (left.y + right.y) / 2 : (left ?? right)?.y;
  if (typeof y !== "number") return null;
  return y * height + offset;
}
