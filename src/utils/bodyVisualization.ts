import type {
  NormalizedPoint,
  UpperBodyPointName,
  UpperBodyPoints,
} from "@/src/utils/bodyLandmarks";

export interface CanvasPoint {
  x: number;
  y: number;
}

const UPPER_BODY_CONNECTIONS: ReadonlyArray<
  readonly [UpperBodyPointName, UpperBodyPointName]
> = [
  ["leftWrist", "leftElbow"],
  ["leftElbow", "leftShoulderOuter"],
  ["leftShoulderOuter", "leftShoulder"],
  ["leftShoulder", "neck"],
  ["rightWrist", "rightElbow"],
  ["rightElbow", "rightShoulderOuter"],
  ["rightShoulderOuter", "rightShoulder"],
  ["rightShoulder", "neck"],
  ["leftShoulder", "rightShoulder"],
  ["neck", "torsoCenter"],
  ["torsoCenter", "leftHip"],
  ["torsoCenter", "rightHip"],
  ["leftHip", "rightHip"],
];

const ARM_CONNECTIONS = new Set([
  "leftWrist-leftElbow",
  "leftElbow-leftShoulderOuter",
  "rightWrist-rightElbow",
  "rightElbow-rightShoulderOuter",
]);

const SHOULDER_CONNECTIONS = new Set([
  "leftShoulderOuter-leftShoulder",
  "rightShoulderOuter-rightShoulder",
  "leftShoulder-rightShoulder",
  "leftShoulder-neck",
  "rightShoulder-neck",
]);

const POINT_COLORS: Record<UpperBodyPointName, string> = {
  leftShoulder: "#22c55e",
  rightShoulder: "#4ade80",
  neck: "#ef4444",
  leftShoulderOuter: "#16a34a",
  rightShoulderOuter: "#86efac",
  torsoCenter: "#e879f9",
  leftElbow: "#eab308",
  rightElbow: "#facc15",
  leftHip: "#2dd4bf",
  rightHip: "#fdba74",
  leftWrist: "#f59e0b",
  rightWrist: "#fde047",
};

const LINE_COLORS = {
  arm: "#facc15",
  shoulder: "#22c55e",
  other: "#ffffff",
} as const;

const MAJOR_POINTS = new Set<UpperBodyPointName>([
  "leftShoulder",
  "rightShoulder",
  "neck",
  "torsoCenter",
]);

export function toCanvasPoint(
  point: NormalizedPoint,
  width: number,
  height: number,
): CanvasPoint {
  return {
    x: point.x * width,
    y: point.y * height,
  };
}

export function drawUpperBodySkeleton(
  context: CanvasRenderingContext2D,
  points: UpperBodyPoints,
  width: number,
  height: number,
) {
  const canvasPoints = Object.fromEntries(
    (Object.entries(points) as Array<[UpperBodyPointName, NormalizedPoint]>).map(
      ([name, point]) => [name, toCanvasPoint(point, width, height)],
    ),
  ) as Partial<Record<UpperBodyPointName, CanvasPoint>>;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 2.5;

  for (const [startName, endName] of UPPER_BODY_CONNECTIONS) {
    const start = canvasPoints[startName];
    const end = canvasPoints[endName];
    if (!start || !end) continue;

    const key = `${startName}-${endName}`;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = ARM_CONNECTIONS.has(key)
      ? LINE_COLORS.arm
      : SHOULDER_CONNECTIONS.has(key)
        ? LINE_COLORS.shoulder
        : LINE_COLORS.other;
    context.stroke();
  }

  for (const [name, point] of Object.entries(canvasPoints) as Array<
    [UpperBodyPointName, CanvasPoint]
  >) {
    const radius = MAJOR_POINTS.has(name) ? 7 : 4.5;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = POINT_COLORS[name];
    context.fill();
    context.lineWidth = 1.25;
    context.strokeStyle = "rgba(15, 23, 42, 0.55)";
    context.stroke();
  }

  context.restore();
}
