// Turns a rough jewellery sketch into polished metal with a 3D look, with no AI:
// 1. The piece: exactly what's drawn on the paper, as wide as it's drawn. A line becomes round wire of that
//    width (a chain, a ring's band; one too thin to be wire is thickened a little); a painted shape becomes a
//    cast piece with rounded, bevelled edges (a pendant, a plate). Nothing is filled in: a ring drawn as a
//    circle stays a ring.
// 2. Its material, from the colour it's drawn in, one metal for each connected piece (what most of it is drawn
//    in, judged by its core, not its edges blended with the paper): the Studio's metallic pens (22K gold,
//    platinum, silver, copper, rose gold) are those metals; otherwise yellow or orange is gold, light grey
//    platinum, darker grey silver (black pen is whichever metal the rest is, gold if none), and red, green,
//    blue, pink or purple paint is a gemstone.
// 3. Its shape in depth: a height for each pixel, rising from the edge, round across a wire evenly all along
//    it (as wide as the line is drawn), a bevel round a flat piece; and from it which way the surface faces.
// 4. The metal's shine: polished metal shows what's around it, so each pixel shows the studio it faces (bright
//    lights above, a dark horizon, a soft floor), in the metal's colours: deep in the shadows, warm in the
//    midtones, nearly white in the highlights. A gem sits in a thin metal setting and is cut like a real stone:
//    a flat table in the middle, facets round it, each catching the light differently, with sparkles.
// 5. A soft shadow beneath. Everything else comes out see-through.

import { boxBlur, dilate, distanceInside, erode, keepLargeParts } from "./sketchRender";

type RGBA = { data: Uint8ClampedArray; width: number; height: number };

// Paper: white (the sketch is drawn out on white; a light grey drawn on it, like platinum, is ink)
const PAPER_MIN = 248;
const PAPER_SPREAD = 8;
// Grey this light (0-255) or lighter is platinum; darker, silver
const PLATINUM_LIGHTNESS = 210;
// Pen lines are thickened into wire this wide (fraction of the sketch's size, at least 2 pixels each side)
const WIRE_RADIUS = 0.008;
// A flat piece's bevel: its edge rounds over this far in (fraction of the sketch's size)
const BEVEL = 0.03;
// How high the surface rises for its width (more: stronger relief, bolder reflections)
const RELIEF = 1.4;
// The camera looks down on the piece a little (so a flat face catches the ceiling's light, not the horizon),
// and a reflection shifts across a flat face as it would seen up close (how much, across the whole sketch)
const VIEW_TILT = 0.3;
const PERSPECTIVE = 0.35;
// A gem's cut: this many facets round it, its flat table this fraction of its radius, and its metal setting
// this fraction of the sketch's size wide
const FACETS_ROUND = 16;
const GEM_TABLE = 0.45;
const SETTING = 0.006;
// The shadow beneath: how far down it falls and how soft it is (fractions of the sketch's size), how dark
const SHADOW_DROP = 0.008;
const SHADOW_SOFTNESS = 0.012;
const SHADOW_OPACITY = 0.22;

// The metals: the colour of the Studio's pen for each, and the metal's colours from shadow through midtone to
// highlight (0-1 each) with how bright the studio's reflections show in it
type Metal = { pen: [number, number, number]; ramp: Array<[number, number, number]>; exposure: number };
const METAL_GOLD = 1;
const METAL_SILVER = 2;
const GEM = 3;
const METAL_PLATINUM = 4;
const METAL_COPPER = 5;
const METAL_ROSE_GOLD = 6;
const METALS: Record<number, Metal> = {
  // 22 carat: rich and buttery, deep amber (not brown) in its shadows, saturated warm yellow through its body
  [METAL_GOLD]: {
    pen: [0xff, 0xc1, 0x25],
    ramp: [
      [0.36, 0.17, 0.0],
      [0.74, 0.46, 0.04],
      [0.96, 0.72, 0.16],
      [1.0, 0.86, 0.36],
      [1.0, 0.95, 0.68],
      [1.0, 1.0, 0.9],
    ],
    exposure: 1.2,
  },
  // Whiter and a touch cooler than silver, its shadows a soft grey (a denser, brighter white metal)
  [METAL_PLATINUM]: {
    pen: [0xe5, 0xe4, 0xe2],
    ramp: [
      [0.24, 0.25, 0.28],
      [0.56, 0.58, 0.62],
      [0.8, 0.82, 0.86],
      [0.94, 0.95, 0.97],
      [1.0, 1.0, 1.0],
    ],
    exposure: 1.15,
  },
  [METAL_SILVER]: {
    pen: [0xc0, 0xc0, 0xc0],
    ramp: [
      [0.12, 0.12, 0.13],
      [0.42, 0.43, 0.45],
      [0.74, 0.75, 0.78],
      [0.93, 0.94, 0.96],
      [1.0, 1.0, 1.0],
    ],
    exposure: 1.25,
  },
  // Warm reddish orange, deep brown-red in its shadows, peachy in its highlights
  [METAL_COPPER]: {
    pen: [0xb8, 0x73, 0x33],
    ramp: [
      [0.24, 0.07, 0.02],
      [0.56, 0.22, 0.08],
      [0.84, 0.46, 0.24],
      [0.97, 0.7, 0.5],
      [1.0, 0.9, 0.8],
    ],
    exposure: 1.2,
  },
  // Soft pink gold: rosy browns in its shadows, blush through its body, near white in its highlights
  [METAL_ROSE_GOLD]: {
    pen: [0xb7, 0x6e, 0x79],
    ramp: [
      [0.3, 0.12, 0.1],
      [0.64, 0.36, 0.32],
      [0.88, 0.62, 0.56],
      [0.98, 0.82, 0.77],
      [1.0, 0.95, 0.92],
    ],
    exposure: 1.2,
  },
};
const METAL_IDS = [METAL_GOLD, METAL_PLATINUM, METAL_SILVER, METAL_COPPER, METAL_ROSE_GOLD];
// A colour within this distance (0-255, across the three colours) of a metal's pen is that metal
const PEN_MATCH = 40;

export type JewelryRenderResult = RGBA | { error: string };

export function renderJewelry(sketch: RGBA): JewelryRenderResult {
  const { width: w, height: h, data } = sketch;
  const n = w * h;
  const size = Math.min(w, h);

  // --- 1. The piece, and 2. its material ---
  // Ink, and the colour family each ink pixel is drawn in (dark pen: none, its piece decides)
  const ink = new Uint8Array(n);
  const family = new Uint8Array(n);
  let inkCount = 0;
  for (let p = 0; p < n; p += 1) {
    if (data[p * 4 + 3] < 128) continue;
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    if (lo >= PAPER_MIN && hi - lo < PAPER_SPREAD) continue;
    ink[p] = 1;
    inkCount += 1;
    const sat = hi > 0 ? (hi - lo) / hi : 0;
    const hue = hueOf(r, g, b);
    if (hi < 77) continue;
    // A metallic pen's colour, else by its hue and how grey it is
    let pen = 0;
    let penDistance = PEN_MATCH;
    for (const id of METAL_IDS) {
      const [mr, mg, mb] = METALS[id].pen;
      const d = Math.hypot(r - mr, g - mg, b - mb);
      if (d < penDistance) {
        penDistance = d;
        pen = id;
      }
    }
    if (pen) family[p] = pen;
    else if (sat < 0.22) family[p] = hi >= PLATINUM_LIGHTNESS ? METAL_PLATINUM : METAL_SILVER;
    else if (hue >= 20 && hue <= 65) family[p] = METAL_GOLD;
    else family[p] = GEM;
  }
  if (inkCount < n * 0.001) return { error: "Nothing drawn here to refine: select the jewellery sketch." };
  // Gems are where gem colours are painted; every other connected piece is one metal, what most of it is drawn
  // in (gold if it's all pen, or whichever metal the rest of the sketch is)
  const material = new Uint8Array(n);
  {
    const metalInk = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) {
      if (!ink[p]) continue;
      if (family[p] === GEM) material[p] = GEM;
      else metalInk[p] = 1;
    }
    const parts = components(metalInk, w, h);
    // (Judged by each piece's core: its edge pixels are blended with the paper, paler than it's drawn. A piece
    // too thin to have a core is judged by all of it.)
    const core = erode(ink, w, h, 1);
    const votesOf = (part: number[]) => {
      const hasCore = part.some((q) => core[q]);
      const votes: Record<number, number> = {};
      for (const id of METAL_IDS) votes[id] = 0;
      for (const q of part) if ((!hasCore || core[q]) && votes[family[q]] !== undefined) votes[family[q]] += 1;
      return votes;
    };
    const allVotes: Record<number, number> = {};
    for (const id of METAL_IDS) allVotes[id] = 0;
    const partVotes = parts.map(votesOf);
    for (const votes of partVotes) for (const id of METAL_IDS) allVotes[id] += votes[id];
    const commonest = (votes: Record<number, number>, otherwise: number) => {
      let best = otherwise;
      let most = 0;
      for (const metal of METAL_IDS) {
        if (votes[metal] > most) {
          most = votes[metal];
          best = metal;
        }
      }
      return best;
    };
    const usual = commonest(allVotes, METAL_GOLD);
    parts.forEach((part, i) => {
      const metal = commonest(partVotes[i], usual);
      for (const q of part) material[q] = metal;
    });
  }

  // How wide each piece is drawn: half its width, the middle of the most typical cross-section (the median of
  // its pixels' distance in from the edge along its middle)
  const inkDist = distanceInside(ink, w, h);
  const halfWidthOf = (part: number[], dist: Float32Array) => {
    const middles: number[] = [];
    for (const q of part) {
      const x = q % w;
      const d = dist[q];
      if (!d) continue;
      const left = x > 0 ? dist[q - 1] : 0;
      const right = x < w - 1 ? dist[q + 1] : 0;
      const up = q >= w ? dist[q - w] : 0;
      const down = q + w < n ? dist[q + w] : 0;
      // (Along the middle: no farther in than its neighbours across it, one way or the other)
      if ((d >= left && d >= right) || (d >= up && d >= down)) middles.push(d);
    }
    if (!middles.length) return 1;
    middles.sort((a, b) => a - b);
    return middles[Math.floor(middles.length / 2)];
  };
  // Lines too thin to be wire are thickened to the thinnest wire, evenly
  const thinnest = Math.max(2, Math.round(size * WIRE_RADIUS));
  let piece: Uint8Array = ink.slice();
  for (const part of components(ink, w, h)) {
    const half = halfWidthOf(part, inkDist);
    if (half >= thinnest) continue;
    const mask = new Uint8Array(n);
    for (const q of part) mask[q] = 1;
    const grown = dilate(mask, w, h, Math.round(thinnest - half));
    for (let q = 0; q < n; q += 1) if (grown[q]) piece[q] = 1;
  }
  // Its edge smoothed a touch (the anti-aliasing's stair steps), specks dropped
  const smoothed = boxBlur(Float32Array.from(piece), w, h, 1);
  piece = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (smoothed[p] >= 0.5) piece[p] = 1;
  piece = keepLargeParts(piece, w, h, 0.01);
  // Every pixel of the piece takes the material of the nearest ink (thickened wire, smoothed edges)
  spreadNearest(material, ink, w, h);
  // Each gem's setting: its outer band becomes the metal it's set in (the nearest metal, else gold)
  {
    const gemMask = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) if (piece[p] && material[p] === GEM) gemMask[p] = 1;
    const inner = erode(gemMask, w, h, Math.max(1, Math.round(size * SETTING)));
    const metalInk = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) if (ink[p] && material[p] !== GEM) metalInk[p] = 1;
    const nearestMetal = nearestOf(metalInk, w, h);
    for (let p = 0; p < n; p += 1) {
      if (!gemMask[p] || inner[p]) continue;
      material[p] = nearestMetal[p] >= 0 ? material[nearestMetal[p]] : METAL_GOLD;
    }
  }
  // (Each gem's own colour, as painted: nearest painted gem pixel)
  const gemColour = new Float32Array(n * 3);
  {
    const gemInk = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) if (ink[p] && material[p] === GEM) gemInk[p] = 1;
    const nearest = nearestOf(gemInk, w, h);
    for (let p = 0; p < n; p += 1) {
      const q = nearest[p];
      if (q < 0) continue;
      for (let c = 0; c < 3; c += 1) gemColour[p * 3 + c] = data[q * 4 + c] / 255;
    }
  }

  // --- 3. Its shape in depth ---
  // Round across each part, evenly all along it: rising to its full height as far in as it's half wide (a line),
  // or as far in as the bevel goes (a broad piece), flat on top beyond
  const dist = distanceInside(piece, w, h);
  const bevel = Math.max(3, size * BEVEL);
  const reachOf = new Float32Array(n);
  for (const part of components(piece, w, h)) {
    const reach = Math.max(1, Math.min(bevel, halfWidthOf(part, dist)));
    for (const q of part) reachOf[q] = reach;
  }
  const height = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    if (!piece[p]) continue;
    const reach = reachOf[p];
    const t = Math.min(1, dist[p] / reach);
    // A quarter circle up from the edge
    height[p] = reach * RELIEF * Math.sqrt(1 - (1 - t) * (1 - t));
  }
  const surface = boxBlur(height, w, h, 1);

  // Each stone's cut: its centre and size, then per pixel the facet it's on (the flat table in the middle, or one
  // of the facets round it, alternately tipped more and less, so neighbours catch the light differently)
  const stone = new Int32Array(n).fill(-1);
  const stones: Array<{ x: number; y: number; r: number }> = [];
  {
    for (let start = 0; start < n; start += 1) {
      if (!piece[start] || material[start] !== GEM || stone[start] >= 0) continue;
      const id = stones.length;
      const members: number[] = [];
      const stack = [start];
      stone[start] = id;
      while (stack.length) {
        const q = stack.pop()!;
        members.push(q);
        const x = q % w;
        for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
          if (r < 0 || r >= n || !piece[r] || material[r] !== GEM || stone[r] >= 0) continue;
          stone[r] = id;
          stack.push(r);
        }
      }
      let sx = 0;
      let sy = 0;
      for (const q of members) {
        sx += q % w;
        sy += Math.floor(q / w);
      }
      stones.push({ x: sx / members.length, y: sy / members.length, r: Math.sqrt(members.length / Math.PI) });
    }
  }
  const facetTilt = (x: number, y: number, id: number) => {
    const { x: cx, y: cy, r } = stones[id];
    const dx = x - cx;
    const dy = y - cy;
    const out = Math.hypot(dx, dy) / Math.max(1, r);
    if (out < GEM_TABLE) return [0, 0];
    // Which facet round it, and whether it's an inner (star) or outer (girdle) one
    const angle = Math.atan2(dy, dx);
    const sector = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * FACETS_ROUND);
    const mid = ((sector + 0.5) / FACETS_ROUND) * 2 * Math.PI - Math.PI;
    const outer = out > (1 + GEM_TABLE) / 2 ? 1 : 0;
    const tip = (sector + outer) % 2 === 0 ? 0.55 : 0.3;
    return [Math.cos(mid) * tip * (outer ? 1.3 : 1), Math.sin(mid) * tip * (outer ? 1.3 : 1)];
  };

  // --- 4. The shine ---
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!piece[p]) continue;
      // Which way the surface faces (from its slope)
      const sx = (x < w - 1 ? surface[p + 1] : surface[p]) - (x > 0 ? surface[p - 1] : surface[p]);
      const sy = (y < h - 1 ? surface[p + w] : surface[p]) - (y > 0 ? surface[p - w] : surface[p]);
      let nx = -sx / 2;
      let ny = -sy / 2;
      if (material[p] === GEM && stone[p] >= 0) {
        // (A cut stone is flat across its facets: their tilt, not the bevel)
        const [tx, ty] = facetTilt(x, y, stone[p]);
        nx = tx;
        ny = ty;
      }
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const nz = 1 / len;
      // What it reflects of the studio, seen from a little above (and from this pixel's side of the sketch)
      const vlen = Math.hypot(VIEW_TILT, 1);
      const vy = VIEW_TILT / vlen;
      const vz = 1 / vlen;
      const along = ny * vy + nz * vz;
      const rx = 2 * along * nx + PERSPECTIVE * (x / w - 0.5);
      const ry = 2 * along * ny - vy + PERSPECTIVE * (y / h - 0.5);
      const rz = 2 * along * nz - vz;
      const seen = studio(rx, ry, rz);
      let colour: [number, number, number];
      if (material[p] === GEM) {
        const base: [number, number, number] = [gemColour[p * 3], gemColour[p * 3 + 1], gemColour[p * 3 + 2]];
        // Deeper toward the rim, lit through its facets, sparkling where a facet catches a light
        const depth = Math.min(1, dist[p] / bevel);
        const body = 0.25 + 0.75 * Math.min(1, seen * 0.8) * (0.55 + 0.45 * depth);
        const sparkle = Math.max(0, seen - 1.05) * 2.5;
        colour = [0, 1, 2].map((c) => Math.min(1, base[c] * body * 1.25 + sparkle)) as [number, number, number];
      } else {
        const metal = METALS[material[p]] ?? METALS[METAL_GOLD];
        colour = ramp(metal.ramp, seen / metal.exposure);
        // (A faint polish texture)
        const polish = 1 + 0.015 * noise(x, y);
        colour = colour.map((v) => Math.min(1, v * polish)) as [number, number, number];
      }
      for (let c = 0; c < 3; c += 1) out[p * 4 + c] = Math.round(colour[c] * 255);
      out[p * 4 + 3] = 255;
    }
  }
  // Edges anti-aliased
  const cover = boxBlur(Float32Array.from(piece), w, h, 1);
  for (let p = 0; p < n; p += 1) {
    if (!out[p * 4 + 3]) continue;
    out[p * 4 + 3] = Math.round(Math.min(1, cover[p] * 1.6) * 255);
  }

  // --- 5. The soft shadow beneath ---
  const drop = Math.max(1, Math.round(size * SHADOW_DROP));
  const shadowR = Math.max(1, Math.round(size * SHADOW_SOFTNESS));
  const shadow = boxBlur(boxBlur(Float32Array.from(piece), w, h, shadowR), w, h, shadowR);
  for (let p = 0; p < n; p += 1) {
    const x = p % w;
    const y = (p - x) / w;
    const from = y - drop;
    if (from < 0) continue;
    const s = shadow[from * w + x] * SHADOW_OPACITY;
    const a = out[p * 4 + 3] / 255;
    if (s <= 0 || a >= 1) continue;
    const outA = a + s * (1 - a);
    for (let c = 0; c < 3; c += 1) out[p * 4 + c] = (out[p * 4 + c] * a) / outA;
    out[p * 4 + 3] = Math.round(outA * 255);
  }

  return { data: out, width: w, height: h };
}

// --- The studio a polished piece reflects ---

// How bright the studio is in direction (x, y, z) (y down the picture, z toward the viewer): a big soft light
// above to the left, a smaller one to the right, a bright ceiling falling off to a dark horizon band, a dim
// floor. About 0-1.4.
function studio(x: number, y: number, z: number): number {
  const up = -y;
  let light = 0.08;
  // Ceiling and floor, with a dark band at the horizon (the bold dark streak polished metal shows)
  light += up > 0 ? 0.55 * Math.min(1, up * 1.6) : 0.18 * Math.min(1, -up * 2);
  light -= 0.22 * Math.exp(-(up * up) / 0.006);
  // Soft boxes: key above left (with a hot centre: polished metal's sharp glint), fill to the right, a rim light
  // low right
  light += 1.1 * Math.exp(-((x + 0.45) ** 2 + (y + 0.5) ** 2) / 0.05);
  light += 0.7 * Math.exp(-((x + 0.38) ** 2 + (y + 0.42) ** 2) / 0.008);
  light += 0.55 * Math.exp(-((x - 0.55) ** 2 + (y + 0.15) ** 2) / 0.04);
  light += 0.35 * Math.exp(-((x - 0.3) ** 2 + (y - 0.6) ** 2) / 0.03);
  // Facing straight back at the viewer: the dark of the camera's surroundings
  light -= 0.15 * Math.max(0, z) ** 8;
  return Math.max(0, light);
}

// A colour along a ramp of stops (t from 0 to 1)
function ramp(stops: Array<[number, number, number]>, t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(k));
  const f = k - i;
  return [0, 1, 2].map((c) => stops[i][c] * (1 - f) + stops[i + 1][c] * f) as [number, number, number];
}

// --- helpers ---

// A colour's hue (0-360)
function hueOf(r: number, g: number, b: number): number {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  if (hi === lo) return 0;
  let hue;
  if (hi === r) hue = ((g - b) / (hi - lo)) % 6;
  else if (hi === g) hue = (b - r) / (hi - lo) + 2;
  else hue = (r - g) / (hi - lo) + 4;
  return (hue * 60 + 360) % 360;
}

// For each pixel, the nearest pixel set in mask (a breadth-first spread; -1 if none)
function nearestOf(mask: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h;
  const nearest = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let p = 0; p < n; p += 1) {
    if (!mask[p]) continue;
    nearest[p] = p;
    frontier.push(p);
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
  return nearest;
}

// Every pixel's value taken from the nearest pixel in from (in place)
function spreadNearest(values: Uint8Array, from: Uint8Array, w: number, h: number) {
  const nearest = nearestOf(from, w, h);
  const copy = values.slice();
  for (let p = 0; p < values.length; p += 1) if (nearest[p] >= 0) values[p] = copy[nearest[p]];
}

// The connected parts of a mask (touching across corners too), each as its pixels
function components(mask: Uint8Array, w: number, h: number): number[][] {
  const n = w * h;
  const seen = new Uint8Array(n);
  const parts: number[][] = [];
  for (let start = 0; start < n; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const part: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      part.push(q);
      const x = q % w;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const r = q + dy * w + dx;
          if (nx < 0 || nx >= w || r < 0 || r >= n || !mask[r] || seen[r]) continue;
          seen[r] = 1;
          stack.push(r);
        }
      }
    }
    parts.push(part);
  }
  return parts;
}

// A repeatable value in [-1, 1] for (x, y)
function noise(x: number, y: number) {
  let v = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return (((v ^ (v >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}
