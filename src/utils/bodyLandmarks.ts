export interface NormalizedBodyLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface UpperBodyPoint extends NormalizedPoint {
  /**
   * Set when the point is projected geometry rather than something MediaPipe
   * measured — hips inferred from the shoulder line, for instance. Consumers
   * should not present these as detections.
   */
  estimated?: boolean;
}

export type UpperBodyPointName =
  | "leftShoulder"
  | "rightShoulder"
  | "neck"
  | "leftShoulderOuter"
  | "rightShoulderOuter"
  | "torsoCenter"
  | "leftElbow"
  | "rightElbow"
  | "leftHip"
  | "rightHip"
  | "leftWrist"
  | "rightWrist";

export type UpperBodyPoints = Partial<Record<UpperBodyPointName, UpperBodyPoint>>;

const POSE_INDEX = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

export const DEFAULT_VISIBILITY_THRESHOLD = 0.55;
export const DEFAULT_SMOOTHING_FACTOR = 0.45;
const NECK_LIFT_RATIO = 0.125;
const SHOULDER_OUTER_RATIO = 0.175;
const HIP_WIDTH_TO_OUTER_SHOULDER = 1.12;
const DEFAULT_TORSO_LENGTH_TO_SHOULDER = 1.55;
const RELIABLE_HIP_WIDTH_TO_SHOULDER = 0.62;
/** Projected points stop here rather than running off past the frame edge. */
const FRAME_MARGIN = 0.02;

/**
 * Shortens `depth` along `down` so the projected point stays in frame.
 *
 * Without this, a close-up or leaning subject projects hips far below the
 * bottom edge — the torso length is a guess, and an unbounded guess drags
 * everything derived from it off screen.
 */
function depthWithinFrame(
  origin: NormalizedPoint,
  down: NormalizedPoint,
  depth: number,
): number {
  let limited = depth;
  if (down.y > 1e-6) limited = Math.min(limited, (1 - FRAME_MARGIN - origin.y) / down.y);
  if (down.y < -1e-6) limited = Math.min(limited, (FRAME_MARGIN - origin.y) / down.y);
  if (down.x > 1e-6) limited = Math.min(limited, (1 - FRAME_MARGIN - origin.x) / down.x);
  if (down.x < -1e-6) limited = Math.min(limited, (FRAME_MARGIN - origin.x) / down.x);
  return Math.max(0, limited);
}

function isReliable(
  landmark: NormalizedBodyLandmark | undefined,
  threshold: number,
): landmark is NormalizedBodyLandmark {
  if (!landmark) return false;
  if (typeof landmark.visibility === "number" && landmark.visibility < threshold) return false;
  if (typeof landmark.presence === "number" && landmark.presence < threshold) return false;
  return Number.isFinite(landmark.x) && Number.isFinite(landmark.y);
}

function toPoint(landmark: NormalizedBodyLandmark): NormalizedPoint {
  return { x: landmark.x, y: landmark.y };
}

function midpoint(a: NormalizedPoint, b: NormalizedPoint): NormalizedPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function shoulderSpan(leftShoulder: NormalizedPoint, rightShoulder: NormalizedPoint) {
  return Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);
}

function downwardUnit(
  leftShoulder: NormalizedPoint,
  rightShoulder: NormalizedPoint,
  headHint?: NormalizedPoint,
): NormalizedPoint | null {
  const width = shoulderSpan(leftShoulder, rightShoulder);
  if (width < 1e-6) return null;

  const center = midpoint(leftShoulder, rightShoulder);
  let upX = -(rightShoulder.y - leftShoulder.y) / width;
  let upY = (rightShoulder.x - leftShoulder.x) / width;
  const towardHead = headHint
    ? (headHint.x - center.x) * upX + (headHint.y - center.y) * upY
    : -upY;
  if (towardHead < 0) {
    upX = -upX;
    upY = -upY;
  }

  return { x: -upX, y: -upY };
}

export function estimateNeckCenter(
  leftShoulder: NormalizedPoint,
  rightShoulder: NormalizedPoint,
  headHint?: NormalizedPoint,
): NormalizedPoint {
  const center = midpoint(leftShoulder, rightShoulder);
  const width = shoulderSpan(leftShoulder, rightShoulder);
  if (width < 1e-6) return center;

  let upX = -(rightShoulder.y - leftShoulder.y) / width;
  let upY = (rightShoulder.x - leftShoulder.x) / width;

  const towardHead = headHint
    ? (headHint.x - center.x) * upX + (headHint.y - center.y) * upY
    : -upY;
  if (towardHead < 0) {
    upX = -upX;
    upY = -upY;
  }

  return {
    x: center.x + upX * width * NECK_LIFT_RATIO,
    y: center.y + upY * width * NECK_LIFT_RATIO,
  };
}

export function estimateShoulderOuters(
  leftShoulder: NormalizedPoint,
  rightShoulder: NormalizedPoint,
): { left: NormalizedPoint; right: NormalizedPoint } {
  const width = shoulderSpan(leftShoulder, rightShoulder);
  if (width < 1e-6) {
    return { left: leftShoulder, right: rightShoulder };
  }

  const offsetX = ((rightShoulder.x - leftShoulder.x) / width) * width * SHOULDER_OUTER_RATIO;
  const offsetY = ((rightShoulder.y - leftShoulder.y) / width) * width * SHOULDER_OUTER_RATIO;

  return {
    left: {
      x: leftShoulder.x - offsetX,
      y: leftShoulder.y - offsetY,
    },
    right: {
      x: rightShoulder.x + offsetX,
      y: rightShoulder.y + offsetY,
    },
  };
}

export function estimateOuterHips(
  leftShoulder: NormalizedPoint,
  rightShoulder: NormalizedPoint,
  leftShoulderOuter: NormalizedPoint,
  rightShoulderOuter: NormalizedPoint,
  leftHip?: NormalizedPoint,
  rightHip?: NormalizedPoint,
  headHint?: NormalizedPoint,
): { left: UpperBodyPoint; right: UpperBodyPoint; estimated: boolean } {
  const innerWidth = shoulderSpan(leftShoulder, rightShoulder);
  const outerWidth = shoulderSpan(leftShoulderOuter, rightShoulderOuter);
  const down = downwardUnit(leftShoulder, rightShoulder, headHint);
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipWidth = Math.max(innerWidth, outerWidth) * HIP_WIDTH_TO_OUTER_SHOULDER;

  if (!down || innerWidth < 1e-6) {
    return {
      left: { ...leftShoulderOuter, estimated: true },
      right: { ...rightShoulderOuter, estimated: true },
      estimated: true,
    };
  }

  const jointWidth = leftHip && rightHip ? shoulderSpan(leftHip, rightHip) : 0;
  const hipsLookReal = jointWidth >= innerWidth * RELIABLE_HIP_WIDTH_TO_SHOULDER;
  const measuredDepth =
    hipsLookReal && leftHip && rightHip
      ? (midpoint(leftHip, rightHip).x - shoulderMid.x) * down.x +
        (midpoint(leftHip, rightHip).y - shoulderMid.y) * down.y
      : innerWidth * DEFAULT_TORSO_LENGTH_TO_SHOULDER;
  // Only the invented depth gets fenced in; a real measurement is left alone.
  const depth = hipsLookReal
    ? Math.max(innerWidth * 1.2, measuredDepth)
    : Math.min(
        Math.max(innerWidth * 1.2, measuredDepth),
        depthWithinFrame(shoulderMid, down, measuredDepth),
      );

  const hipMid = {
    x: shoulderMid.x + down.x * depth,
    y: shoulderMid.y + down.y * depth,
  };
  const axisX = (rightShoulder.x - leftShoulder.x) / innerWidth;
  const axisY = (rightShoulder.y - leftShoulder.y) / innerWidth;
  const halfWidth = hipWidth / 2;

  return {
    left: {
      x: hipMid.x - axisX * halfWidth,
      y: hipMid.y - axisY * halfWidth,
      estimated: !hipsLookReal,
    },
    right: {
      x: hipMid.x + axisX * halfWidth,
      y: hipMid.y + axisY * halfWidth,
      estimated: !hipsLookReal,
    },
    estimated: !hipsLookReal,
  };
}

export function estimateTorsoCenter(
  leftShoulder: NormalizedPoint,
  rightShoulder: NormalizedPoint,
  leftHip: NormalizedPoint,
  rightHip: NormalizedPoint,
): NormalizedPoint {
  return midpoint(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip));
}

export function extractUpperBodyPoints(
  poseLandmarks: readonly NormalizedBodyLandmark[] | undefined,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): UpperBodyPoints {
  const points: UpperBodyPoints = {};
  if (!poseLandmarks || poseLandmarks.length === 0) {
    return points;
  }
  const trackedPosePoints = [
    "leftShoulder",
    "rightShoulder",
    "leftElbow",
    "rightElbow",
    "leftWrist",
    "rightWrist",
  ] as const;

  for (const name of trackedPosePoints) {
    const landmark = poseLandmarks[POSE_INDEX[name]];
    if (isReliable(landmark, visibilityThreshold)) {
      points[name] = toPoint(landmark);
    }
  }

  const { leftShoulder, rightShoulder } = points;
  const rawNose = poseLandmarks[POSE_INDEX.nose];
  const nose = isReliable(rawNose, visibilityThreshold) ? toPoint(rawNose) : undefined;
  const rawLeftHip = poseLandmarks[POSE_INDEX.leftHip];
  const rawRightHip = poseLandmarks[POSE_INDEX.rightHip];
  if (leftShoulder && rightShoulder) {
    points.neck = estimateNeckCenter(leftShoulder, rightShoulder, nose);

    const outers = estimateShoulderOuters(leftShoulder, rightShoulder);
    points.leftShoulderOuter = outers.left;
    points.rightShoulderOuter = outers.right;

    const outerHips = estimateOuterHips(
      leftShoulder,
      rightShoulder,
      outers.left,
      outers.right,
      isReliable(rawLeftHip, visibilityThreshold) ? toPoint(rawLeftHip) : undefined,
      isReliable(rawRightHip, visibilityThreshold) ? toPoint(rawRightHip) : undefined,
      nose,
    );
    points.leftHip = outerHips.left;
    points.rightHip = outerHips.right;
    points.torsoCenter = {
      ...estimateTorsoCenter(leftShoulder, rightShoulder, outerHips.left, outerHips.right),
      estimated: outerHips.estimated,
    };
  }

  return points;
}

export function smoothUpperBodyPoints(
  previous: UpperBodyPoints,
  current: UpperBodyPoints,
  smoothingFactor = DEFAULT_SMOOTHING_FACTOR,
): UpperBodyPoints {
  const alpha = Math.min(1, Math.max(0, smoothingFactor));
  const smoothed: UpperBodyPoints = {};

  for (const [name, point] of Object.entries(current) as Array<
    [UpperBodyPointName, UpperBodyPoint]
  >) {
    const priorPoint = previous[name];
    smoothed[name] = priorPoint
      ? {
          x: priorPoint.x + (point.x - priorPoint.x) * alpha,
          y: priorPoint.y + (point.y - priorPoint.y) * alpha,
          estimated: point.estimated,
        }
      : point;
  }

  return smoothed;
}
