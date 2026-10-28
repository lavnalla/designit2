// The dots around an object on the workspace: all the way round its outline (where its picture isn't
// transparent), evenly spaced, not the four corners of its picture. They're also the outline the picture is cut
// to, so they stand a little outside the object, never across it.

type Dot = { id: string; x: number; y: number };

// The picture is looked at on a grid at most this many cells on its long side
const GRID_SIDE = 160;
// Alpha (0-255) above which a pixel counts as part of the object
const SOLID_ALPHA = 24;
// How far the outline stands off the object, as a share of the dots' spacing: the straight line between two
// dots cuts a curve's corner, and this keeps that corner outside the object (at least two grid cells)
const MARGIN_SHARE = 0.2;
const MIN_MARGIN_CELLS = 2;

const cornerDots = (width: number, height: number): Dot[] => [
  { id: "tl", x: 0, y: 0 },
  { id: "tr", x: width, y: 0 },
  { id: "br", x: width, y: height },
  { id: "bl", x: 0, y: height },
];

// (Clockwise on screen, y down: west, north-west, north, ... south-west)
const DIRS: [number, number][] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

/** Dots all around the object in the image (in the image's own pixels, `width` x `height`), about `spacing`
 * apart (in the same pixels), or the four corners when the picture has no transparency to go by. */
export function outlineDotsOf(img: HTMLImageElement, width: number, height: number, spacing: number): Dot[] {
  if (width < 2 || height < 2) return cornerDots(width, height);
  const cell = Math.max(1, Math.max(width, height) / GRID_SIDE);
  const gw = Math.max(2, Math.round(width / cell));
  const gh = Math.max(2, Math.round(height / cell));

  let alpha: Uint8ClampedArray;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = gw;
    canvas.height = gh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return cornerDots(width, height);
    ctx.drawImage(img, 0, 0, gw, gh);
    alpha = ctx.getImageData(0, 0, gw, gh).data;
  } catch {
    // (A picture the page can't read back)
    return cornerDots(width, height);
  }

  // In grid cells: the spacing, and how far the outline stands off the object
  const step = Math.max(1, spacing / cell);
  const margin = Math.max(MIN_MARGIN_CELLS, Math.ceil(step * MARGIN_SHARE));

  // Solid cells; the grid is padded so the outline never touches its edge
  const pad = margin + 1;
  const W = gw + pad * 2;
  const H = gh + pad * 2;
  const solid = new Uint8Array(W * H);
  let solidCount = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (alpha[(y * gw + x) * 4 + 3] > SOLID_ALPHA) {
        solid[(y + pad) * W + x + pad] = 1;
        solidCount++;
      }
    }
  }
  // (No transparency to speak of: the whole picture is the object)
  if (solidCount === 0 || solidCount > gw * gh * 0.97) return cornerDots(width, height);

  const outline = outlineAt(solid, W, H, margin);
  if (outline.length < 3) return cornerDots(width, height);
  // A dot at each of the outline's corners (dropping only points less than a cell off the line between their
  // neighbours, well inside the margin), then more along each straight stretch so none are more than the
  // spacing apart: those lie on the lines, so they don't change the outline, and it can't cut the object
  const spaced = filledIn(simplifyClosed(outline, Math.max(1, margin - 1)), step);
  if (spaced.length < 3) return cornerDots(width, height);

  const sx = width / gw;
  const sy = height / gh;
  return spaced.map(([x, y], i) => ({
    id: `o${i}`,
    x: Math.min(width, Math.max(0, (x - pad + 0.5) * sx)),
    y: Math.min(height, Math.max(0, (y - pad + 0.5) * sy)),
  }));
}

// The outline standing `margin` cells off the solid cells, every cell along it
function outlineAt(solid: Uint8Array, W: number, H: number, margin: number): [number, number][] {
  const grown = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!solid[y * W + x]) continue;
      for (let dy = -margin; dy <= margin; dy++) {
        for (let dx = -margin; dx <= margin; dx++) {
          if (dx * dx + dy * dy <= margin * margin) grown[(y + dy) * W + x + dx] = 1;
        }
      }
    }
  }

  // Its separate pieces
  const label = new Int32Array(W * H);
  const sizes: number[] = [0];
  const firstCell: number[] = [0];
  for (let i = 0; i < W * H; i++) {
    if (!grown[i] || label[i]) continue;
    const id = sizes.length;
    sizes.push(0);
    firstCell.push(i);
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      sizes[id]++;
      const cx = c % W;
      const cy = (c - cx) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (cy + dy) * W + cx + dx;
        if (grown[n] && !label[n]) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
  }
  let main = 1;
  for (let id = 2; id < sizes.length; id++) if (sizes[id] > sizes[main]) main = id;
  const total = sizes.reduce((a, b) => a + b, 0);

  // Several real pieces (a pair of earrings): one outline around them all, so none is cut off. One piece:
  // around its edge (its own hole, like the inside of a necklace, left as it is)
  return sizes[main] < total * 0.97 ? convexHull(grown, W, H) : traceOutline(label, main, firstCell[main], W);
}

// The cells along a piece's outer edge, in order (Moore-neighbour tracing)
function traceOutline(label: Int32Array, id: number, start: number, W: number): [number, number][] {
  const inside = (x: number, y: number) => label[y * W + x] === id;
  const sx = start % W;
  const sy = (start - sx) / W;
  const out: [number, number][] = [[sx, sy]];
  let x = sx;
  let y = sy;
  // (Came in from the west: the first cell found scanning row by row has nothing of the piece to its west)
  let back = 0;
  const limit = label.length * 2;
  for (let n = 0; n < limit; n++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      if (inside(x + DIRS[d][0], y + DIRS[d][1])) {
        found = d;
        break;
      }
    }
    if (found < 0) break; // (a single cell)
    const prev = (found + 7) % 8;
    const nx = x + DIRS[found][0];
    const ny = y + DIRS[found][1];
    // (The cell checked just before the one found, as seen from the new cell)
    const bx = x + DIRS[prev][0] - nx;
    const by = y + DIRS[prev][1] - ny;
    back = DIRS.findIndex(([dx, dy]) => dx === bx && dy === by);
    x = nx;
    y = ny;
    if (x === sx && y === sy) break;
    out.push([x, y]);
  }
  return out;
}

// The smallest convex outline around every solid cell (monotone chain)
function convexHull(grid: Uint8Array, W: number, H: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < W; x++) {
      if (grid[y * W + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) {
      pts.push([first, y]);
      if (last !== first) pts.push([last, y]);
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// The closed outline's corners with more points put along each side, evenly, so none are more than `step` apart
function filledIn(corners: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < corners.length; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % corners.length];
    const pieces = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let k = 0; k < pieces; k++) out.push([x1 + ((x2 - x1) * k) / pieces, y1 + ((y2 - y1) * k) / pieces]);
  }
  return out;
}

// Fewer points along a closed outline, none of the dropped ones further than `tolerance` from it
// (Douglas-Peucker, split at the point furthest from the first)
function simplifyClosed(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 4) return points;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < points.length; i++) {
    const d = (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyOpen(points.slice(0, far + 1), tolerance);
  const b = simplifyOpen(points.slice(far).concat([points[0]]), tolerance);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function simplifyOpen(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  let worst = 0;
  let worstD = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs((x2 - x1) * (y1 - py) - (x1 - px) * (y2 - y1)) / len;
    if (d > worstD) {
      worstD = d;
      worst = i;
    }
  }
  if (worstD <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplifyOpen(points.slice(0, worst + 1), tolerance);
  const right = simplifyOpen(points.slice(worst), tolerance);
  return left.slice(0, -1).concat(right);
}
