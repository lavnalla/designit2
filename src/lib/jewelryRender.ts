// Turns a rough jewellery sketch into polished metal with a 3D look, with no AI:
// 1. The piece: exactly what's drawn on the paper, as fine as it's drawn. A line's soft edge (where the pen's
//    colour fades into the paper) isn't counted as metal, only kept as the metal's own soft edge, so a fine line
//    stays fine. A line becomes round wire of its width (a chain, a ring's band, filigree); a painted shape
//    becomes a cast piece with rounded, bevelled edges (a pendant, a plate). Nothing is filled in: a ring drawn
//    as a circle stays a ring.
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
//    a flat table in the middle, facets round it, each catching the light differently, with sparkles. A stone
//    that's already a picture of one (a ruby or emerald image placed on the sketch: its shading and highlights
//    in it) is kept exactly as it is: no metal over it, nothing repainted.
// 5. A soft shadow beneath. Everything else comes out see-through.

import { boxBlur, dilate, distanceInside, erode, fillHoles, keepLargeParts } from "./sketchRender";

type RGBA = { data: Uint8ClampedArray; width: number; height: number };

// Paper: white (the sketch is drawn out on white; a light grey drawn on it, like platinum, is ink)
const PAPER_MIN = 248;
const PAPER_SPREAD = 8;
// Grey this light (0-255) or lighter is platinum; darker, silver
const PLATINUM_LIGHTNESS = 210;
// A pixel is the metal itself where its colour is at least this strong, as a fraction of the strongest nearby
// (the line's core); weaker, it's the line's soft edge
const METAL_COVERAGE = 0.5;
// A stone whose brightness varies more than this (0-255) is a picture of a stone, kept as it is
const PICTURED_STONE = 18;
// A wire narrower than this many pixels each side shows less of its curve (its face more)
const FINE_WIRE = 2.5;
// ... and shines brighter by up to this much (the finest the most)
const FINE_WIRE_SHINE = 0.35;
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
const SHADOW_DROP = 0.003;
const SHADOW_SOFTNESS = 0.004;
const SHADOW_OPACITY = 0.15;

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
// Gold's look, from a photo of polished 22 carat gold: the colour at each share of it, darkest to lightest (2%
// deep amber shadow, its middle a saturated buttery yellow, creamy highlights). A piece's gold is coloured so
// it has the same share of each: its pixels ranked by how much light they catch, each given the photo's colour
// at its rank (the shading keeps its shape; the gold takes the photo's colour and lightness).
const GOLD_LOOK: Array<[number, [number, number, number]]> = [
  [0, [110, 45, 0]],
  [0.02, [131, 56, 1]],
  [0.1, [192, 134, 44]],
  [0.25, [215, 176, 90]],
  [0.4, [233, 194, 100]],
  [0.5, [243, 202, 104]],
  [0.6, [252, 210, 105]],
  [0.75, [250, 222, 150]],
  [0.9, [245, 230, 185]],
  [0.98, [254, 242, 200]],
  [1, [255, 252, 215]],
];
// Platinum and silver the same way, with the same spread of light as the gold photo: platinum a bright, faintly
// cool white with soft grey shadows; silver a neutral, slightly greyer white with deeper shadows
const PLATINUM_LOOK: Array<[number, [number, number, number]]> = [
  [0, [70, 72, 78]],
  [0.02, [96, 99, 106]],
  [0.1, [150, 153, 160]],
  [0.25, [190, 193, 199]],
  [0.4, [210, 213, 218]],
  [0.5, [220, 222, 227]],
  [0.6, [228, 230, 234]],
  [0.75, [236, 238, 241]],
  [0.9, [244, 245, 247]],
  [0.98, [251, 252, 253]],
  [1, [255, 255, 255]],
];
const SILVER_LOOK: Array<[number, [number, number, number]]> = [
  [0, [45, 46, 48]],
  [0.02, [70, 71, 74]],
  [0.1, [125, 127, 130]],
  [0.25, [170, 172, 175]],
  [0.4, [195, 196, 199]],
  [0.5, [207, 208, 211]],
  [0.6, [217, 218, 220]],
  [0.75, [228, 229, 231]],
  [0.9, [240, 240, 242]],
  [0.98, [250, 250, 251]],
  [1, [255, 255, 255]],
];
// The metals coloured by a look (the others by their ramp)
const LOOKS: Record<number, Array<[number, [number, number, number]]>> = {
  [METAL_GOLD]: GOLD_LOOK,
  [METAL_PLATINUM]: PLATINUM_LOOK,
  [METAL_SILVER]: SILVER_LOOK,
};
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
  // Each stone whole: where gem colours are, closed over and filled in, so its dark shading and white highlights
  // (not gem-coloured themselves) are the stone too, not taken for pen or silver. Gold drawn round it stays gold.
  const stoneArea = new Uint8Array(n);
  {
    const seeds = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) if (family[p] === GEM) seeds[p] = 1;
    const closed = fillHoles(erode(dilate(seeds, w, h, 2), w, h, 2), w, h);
    const reach = dilate(closed, w, h, 1);
    for (let p = 0; p < n; p += 1) {
      if (!reach[p] || !ink[p]) continue;
      const f = family[p];
      if (f === METAL_GOLD || f === METAL_COPPER || f === METAL_ROSE_GOLD) continue;
      stoneArea[p] = 1;
      family[p] = GEM;
    }
  }

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
  // How much of each pixel the pen covers: its colour's strength (how far from the paper's white) against the
  // strongest nearby, the line's core. The metal is where it's at least METAL_COVERAGE: a line's faded edge
  // isn't, so the metal is as fine as the line is drawn.
  const strength = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    if (!ink[p]) continue;
    const a = data[p * 4 + 3] / 255;
    strength[p] = (a * (255 - Math.min(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]))) / 255;
  }
  const strongest = localMax(strength, w, h, 2);
  const coverage = new Float32Array(n);
  let piece: Uint8Array = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) {
    if (!ink[p] || strongest[p] <= 0) continue;
    coverage[p] = Math.min(1, strength[p] / strongest[p]);
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (coverage[p] >= METAL_COVERAGE) {
        piece[p] = 1;
        continue;
      }
      // (A fine line running between pixels splits its colour over two: the stronger of them across the line
      // is still the metal, so it doesn't break up)
      if (coverage[p] < METAL_COVERAGE * 0.4) continue;
      const across = (a: number, b: number) => strength[p] >= a && strength[p] >= b;
      const left = x > 0 ? strength[p - 1] : 0;
      const right = x < w - 1 ? strength[p + 1] : 0;
      const up = y > 0 ? strength[p - w] : 0;
      const down = y < h - 1 ? strength[p + w] : 0;
      if (across(left, right) || across(up, down)) piece[p] = 1;
    }
  }
  // (Only specks dropped: a short fine stroke is still part of the piece)
  piece = keepLargeParts(piece, w, h, 0.002);
  // (A stone is all there, its pale highlights included)
  for (let p = 0; p < n; p += 1) if (stoneArea[p]) piece[p] = 1;
  // Which stones are pictures of stones (shading in them: kept as they are) and which are painted flat (cut and
  // set, below): how much their brightness varies
  const pictured = new Uint8Array(n);
  for (const part of components(stoneArea, w, h)) {
    let sum = 0;
    let sumSq = 0;
    for (const q of part) {
      const l = 0.2126 * data[q * 4] + 0.7152 * data[q * 4 + 1] + 0.0722 * data[q * 4 + 2];
      sum += l;
      sumSq += l * l;
    }
    const mean = sum / part.length;
    if (Math.sqrt(Math.max(0, sumSq / part.length - mean * mean)) > PICTURED_STONE) for (const q of part) pictured[q] = 1;
  }
  // Every pixel of the piece takes the material of the nearest ink (thickened wire, smoothed edges)
  spreadNearest(material, ink, w, h);
  // Each gem's setting: its outer band becomes the metal it's set in (the nearest metal, else gold)
  {
    const gemMask = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) if (piece[p] && material[p] === GEM && !pictured[p]) gemMask[p] = 1;
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
  // The light each pixel catches (from the studio it reflects)
  const caught = new Float32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!piece[p]) continue;
      // Which way the surface faces (from its slope)
      const sx = (x < w - 1 ? surface[p + 1] : surface[p]) - (x > 0 ? surface[p - 1] : surface[p]);
      const sy = (y < h - 1 ? surface[p + w] : surface[p]) - (y > 0 ? surface[p - w] : surface[p]);
      // (A wire only a pixel or two across is too narrow for its curve to show as a slope: mostly its face, so it
      // reads as bright metal, not its dark edges)
      const fine = Math.min(1, reachOf[p] / FINE_WIRE);
      let nx = (-sx / 2) * fine;
      let ny = (-sy / 2) * fine;
      if (material[p] === GEM && stone[p] >= 0 && !pictured[p]) {
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
      // (A fine wire catches the light along its whole face: brighter)
      caught[p] = studio(rx, ry, rz) + (1 - fine) * FINE_WIRE_SHINE;
    }
  }
  // Each looked metal's pixels ranked by the light they catch (for its look)
  const caughtBy = new Map<number, number[]>();
  for (let p = 0; p < n; p += 1) {
    if (!piece[p] || pictured[p] || !LOOKS[material[p]]) continue;
    if (!caughtBy.has(material[p])) caughtBy.set(material[p], []);
    caughtBy.get(material[p])!.push(caught[p]);
  }
  for (const list of caughtBy.values()) list.sort((a, b) => a - b);
  const rankIn = (metal: number, v: number) => {
    const list = caughtBy.get(metal) ?? [];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return list.length > 1 ? lo / (list.length - 1) : 0.5;
  };
  // ... and each pixel's colour
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!piece[p]) continue;
      const seen = caught[p];
      let colour: [number, number, number];
      if (pictured[p]) {
        colour = [data[p * 4] / 255, data[p * 4 + 1] / 255, data[p * 4 + 2] / 255];
      } else if (material[p] === GEM) {
        const base: [number, number, number] = [gemColour[p * 3], gemColour[p * 3 + 1], gemColour[p * 3 + 2]];
        // Deeper toward the rim, lit through its facets, sparkling where a facet catches a light
        const depth = Math.min(1, dist[p] / bevel);
        const body = 0.25 + 0.75 * Math.min(1, seen * 0.8) * (0.55 + 0.45 * depth);
        const sparkle = Math.max(0, seen - 1.05) * 2.5;
        colour = [0, 1, 2].map((c) => Math.min(1, base[c] * body * 1.25 + sparkle)) as [number, number, number];
      } else if (LOOKS[material[p]]) {
        colour = lookAt(LOOKS[material[p]], rankIn(material[p], seen));
        // (A faint polish texture)
        const polish = 1 + 0.01 * noise(x, y);
        colour = colour.map((v) => Math.min(1, v * polish)) as [number, number, number];
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
  // The line's soft edge: just outside the metal, the colour of the metal beside it, as see-through as the pen
  // faded there (so edges are smooth without the line getting any wider)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (piece[p] || coverage[p] <= 0.05) continue;
      let from = -1;
      for (let dy = -1; dy <= 1 && from < 0; dy += 1) {
        for (let dx = -1; dx <= 1 && from < 0; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && piece[ny * w + nx]) from = ny * w + nx;
        }
      }
      if (from < 0) continue;
      for (let c = 0; c < 3; c += 1) out[p * 4 + c] = out[from * 4 + c];
      out[p * 4 + 3] = Math.round(Math.min(1, coverage[p] / METAL_COVERAGE) * 255);
    }
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

// A colour from a look (colours at shares, 0-255) at a share t (0 to 1)
function lookAt(look: Array<[number, [number, number, number]]>, t: number): [number, number, number] {
  const share = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < look.length - 2 && look[i + 1][0] < share) i += 1;
  const [a, from] = look[i];
  const [b, to] = look[i + 1];
  const f = b > a ? (share - a) / (b - a) : 0;
  return [0, 1, 2].map((c) => (from[c] * (1 - f) + to[c] * f) / 255) as [number, number, number];
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

// The largest value within r pixels each way (a square), in two passes
function localMax(values: Float32Array, w: number, h: number, r: number): Float32Array {
  const across = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let most = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) most = Math.max(most, values[y * w + k]);
      across[y * w + x] = most;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let most = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) most = Math.max(most, across[k * w + x]);
      out[y * w + x] = most;
    }
  }
  return out;
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
