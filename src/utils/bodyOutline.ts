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
