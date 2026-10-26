// Turns a rough garment sketch into a clean, finished-looking garment (like a product photo's flat), with no AI:
// 1. The garment: what's drawn on the paper (a filled shape, or the inside of an outline drawn in lines).
// 2. Its silhouette cleaned up: a garment seen from the front is symmetric, so the sketch's left and right
//    edges are evened out about its centre line and smoothed down its height (the hand-drawn wobble and the
//    polygon's corners go). A garment whose rows aren't one piece across (sleeves apart from the body) is
//    smoothed and only mirrored if the sketch is nearly symmetric already.
// 3. Its fabric: the sketch's own, kept as it is (its colours, and any fabric's print on it; plain cloth for a
//    line sketch), with a seam where two clearly different parts meet (a bodice and its skirt).
// 4. Shading, so it reads as cloth over a body: rounded across (darker toward the sides), lit from the left.
// 5. A dress (narrowing to a waist, flaring below it): a waist seam, bodice seams, soft folds fanning out
//    from the waist down the skirt, and a gently waved hem. The neckline keeps the sketch's own (V, sweetheart),
//    evened out.
// 6. Lines drawn inside the garment: one joined to the outline is a seam (drawn fine), one on its own a fold.
// 7. A soft shadow beneath. Everything outside the garment comes out see-through.

type RGBA = { data: Uint8ClampedArray; width: number; height: number };

// Paper: near white and colourless
const PAPER_MIN = 225;
const PAPER_SPREAD = 25;
// An outline drawn in lines has gaps bridged by thickening the lines: first by this fraction of the sketch's
// size, more (each time by half again) until the outline closes, up to the most
const GAP_BRIDGE = 0.008;
const GAP_BRIDGE_MOST = 0.05;
// How far the silhouette's half-width and centre are smoothed down its height (fractions of its height)
const WIDTH_SMOOTHING = 0.035;
const CENTRE_SMOOTHING = 0.25;
// A sketch whose mirror image overlaps it this much is evened out even if its rows aren't one piece across
const MIRROR_OVERLAP = 0.85;
// Shading across: how much darker at the sides, and how much the left side is lit over the right
const SIDE_SHADE = 0.2;
const SIDE_LIGHT = 0.06;
// A dress: its hem at least this many times as wide as its waist
const FLARE = 1.35;
// Its skirt's folds: about one per this fraction of its height across the hem, this dark at their deepest
const FOLD_SPACING = 0.2;
const FOLD_DEPTH = 0.2;
// The neckline: kept from the sketch where its top dips in the middle by at least this (fraction of the
// garment's height), and smoothed across this fraction of its width
const NECK_DIP = 0.012;
const NECK_SMOOTHING = 0.03;
// Two parts of the sketch meet (a seam) where their colours, averaged over this fraction of its size, differ
// by at least PART_CONTRAST (0-255, across the three colours)
const PART_REACH = 0.025;
const PART_CONTRAST = 75;
// ... and only a seam running on for at least this fraction of the sketch's size (a print's own changes are
// short)
const PART_LENGTH = 0.2;
// An outline drawn round a painted sketch: up to this fraction of its size wide (left out of its colours)
const OUTLINE_WIDTH = 0.012;
// The hem's waves: this high (fraction of the garment's height)
const HEM_WAVE = 0.008;
// Seams: how dark (their shade over the fabric)
const SEAM_SHADE = 0.8;
const DRAWN_SEAM_SHADE = 0.6;
// A drawn fold: how dark its crease, how bright its highlight
const FOLD_SHADOW = 0.3;
const FOLD_HIGHLIGHT = 0.12;
// The shadow beneath: how far down it falls and how soft it is (fractions of the garment's size), how dark
const SHADOW_DROP = 0.012;
const SHADOW_SOFTNESS = 0.025;
const SHADOW_OPACITY = 0.16;
// Plain cloth when the sketch has no colour of its own (an undyed cotton)
const PLAIN_CLOTH: [number, number, number] = [232, 226, 214];

export type SketchRenderResult = RGBA | { error: string };

export function renderSketch(sketch: RGBA): SketchRenderResult {
  const { width: w, height: h, data } = sketch;
  const n = w * h;
  const size = Math.min(w, h);

  // --- 1. The garment ---
  // Ink: anything that isn't paper (see-through counts as paper)
  const ink = new Uint8Array(n);
  let inkCount = 0;
  for (let p = 0; p < n; p += 1) {
    if (data[p * 4 + 3] < 128) continue;
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    const lo = Math.min(r, g, b);
    if (lo >= PAPER_MIN && Math.max(r, g, b) - lo < PAPER_SPREAD) continue;
    ink[p] = 1;
    inkCount += 1;
  }
  if (inkCount < n * 0.002) return { error: "Nothing drawn here to refine: select the sketch." };
  // Filled (a painted shape: most of its ink is more than a few pixels in from the ink's edge) or lines
  const thick = erode(ink, w, h, 3);
  let thickCount = 0;
  for (let p = 0; p < n; p += 1) thickCount += thick[p];
  const filled = thickCount > inkCount * 0.4;

  let garment: Uint8Array;
  let bridge = 0;
  if (filled) {
    // The ink, with any paper it encloses
    garment = fillHoles(ink, w, h);
  } else {
    // Inside the outline: not reachable from the sketch's edge without crossing a line (lines thickened
    // first, so a gap doesn't let the outside in; the garment is then thinned back)
    bridge = Math.max(2, Math.round(size * GAP_BRIDGE));
    garment = erode(fillHoles(dilate(ink, w, h, bridge), w, h), w, h, bridge);
    const enclosed = (mask: Uint8Array) => {
      let count = 0;
      for (let p = 0; p < n; p += 1) count += mask[p];
      return count > Math.max(n * 0.01, inkCount * 2);
    };
    while (!enclosed(garment) && bridge < size * GAP_BRIDGE_MOST) {
      bridge = Math.ceil(bridge * 1.5);
      garment = erode(fillHoles(dilate(ink, w, h, bridge), w, h), w, h, bridge);
    }
    if (!enclosed(garment)) {
      return { error: "No closed garment outline found in the sketch: draw its outline as one closed line." };
    }
  }
  garment = keepLargeParts(garment, w, h, 0.02);

  // The sketch's own look, kept: each garment pixel takes the sketch's colour there (any fabric's print as it
  // is). Where the cleaned-up silhouette below reaches past what's painted, the painting is reflected out
  // across its edge (so a print carries on, not smeared): the pixel as far inside the nearest painted pixel as
  // this one is outside it. A line sketch is plain cloth.
  const source = new Uint8Array(n);
  let sourceCount = 0;
  if (filled) {
    // (Not the edge: it's blended with the paper, or drawn over with the sketch's outline)
    const inner = erode(garment, w, h, Math.max(2, Math.round(size * OUTLINE_WIDTH)));
    for (let q = 0; q < n; q += 1) {
      if (inner[q] && ink[q]) {
        source[q] = 1;
        sourceCount += 1;
      }
    }
  }
  const sketchColour = new Float32Array(n * 3);
  if (sourceCount > n * 0.002) {
    // The nearest painted pixel to each pixel (a breadth-first spread from the painting)
    const nearest = new Int32Array(n).fill(-1);
    let frontier: number[] = [];
    for (let q = 0; q < n; q += 1) {
      if (!source[q]) continue;
      nearest[q] = q;
      frontier.push(q);
    }
    while (frontier.length) {
      const next: number[] = [];
      for (const q of frontier) {
        const x = q % w;
        for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
          if (r < 0 || r >= n || nearest[r] >= 0) continue;
          nearest[r] = nearest[q];
          next.push(r);
        }
      }
      frontier = next;
    }
    for (let q = 0; q < n; q += 1) {
      let from = nearest[q];
      if (from !== q) {
        // (Reflected across the edge, if that lands on the painting)
        const qx = q % w;
        const fx = from % w;
        const rx = 2 * fx - qx;
        const ry = 2 * ((from - fx) / w) - (q - qx) / w;
        if (rx >= 0 && ry >= 0 && rx < w && ry < h && source[ry * w + rx]) from = ry * w + rx;
      }
      for (let c = 0; c < 3; c += 1) sketchColour[q * 3 + c] = data[from * 4 + c];
    }
  } else {
    for (let q = 0; q < n; q += 1) for (let c = 0; c < 3; c += 1) sketchColour[q * 3 + c] = PLAIN_CLOTH[c];
  }
  // Lines drawn on the garment (a line sketch's ink): seams and folds, below
  const drawn = new Uint8Array(n);
  if (!filled) for (let q = 0; q < n; q += 1) if (garment[q] && ink[q]) drawn[q] = 1;
  // Where clearly different parts meet: their colours averaged over an area wider than a print's motifs (so a
  // print doesn't count) change sharply, at the strongest point of that change across it
  const partR = Math.max(2, Math.round(size * PART_REACH));
  const region = [0, 1, 2].map((c) => {
    const channel = new Float32Array(n);
    for (let q = 0; q < n; q += 1) channel[q] = sketchColour[q * 3 + c];
    return boxBlur(channel, w, h, partR);
  });
  const step = (a: number, b: number) =>
    Math.hypot(region[0][a] - region[0][b], region[1][a] - region[1][b], region[2][a] - region[2][b]);
  const across = new Float32Array(n);
  const down = new Float32Array(n);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const q = y * w + x;
      across[q] = step(q - 1, q + 1);
      down[q] = step(q - w, q + w);
    }
  }
  // (A sharp change spreads over the averaging's width, two pixels of it per step)
  const partThreshold = (2 * PART_CONTRAST) / (2 * partR + 1);
  const partEdge = new Uint8Array(n);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const q = y * w + x;
      if (
        (down[q] > partThreshold && down[q] >= down[q - w] && down[q] >= down[q + w]) ||
        (across[q] > partThreshold && across[q] >= across[q - 1] && across[q] >= across[q + 1])
      ) {
        partEdge[q] = 1;
      }
    }
  }
  // (Only long seams)
  {
    const minLength = size * PART_LENGTH;
    const seen = new Uint8Array(n);
    for (let start = 0; start < n; start += 1) {
      if (!partEdge[start] || seen[start]) continue;
      const members: number[] = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const q = stack.pop()!;
        members.push(q);
        const x = q % w;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const r = q + dy * w + dx;
            if (x + dx < 0 || x + dx >= w || r < 0 || r >= n || !partEdge[r] || seen[r]) continue;
            seen[r] = 1;
            stack.push(r);
          }
        }
      }
      if (members.length < minLength) for (const q of members) partEdge[q] = 0;
    }
  }

  // (Drawn lines along the sketch's own outline are the outline, not seams or folds: the cleaned-up silhouette
  // below moves its edge, so they're dropped now)
  const sketchDist = distanceInside(garment, w, h);
  const outlineBand = bridge + Math.max(3, Math.round(size * 0.02));
  for (let p = 0; p < n; p += 1) if (drawn[p] && sketchDist[p] <= outlineBand) drawn[p] = 0;

  // The sketch's own top edge, per column (for its neckline)
  const sketchTop = new Int32Array(w).fill(-1);
  for (let p = 0; p < n; p += 1) {
    if (!garment[p]) continue;
    const x = p % w;
    if (sketchTop[x] < 0) sketchTop[x] = (p - x) / w;
  }

  // --- 2. The silhouette, cleaned up ---
  const shape = cleanSilhouette(garment, w, h);
  garment = shape.mask;
  const { top, bottom, axis, halfWidth, oneSpan } = shape;
  const gh = bottom - top + 1;
  let area = 0;
  let minX = w;
  let maxX = -1;
  for (let p = 0; p < n; p += 1) {
    if (!garment[p]) continue;
    area += 1;
    const x = p % w;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  if (area < n * 0.005) return { error: "The garment is too small to refine: select just the sketch." };
  const gw = maxX - minX + 1;
  const gSize = Math.min(gw, gh);

  // --- 5 (first, as it shapes the hem). A dress: its waist and how its skirt flares ---
  let dress: { waist: number; apexX: number; apexY: number; spread: number; folds: number } | null = null;
  if (oneSpan) {
    // The waist: where two parts meet down the middle (a bodice painted apart from its skirt), else where
    // it's narrowest
    let narrowest = -1;
    for (let y = Math.round(top + gh * 0.15); y <= top + gh * 0.6; y += 1) {
      if (halfWidth[y] > 0 && (narrowest < 0 || halfWidth[y] < halfWidth[narrowest])) narrowest = y;
    }
    let waist = -1;
    for (let y = Math.round(top + gh * 0.15); y <= top + gh * 0.65 && waist < 0; y += 1) {
      if (partEdge[y * w + Math.round(axis[y])]) waist = y;
    }
    if (waist < 0) waist = narrowest;
    let hemWidth = 0;
    for (let y = Math.round(bottom - gh * 0.1); y <= bottom; y += 1) hemWidth = Math.max(hemWidth, halfWidth[y]);
    if (narrowest > 0 && hemWidth > halfWidth[narrowest] * FLARE) {
      // The folds fan out from a point above the waist, where the skirt's sides would meet
      const flareRate = (hemWidth - halfWidth[waist]) / Math.max(1, bottom - waist);
      const apexY = waist - halfWidth[waist] / Math.max(1e-3, flareRate);
      const spread = Math.atan2(hemWidth, bottom - apexY);
      const folds = Math.max(3, Math.round((hemWidth * 2) / (gh * FOLD_SPACING)));
      dress = { waist, apexX: axis[waist], apexY, spread, folds };
    }
  }
  const foldPhase = (x: number, y: number) => {
    if (!dress) return 0;
    // (Straight lines fanning out from one point above the waist)
    const angle = Math.atan2(x - dress.apexX, y - dress.apexY);
    return (angle / dress.spread) * dress.folds * Math.PI;
  };
  // The waved hem: the skirt's bottom rises and falls with its folds
  if (dress) {
    const wave = Math.max(1, gh * HEM_WAVE);
    for (let y = Math.max(top, Math.round(bottom - wave * 2)); y <= bottom; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = y * w + x;
        if (!garment[p]) continue;
        const hemHere = bottom - wave * (1 + Math.cos(foldPhase(x, y)));
        if (y > hemHere) garment[p] = 0;
      }
    }
  }
  // The neckline: where the sketch's top dips in the middle (a V, a sweetheart), its own top edge, the same on
  // both sides (each offset from the centre line averaged with its mirror), smoothed
  if (oneSpan) {
    const hwTop = Math.max(1, halfWidth[Math.min(bottom, top + Math.round(gh * 0.05))]);
    const sketchTopAt = (x: number) => {
      const xi = Math.round(x);
      return xi >= 0 && xi < w ? sketchTop[xi] : -1;
    };
    // (Centred on its deepest point near the centre line: a hand-drawn V is rarely right in the middle)
    let centre = axis[top];
    for (let dx = -Math.round(hwTop * 0.3); dx <= hwTop * 0.3; dx += 1) {
      if (sketchTopAt(axis[top] + dx) > sketchTopAt(centre)) centre = axis[top] + dx;
    }
    const reach = Math.ceil(hwTop);
    const profile = new Float64Array(reach + 1);
    const known = new Float64Array(reach + 1);
    for (let dx = 0; dx <= reach; dx += 1) {
      const both = [sketchTopAt(centre - dx), sketchTopAt(centre + dx)].filter((v) => v >= 0);
      if (!both.length) continue;
      profile[dx] = both.reduce((a, b) => a + b, 0) / both.length;
      known[dx] = 1;
    }
    const neck = smoothRows(profile, known, 0, reach, Math.max(1, Math.round(hwTop * 2 * NECK_SMOOTHING)));
    const shoulderTop = Math.min(...Array.from(neck).filter((v, i) => known[i] && v > 0));
    if (known[0] && neck[0] - shoulderTop > gh * NECK_DIP) {
      for (let y = top; y < neck[0] + 1; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const q = y * w + x;
          if (!garment[q]) continue;
          const dx = Math.min(reach, Math.round(Math.abs(x - centre)));
          if (known[dx] && y < neck[dx]) garment[q] = 0;
        }
      }
    }
  }
  // Its edge anti-aliased
  const soft = boxBlur(Float32Array.from(garment), w, h, 1);

  // --- 3. The fabric: the sketch's own, with a faint grain so plain colour isn't flat paint ---
  const fill = new Float32Array(n * 3);
  for (let p = 0; p < n; p += 1) {
    if (!soft[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    const grain = 1 + 0.008 * noise(x, y);
    for (let c = 0; c < 3; c += 1) fill[p * 3 + c] = sketchColour[p * 3 + c] * grain;
  }

  // --- 4. Shading: rounded across, lit from the left; a touch lighter at the top ---
  const shade = new Float32Array(n).fill(1);
  for (let y = top; y <= bottom; y += 1) {
    const hw = Math.max(1, halfWidth[y] || gw / 2);
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!soft[p]) continue;
      const across = Math.max(-1, Math.min(1, (x - axis[y]) / hw));
      const round = 1 - SIDE_SHADE * Math.abs(across) ** 2.5;
      const lit = 1 - SIDE_LIGHT * across;
      const fall = 1.02 - 0.05 * ((y - top) / gh);
      shade[p] = round * lit * fall;
    }
  }

  // --- 5. A dress's seams and folds ---
  if (dress) {
    const { waist } = dress;
    const seamHalf = Math.max(1, gSize * 0.004);
    for (let y = top; y <= bottom; y += 1) {
      const hw = Math.max(1, halfWidth[y]);
      for (let x = 0; x < w; x += 1) {
        const p = y * w + x;
        if (!soft[p]) continue;
        let s = 1;
        // The waist seam
        const fromWaist = Math.abs(y - waist);
        if (fromWaist < seamHalf * 2) s *= 1 - (1 - SEAM_SHADE) * (1 - fromWaist / (seamHalf * 2));
        if (y < waist) {
          // Bodice seams: curving in from the bust to the waist
          const t = (y - top) / Math.max(1, waist - top);
          if (t > 0.15) {
            const seamX = hw * (0.55 - 0.15 * t);
            const off = Math.abs(Math.abs(x - axis[y]) - seamX);
            if (off < seamHalf * 1.5) s *= 1 - (1 - SEAM_SHADE) * 0.8 * (1 - off / (seamHalf * 1.5));
          }
        } else {
          // The skirt's folds: deeper toward the hem, soft valleys between broad ridges
          const depth = Math.min(1, (y - waist) / Math.max(1, bottom - waist)) ** 0.8;
          const wave = 0.5 - 0.5 * Math.cos(foldPhase(x, y));
          s *= 1 - FOLD_DEPTH * depth * wave ** 1.6;
          s *= 1 + 0.05 * depth * (1 - wave) ** 3;
        }
        shade[p] *= s;
      }
    }
  }

  // Where two parts meet: a seam
  for (let p = 0; p < n; p += 1) {
    if (!soft[p] || !partEdge[p]) continue;
    const x = p % w;
    shade[p] *= SEAM_SHADE;
    if (x < w - 1) shade[p + 1] *= (1 + SEAM_SHADE) / 2;
    if (p + w < n) shade[p + w] *= (1 + SEAM_SHADE) / 2;
  }

  // --- 6. Lines drawn on the garment: seams (joined to its edge) and folds (on their own) ---
  const dist = distanceInside(garment, w, h);
  const edgeBand = bridge + Math.max(3, Math.round(gSize * 0.015));
  const seamLines = new Uint8Array(n);
  const foldLines = new Float32Array(n);
  {
    const label = new Int32Array(n).fill(-1);
    for (let start = 0; start < n; start += 1) {
      if (!drawn[start] || !garment[start] || label[start] >= 0) continue;
      const members: number[] = [];
      let joined = false;
      const stack = [start];
      label[start] = start;
      while (stack.length) {
        const p = stack.pop()!;
        members.push(p);
        if (dist[p] <= edgeBand) joined = true;
        const x = p % w;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const q = p + dy * w + dx;
            if (nx < 0 || nx >= w || q < 0 || q >= n || !drawn[q] || !garment[q] || label[q] >= 0) continue;
            label[q] = start;
            stack.push(q);
          }
        }
      }
      // (The outline itself, near the edge, is neither)
      for (const p of members) {
        if (dist[p] <= edgeBand) continue;
        if (joined) seamLines[p] = 1;
        else foldLines[p] = 1;
      }
    }
  }
  const seamSoft = boxBlur(Float32Array.from(seamLines), w, h, 1);
  for (let p = 0; p < n; p += 1) if (seamSoft[p] > 0) shade[p] *= 1 - (1 - DRAWN_SEAM_SHADE) * Math.min(1, seamSoft[p] * 2);
  const foldR = Math.max(2, Math.round(gSize * 0.012));
  const fold = boxBlur(boxBlur(foldLines, w, h, foldR), w, h, foldR);
  let foldPeak = 0;
  for (let p = 0; p < n; p += 1) foldPeak = Math.max(foldPeak, fold[p]);
  if (foldPeak > 0) {
    const shift = Math.max(1, Math.round(foldR * 1.2));
    for (let p = 0; p < n; p += 1) {
      if (!soft[p]) continue;
      const x = p % w;
      const y = (p - x) / w;
      const crease = Math.min(1, fold[p] / foldPeak);
      // (The highlight: the crease's shading, moved toward the light)
      const sx = Math.min(w - 1, Math.max(0, x + shift));
      const sy = Math.min(h - 1, Math.max(0, y + shift));
      const lit = Math.min(1, fold[sy * w + sx] / foldPeak) * (1 - crease);
      shade[p] *= (1 - FOLD_SHADOW * crease) * (1 + FOLD_HIGHLIGHT * lit);
    }
  }

  // The garment, see-through around it
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p += 1) {
    if (soft[p] <= 0) continue;
    for (let c = 0; c < 3; c += 1) out[p * 4 + c] = fill[p * 3 + c] * shade[p];
    out[p * 4 + 3] = Math.round(soft[p] * 255);
  }

  // --- 7. The soft shadow beneath, where the garment isn't ---
  const drop = Math.max(1, Math.round(gSize * SHADOW_DROP));
  const shadowR = Math.max(1, Math.round(gSize * SHADOW_SOFTNESS));
  const shadow = boxBlur(boxBlur(Float32Array.from(garment), w, h, shadowR), w, h, shadowR);
  for (let p = 0; p < n; p += 1) {
    const x = p % w;
    const y = (p - x) / w;
    const from = y - drop;
    if (from < 0) continue;
    const s = shadow[from * w + x] * SHADOW_OPACITY;
    const a = out[p * 4 + 3] / 255;
    if (s <= 0 || a >= 1) continue;
    // Garment over shadow (black at opacity s)
    const outA = a + s * (1 - a);
    for (let c = 0; c < 3; c += 1) out[p * 4 + c] = (out[p * 4 + c] * a) / outA;
    out[p * 4 + 3] = Math.round(outA * 255);
  }

  return { data: out, width: w, height: h };
}

// --- The silhouette ---

// The garment's silhouette evened out (see step 2 above), and per row its centre line and half-width
function cleanSilhouette(sketched: Uint8Array, w: number, h: number) {
  const n = sketched.length;
  // Notches and slivers between the sketch's pieces closed first (so a row isn't split by a crack)
  const closeR = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const mask = fillHoles(erode(dilate(sketched, w, h, closeR), w, h, closeR), w, h);
  // Per row: its outermost garment pixels, and whether the garment is one piece across it
  const left = new Float64Array(h).fill(-1);
  const right = new Float64Array(h).fill(-1);
  let rows = 0;
  let oneSpanRows = 0;
  let top = h;
  let bottom = -1;
  for (let y = 0; y < h; y += 1) {
    let spans = 0;
    let inside = false;
    for (let x = 0; x < w; x += 1) {
      const on = mask[y * w + x] === 1;
      if (on && !inside) spans += 1;
      if (on) {
        if (left[y] < 0) left[y] = x;
        right[y] = x;
      }
      inside = on;
    }
    if (!spans) continue;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const height = Math.max(1, bottom - top + 1);
  // (A row split only down its middle, by a neckline, counts as one piece; one split at its sides, between
  // sleeves and the body, doesn't)
  for (let y = top; y <= bottom; y += 1) {
    const gaps: Array<[number, number]> = [];
    let lastOn = -1;
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x] !== 1) continue;
      if (lastOn >= 0 && x > lastOn + 1) gaps.push([lastOn + 1, x - 1]);
      lastOn = x;
    }
    if (lastOn < 0) continue;
    rows += 1;
    // (Down the middle: the gap's centre in the middle two fifths of the row, as a hand-drawn neckline is
    // rarely exactly central)
    const middle = (left[y] + right[y]) / 2;
    const central = (gap: [number, number]) => Math.abs((gap[0] + gap[1]) / 2 - middle) <= (right[y] - left[y]) * 0.2;
    if (!gaps.length || (gaps.length === 1 && central(gaps[0]))) oneSpanRows += 1;
  }
  const oneSpan = rows > 0 && rows - oneSpanRows <= Math.max(2, rows * 0.01);

  // The centre line: the rows' middles, weighted by width and smoothed heavily (a garment hangs straight)
  const middles = new Float64Array(h);
  const widths = new Float64Array(h);
  for (let y = top; y <= bottom; y += 1) {
    if (left[y] < 0) continue;
    middles[y] = (left[y] + right[y]) / 2;
    widths[y] = right[y] - left[y] + 1;
  }
  const axis = smoothRows(middles, widths, top, bottom, Math.max(2, Math.round(height * CENTRE_SMOOTHING)));
  // The half-width: each row's farther edge from that line averaged with the nearer (so both sides match),
  // smoothed down the height
  const half = new Float64Array(h);
  const present = new Float64Array(h);
  for (let y = top; y <= bottom; y += 1) {
    if (left[y] < 0) continue;
    half[y] = (Math.abs(axis[y] - left[y]) + Math.abs(right[y] - axis[y])) / 2;
    present[y] = 1;
  }
  const halfWidth = smoothRows(half, present, top, bottom, Math.max(1, Math.round(height * WIDTH_SMOOTHING)));

  const out = new Uint8Array(n);
  if (oneSpan) {
    for (let y = top; y <= bottom; y += 1) {
      if (left[y] < 0) continue;
      for (let x = 0; x < w; x += 1) if (Math.abs(x - axis[y]) <= halfWidth[y]) out[y * w + x] = 1;
    }
  } else {
    // Smoothed; and mirrored about the centre line if it's nearly symmetric already
    const radius = Math.max(2, Math.round(height * 0.012));
    const soft = boxBlur(boxBlur(Float32Array.from(mask), w, h, radius), w, h, radius);
    const mirrorOf = (x: number, y: number) => {
      const mx = Math.round(2 * axis[y] - x);
      return mx >= 0 && mx < w ? soft[y * w + mx] : 0;
    };
    let overlap = 0;
    let union = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const a = soft[y * w + x] >= 0.5;
        const b = mirrorOf(x, y) >= 0.5;
        if (a && b) overlap += 1;
        if (a || b) union += 1;
      }
    }
    const mirror = union > 0 && overlap / union >= MIRROR_OVERLAP;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = y * w + x;
        const v = mirror && y >= top && y <= bottom ? (soft[p] + mirrorOf(x, y)) / 2 : soft[p];
        if (v >= 0.5) out[p] = 1;
      }
    }
  }
  return { mask: out, top, bottom, axis, halfWidth, oneSpan };
}

// Values per row averaged (by weight) over the rows within radius, from top to bottom
function smoothRows(values: Float64Array, weights: Float64Array, top: number, bottom: number, radius: number) {
  const out = new Float64Array(values.length);
  for (let y = top; y <= bottom; y += 1) {
    let sum = 0;
    let weight = 0;
    for (let k = Math.max(top, y - radius); k <= Math.min(bottom, y + radius); k += 1) {
      sum += values[k] * weights[k];
      weight += weights[k];
    }
    out[y] = weight > 0 ? sum / weight : values[y];
  }
  return out;
}

// --- helpers ---

// The mask with every hole in it filled (anything not reachable from the image's edge without crossing it)
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = mask.length;
  const outside = new Uint8Array(n);
  const queue: number[] = [];
  const reach = (p: number) => {
    if (outside[p] || mask[p]) return;
    outside[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < w; x += 1) {
    reach(x);
    reach((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    reach(y * w);
    reach(y * w + w - 1);
  }
  while (queue.length) {
    const p = queue.pop()!;
    const x = p % w;
    if (x > 0) reach(p - 1);
    if (x < w - 1) reach(p + 1);
    if (p >= w) reach(p - w);
    if (p < n - w) reach(p + w);
  }
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (!outside[p]) out[p] = 1;
  return out;
}

// Mask grown (dilate) or shrunk (erode) by r pixels (a square neighbourhood, from running sums)
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const sums = boxSums(mask, w, h, r);
  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p += 1) if (sums[p] > 0) out[p] = 1;
  return out;
}
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inverse = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p += 1) inverse[p] = mask[p] ? 0 : 1;
  const grown = dilate(inverse, w, h, r);
  for (let p = 0; p < mask.length; p += 1) inverse[p] = grown[p] ? 0 : 1;
  return inverse;
}
// The sum over each pixel's (2r+1)-square
function boxSums(values: ArrayLike<number>, w: number, h: number, r: number): Float64Array {
  const sums = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += values[y * w + x];
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      out[y * w + x] = sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0];
    }
  }
  return out;
}
// The mean over each pixel's (2r+1)-square (shrunk at the image's edges)
function boxBlur(values: Float32Array, w: number, h: number, r: number): Float32Array {
  const sums = boxSums(values, w, h, r);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const ny = Math.min(h, y + r + 1) - Math.max(0, y - r);
    for (let x = 0; x < w; x += 1) {
      const nx = Math.min(w, x + r + 1) - Math.max(0, x - r);
      out[y * w + x] = sums[y * w + x] / (nx * ny);
    }
  }
  return out;
}

// Only the parts of a mask at least this fraction of its biggest part's size (stray specks dropped)
function keepLargeParts(mask: Uint8Array, w: number, h: number, fraction: number): Uint8Array {
  const n = mask.length;
  const label = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < n; start += 1) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      count += 1;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= n || !mask[q] || label[q] >= 0) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    sizes.push(count);
  }
  const biggest = Math.max(0, ...sizes);
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (label[p] >= 0 && sizes[label[p]] >= biggest * fraction) out[p] = 1;
  return out;
}

// Each mask pixel's distance from the nearest pixel outside it (a two-pass chamfer approximation)
function distanceInside(mask: Uint8Array, w: number, h: number): Float32Array {
  const n = mask.length;
  const d = new Float32Array(n);
  const far = w + h;
  for (let p = 0; p < n; p += 1) d[p] = mask[p] ? far : 0;
  const diag = Math.SQRT2;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!d[p]) continue;
      let v = d[p];
      v = Math.min(v, x > 0 ? d[p - 1] + 1 : 1, y > 0 ? d[p - w] + 1 : 1);
      if (y > 0) v = Math.min(v, x > 0 ? d[p - w - 1] + diag : diag, x < w - 1 ? d[p - w + 1] + diag : diag);
      d[p] = v;
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const p = y * w + x;
      if (!d[p]) continue;
      let v = d[p];
      v = Math.min(v, x < w - 1 ? d[p + 1] + 1 : 1, y < h - 1 ? d[p + w] + 1 : 1);
      if (y < h - 1) v = Math.min(v, x < w - 1 ? d[p + w + 1] + diag : diag, x > 0 ? d[p + w - 1] + diag : diag);
      d[p] = v;
    }
  }
  return d;
}

// A repeatable value in [-1, 1] for pixel (x, y)
function noise(x: number, y: number) {
  let v = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return (((v ^ (v >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}
