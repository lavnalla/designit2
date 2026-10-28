// The separate objects in a Source picture, each cut out on its own (see-through round it), to be put on the
// workspace one at a time. Runs in the browser.
//
// - A picture of things on a plain background (a template, a product photo: a T-shirt, a necklace, a pair of
//   earrings): each separate thing on the background is an object (each earring of a pair its own). The
//   background is the colour round the picture's edges, and what's like it reaching in from there.
// - A photo of things on a surface that isn't plain (jewelry on a display bust): what stands out from the
//   surface by its texture (sparkling stones, metalwork, patterns against smooth suede or a wall).
// - A photo of a person (a face or skin found by the body parser the photo try-on uses): the clothing model
//   (garmentSegmenter) finds each garment and accessory (a dress, a top, pants, shoes, a bag ...), its parts
//   (sleeves, collar, pockets ...) kept with it.
//
// Clothing a person wears is named by the clothing model (Dress, Shoe, Bag ...); anything else is Item 1, 2 ...
// Things on a plain background are found at once, with no model; in a photo the texture's answer comes at once
// too, while the models (loaded the first time they're needed) check for a person and their clothing.

import { parseFashionClasses, preloadFashionModel } from "./garmentSegmenter";
import { skinSharesOf } from "./photoTryOnParsing";

export type SourceObject = {
  id: string;
  label: string;
  // The clothing model's class for it (0 when it couldn't tell)
  classId: number;
  // The object cut out, a PNG data URL
  imageDataUrl: string;
  // Where it is in the picture (its own pixels)
  bounds: { x: number; y: number; width: number; height: number };
  pixelCount: number;
};

// The picture is looked at no bigger than this (px, its longer side); cut-outs are taken from it full size
const WORK_SIDE = 768;
// ... and a cut-out is no bigger than this (px, its longer side)
const CUTOUT_SIDE = 1200;
// A pixel is the background if its colour is within this (0-255, each channel's difference added) of the
// background's colour
const BACKGROUND_TOLERANCE = 60;
// A picture is of things on a plain background if this much of its edge is close to one colour (within
// EDGE_TOLERANCE: the edge of a white backdrop, not a photo's wall and table; a garment reaching the edge is
// fine) and at least PLAIN_SHARE of the picture is that background
const PLAIN_EDGE = 0.6;
const EDGE_TOLERANCE = 36;
const PLAIN_SHARE = 0.15;
// Background enclosed by an object (the space inside a ring or a hoop) is background too if it's this big
// (fraction of the picture)
const ENCLOSED_BACKGROUND = 0.0008;
// Parts of one thing this close (fraction of the picture's longer side) are one object (a chain and its
// pendant, beads on a string)
const JOIN_GAP = 0.012;
// Found by texture in this many pieces or more, it's more likely a patterned garment broken up than that
// many things
const TEXTURE_PIECES = 3;
// A photo has a person in it if at least this much of it is face, or this much other skin (hands, arms, a neck:
// a photo of a top cropped below the face; a display bust's suede is taken for a little skin, about 2%) (looked
// for in a copy this big, px on its longer side)
const PERSON_FACE = 0.002;
const PERSON_SKIN = 0.04;
const PERSON_SIDE = 384;
// A garment less than this fraction of the size of a garment it touches is part of that one (the model unsure
// what it was)
const GARMENT_MERGE = 0.4;
// The smallest object kept (fraction of the picture)
const MIN_OBJECT = 0.002;
// With no plain background and no clothing: how busy the picture is, measured over this far (fraction of the
// picture's longer side); the busy parts filled in and rounded off over this far
const TEXTURE_WINDOW = 0.006;
const TEXTURE_CLOSE = 0.01;
// ... an object there is at least this much of the picture, and runs along no more than this much of its edge
const TEXTURE_MIN_OBJECT = 0.02;
const TEXTURE_EDGE_TOUCH = 0.05;
// ... and fills at least this much of the box round it
const TEXTURE_SOLID = 0.08;
// ... the surface it's on is this many colours, and a pixel inside it is the surface showing through if it's
// within this distance (0-255 RGB) of one of them and smooth (its brightness varying less than this)
const SURFACE_COLOURS = 6;
const SURFACE_COLOUR_DISTANCE = 24;
const SURFACE_SMOOTH = 10;
// ... and what's left of it smaller than this (fraction of the picture) is dropped
const TEXTURE_SPECK = 0.0005;

// The clothing model's classes (sayeed99/segformer-b3-fashion)
const CLASS_NAMES = [
  "",
  "Shirt",
  "Top",
  "Sweater",
  "Cardigan",
  "Jacket",
  "Vest",
  "Pants",
  "Shorts",
  "Skirt",
  "Coat",
  "Dress",
  "Jumpsuit",
  "Cape",
  "Glasses",
  "Hat",
  "Headband",
  "Tie",
  "Glove",
  "Watch",
  "Belt",
  "Leg warmer",
  "Tights",
  "Sock",
  "Shoe",
  "Bag",
  "Scarf",
  "Umbrella",
  "Hood",
  "Collar",
  "Lapel",
  "Epaulette",
  "Sleeve",
  "Pocket",
  "Neckline",
  "Buckle",
  "Zipper",
  "Applique",
  "Bead",
  "Bow",
  "Flower",
  "Fringe",
  "Ribbon",
  "Rivet",
  "Ruffle",
  "Sequin",
  "Tassel",
];
// Whole things (1-27); the rest (28-46) are parts of a garment, kept with the garment they're on
const LAST_WHOLE_CLASS = 27;
// Garments (1-13): all of one in a photo is one object, even where an arm or a bag splits it
const LAST_GARMENT_CLASS = 13;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the picture"));
    img.src = src;
  });
}

// The connected parts of a mask (touching across corners too): a label for each pixel (0 none, 1, 2 ...) and
// how many there are
function labelParts(mask: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let count = 0;
  for (let start = 0; start < w * h; start += 1) {
    if (!mask[start] || labels[start]) continue;
    count += 1;
    labels[start] = count;
    let end = 0;
    queue[end++] = start;
    for (let at = 0; at < end; at += 1) {
      const p = queue[at];
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = count;
            queue[end++] = q;
          }
        }
      }
    }
  }
  return { labels, count };
}

// The mask grown by r pixels each way (a square)
function grow(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const across = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    let last = -Infinity;
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x]) last = x;
      if (x - last <= r) across[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x -= 1) {
      if (mask[y * w + x]) last = x;
      if (last - x <= r) across[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x += 1) {
    let last = -Infinity;
    for (let y = 0; y < h; y += 1) {
      if (across[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y -= 1) {
      if (across[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

// Where the background is, if the picture is of things on a plain background (null if it isn't)
function plainBackground(data: Uint8ClampedArray, w: number, h: number): Uint8Array | null {
  const n = w * h;
  const edge: number[] = [];
  for (let x = 0; x < w; x += 1) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y += 1) edge.push(y * w, y * w + w - 1);
  // The background's colour: the middle of the edge's (see-through edge pixels count as background anyway)
  const opaque = edge.filter((p) => data[p * 4 + 3] >= 16);
  const middle = (c: number) => {
    const values = opaque.map((p) => data[p * 4 + c]).sort((a, b) => a - b);
    return values.length ? values[values.length >> 1] : 255;
  };
  const bg = [middle(0), middle(1), middle(2)];
  const like = (p: number) =>
    data[p * 4 + 3] < 16 ||
    Math.abs(data[p * 4] - bg[0]) + Math.abs(data[p * 4 + 1] - bg[1]) + Math.abs(data[p * 4 + 2] - bg[2]) <=
      BACKGROUND_TOLERANCE;
  let edgeLike = 0;
  for (const p of edge) {
    const near =
      data[p * 4 + 3] < 16 ||
      Math.abs(data[p * 4] - bg[0]) + Math.abs(data[p * 4 + 1] - bg[1]) + Math.abs(data[p * 4 + 2] - bg[2]) <=
        EDGE_TOLERANCE;
    if (near) edgeLike += 1;
  }
  if (edgeLike < edge.length * PLAIN_EDGE) return null;

  // What's like it, reaching in from the edge
  const background = new Uint8Array(n);
  const queue = new Int32Array(n);
  let end = 0;
  for (const p of edge) {
    if (!background[p] && like(p)) {
      background[p] = 1;
      queue[end++] = p;
    }
  }
  for (let at = 0; at < end; at += 1) {
    const p = queue[at];
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1]) {
      if (q >= 0 && !background[q] && like(q)) {
        background[q] = 1;
        queue[end++] = q;
      }
    }
  }
  // ... and big enough patches of it inside things (the space inside a hoop)
  const inside = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (!background[p] && like(p)) inside[p] = 1;
  const { labels, count } = labelParts(inside, w, h);
  const sizes = new Int32Array(count + 1);
  for (let p = 0; p < n; p += 1) sizes[labels[p]] += 1;
  for (let p = 0; p < n; p += 1) if (labels[p] && sizes[labels[p]] >= n * ENCLOSED_BACKGROUND) background[p] = 1;

  let share = 0;
  for (let p = 0; p < n; p += 1) share += background[p];
  return share >= n * PLAIN_SHARE ? background : null;
}

// The objects on a plain background: each separate thing, its parts that nearly touch joined
function objectsOnPlainBackground(background: Uint8Array, w: number, h: number): Uint8Array[] {
  const n = w * h;
  const thing = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) thing[p] = background[p] ? 0 : 1;
  const joined = grow(thing, w, h, Math.max(1, Math.round(Math.max(w, h) * JOIN_GAP)));
  const { labels, count } = labelParts(joined, w, h);
  const masks: Uint8Array[] = [];
  for (let k = 1; k <= count; k += 1) masks.push(new Uint8Array(n));
  for (let p = 0; p < n; p += 1) if (thing[p] && labels[p]) masks[labels[p] - 1][p] = 1;
  return masks;
}

// The mask shrunk by r pixels each way (a square)
function shrink(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inverse = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) inverse[p] = mask[p] ? 0 : 1;
  const grown = grow(inverse, w, h, r);
  for (let p = 0; p < w * h; p += 1) inverse[p] = grown[p] ? 0 : 1;
  return inverse;
}

// How much the brightness varies within r pixels each way (its standard deviation), for every pixel
function localSpread(lum: Float32Array, w: number, h: number, r: number): Float32Array {
  const sum = new Float64Array((w + 1) * (h + 1));
  const sumSq = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x += 1) {
      const v = lum[y * w + x];
      row += v;
      rowSq += v * v;
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
      sumSq[(y + 1) * (w + 1) + x + 1] = sumSq[y * (w + 1) + x + 1] + rowSq;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const count = (y1 - y0) * (x1 - x0);
      const at = (yy: number, xx: number) => yy * (w + 1) + xx;
      const s = sum[at(y1, x1)] - sum[at(y0, x1)] - sum[at(y1, x0)] + sum[at(y0, x0)];
      const sq = sumSq[at(y1, x1)] - sumSq[at(y0, x1)] - sumSq[at(y1, x0)] + sumSq[at(y0, x0)];
      const mean = s / count;
      out[y * w + x] = Math.sqrt(Math.max(0, sq / count - mean * mean));
    }
  }
  return out;
}

// The value splitting a set of values best into a low and a high group (Otsu's method)
function splitPoint(values: Float32Array): number {
  let top = 0;
  for (const v of values) if (v > top) top = v;
  const bins = 128;
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v / (top || 1)) * bins))] += 1;
  let total = 0;
  let totalSum = 0;
  for (let i = 0; i < bins; i += 1) {
    total += hist[i];
    totalSum += i * hist[i];
  }
  let below = 0;
  let belowSum = 0;
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < bins; i += 1) {
    below += hist[i];
    belowSum += i * hist[i];
    const above = total - below;
    if (!below || !above) continue;
    const diff = belowSum / below - (totalSum - belowSum) / above;
    const score = below * above * diff * diff;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return ((best + 1) / bins) * (top || 1);
}

// The objects in a photo with no plain background and no clothing (jewelry on a display bust, things on a
// textured surface): where the picture is busy (sparkling stones, metalwork, patterns) against the smooth
// surface round it, filled in and rounded off; then, inside that, what's the colour of the surface and smooth
// taken out again (the suede showing between a necklace's drops). What runs along the picture's edges (hair, a
// wall, the display itself) isn't an object.
function objectsByTexture(data: Uint8ClampedArray, w: number, h: number): Uint8Array[] {
  const n = w * h;
  const lum = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    lum[p] = 0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];
  }
  const side = Math.max(w, h);
  const spread = localSpread(lum, w, h, Math.max(1, Math.round(side * TEXTURE_WINDOW)));
  const cut = splitPoint(spread);
  let busy: Uint8Array = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (spread[p] > cut) busy[p] = 1;
  // Filled in and rounded off
  const r = Math.max(2, Math.round(side * TEXTURE_CLOSE));
  busy = shrink(grow(busy, w, h, r), w, h, r);
  const outside = new Uint8Array(n);
  {
    const queue = new Int32Array(n);
    let end = 0;
    const visit = (p: number) => {
      if (!busy[p] && !outside[p]) {
        outside[p] = 1;
        queue[end++] = p;
      }
    };
    for (let x = 0; x < w; x += 1) {
      visit(x);
      visit((h - 1) * w + x);
    }
    for (let y = 0; y < h; y += 1) {
      visit(y * w);
      visit(y * w + w - 1);
    }
    for (let at = 0; at < end; at += 1) {
      const p = queue[at];
      const x = p % w;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < n - w) visit(p + w);
    }
  }
  let region: Uint8Array = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) region[p] = outside[p] ? 0 : 1;
  const half = Math.max(1, r >> 1);
  region = grow(shrink(region, w, h, half), w, h, half);

  // Big enough parts, not running along the picture's edges, and solid (not just the outline of something
  // smooth)
  const { labels, count } = labelParts(region, w, h);
  const size = new Int32Array(count + 1);
  const onEdge = new Int32Array(count + 1);
  const left = new Int32Array(count + 1).fill(w);
  const right = new Int32Array(count + 1).fill(-1);
  const top = new Int32Array(count + 1).fill(h);
  const bottom = new Int32Array(count + 1).fill(-1);
  for (let p = 0; p < n; p += 1) {
    const k = labels[p];
    if (!k) continue;
    size[k] += 1;
    const x = p % w;
    const y = (p - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) onEdge[k] += 1;
    if (x < left[k]) left[k] = x;
    if (x > right[k]) right[k] = x;
    if (y < top[k]) top[k] = y;
    if (y > bottom[k]) bottom[k] = y;
  }
  const perimeter = 2 * (w + h);
  const kept = new Uint8Array(count + 1);
  for (let k = 1; k <= count; k += 1) {
    const boxArea = (right[k] - left[k] + 1) * (bottom[k] - top[k] + 1);
    kept[k] =
      size[k] >= n * TEXTURE_MIN_OBJECT &&
      onEdge[k] <= perimeter * TEXTURE_EDGE_TOUCH &&
      size[k] >= boxArea * TEXTURE_SOLID
        ? 1
        : 0;
  }
  const keep = new Uint8Array(n);
  let any = false;
  for (let p = 0; p < n; p += 1) {
    if (kept[labels[p]]) {
      keep[p] = 1;
      any = true;
    }
  }
  if (!any) return [];

  // The surface's colours (a few, from what's outside the objects), and inside them, what's those colours and
  // smooth is the surface showing through
  const samples: number[] = [];
  const step = Math.max(1, Math.floor((n - 1) / 20000));
  for (let p = 0; p < n; p += step) if (!keep[p]) samples.push(p);
  const centres: number[][] = [];
  for (let k = 0; k < SURFACE_COLOURS && samples.length; k += 1) {
    const p = samples[Math.floor(((k + 0.5) * samples.length) / SURFACE_COLOURS)];
    centres.push([data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]);
  }
  for (let round = 0; round < 12; round += 1) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of samples) {
      let best = 0;
      let bestDist = Infinity;
      centres.forEach((c, k) => {
        const d = (data[p * 4] - c[0]) ** 2 + (data[p * 4 + 1] - c[1]) ** 2 + (data[p * 4 + 2] - c[2]) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = k;
        }
      });
      sums[best][0] += data[p * 4];
      sums[best][1] += data[p * 4 + 1];
      sums[best][2] += data[p * 4 + 2];
      sums[best][3] += 1;
    }
    sums.forEach((s, k) => {
      if (s[3]) centres[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  const fine = localSpread(lum, w, h, 1);
  const limit = SURFACE_COLOUR_DISTANCE * SURFACE_COLOUR_DISTANCE;
  for (let p = 0; p < n; p += 1) {
    if (!keep[p] || fine[p] >= SURFACE_SMOOTH) continue;
    for (const c of centres) {
      const d = (data[p * 4] - c[0]) ** 2 + (data[p * 4 + 1] - c[1]) ** 2 + (data[p * 4 + 2] - c[2]) ** 2;
      if (d < limit) {
        keep[p] = 0;
        break;
      }
    }
  }
  // Specks left over dropped; parts that nearly touch are one object
  const pieces = labelParts(keep, w, h);
  const pieceSize = new Int32Array(pieces.count + 1);
  for (let p = 0; p < n; p += 1) pieceSize[pieces.labels[p]] += 1;
  for (let p = 0; p < n; p += 1) {
    if (keep[p] && pieceSize[pieces.labels[p]] < n * TEXTURE_SPECK) keep[p] = 0;
  }
  const surface = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) surface[p] = keep[p] ? 0 : 1;
  return objectsOnPlainBackground(surface, w, h);
}

// The objects in a photo, from the clothing model: each garment whole, each accessory (a shoe, a bag) on its
// own, a garment's parts (sleeves, collar ...) with the garment they're on
function objectsFromClothing(classes: Uint8Array, w: number, h: number): Array<{ mask: Uint8Array; classId: number }> {
  const n = w * h;
  const owner = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (classes[p] >= 1 && classes[p] <= LAST_WHOLE_CLASS) owner[p] = classes[p];
  // Each patch of parts goes with the whole thing most round it (dropped if it's on nothing)
  const parts = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (classes[p] > LAST_WHOLE_CLASS) parts[p] = 1;
  const { labels, count } = labelParts(parts, w, h);
  const ring = grow(parts, w, h, 2);
  const votes = new Map<number, Map<number, number>>();
  for (let p = 0; p < n; p += 1) {
    if (!ring[p] || !owner[p]) continue;
    // (Whose patch this ring pixel is round: a part pixel within 2 px)
    const x = p % w;
    const y = (p - x) / w;
    let patch = 0;
    for (let dy = -2; dy <= 2 && !patch; dy += 1) {
      for (let dx = -2; dx <= 2 && !patch; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) patch = labels[ny * w + nx];
      }
    }
    if (!patch) continue;
    const tally = votes.get(patch) ?? new Map<number, number>();
    tally.set(owner[p], (tally.get(owner[p]) ?? 0) + 1);
    votes.set(patch, tally);
  }
  const patchOwner = new Uint8Array(count + 1);
  for (const [patch, tally] of votes) {
    let best = 0;
    let most = 0;
    for (const [cls, v] of tally) {
      if (v > most) {
        most = v;
        best = cls;
      }
    }
    patchOwner[patch] = best;
  }
  for (let p = 0; p < n; p += 1) if (labels[p] && patchOwner[labels[p]]) owner[p] = patchOwner[labels[p]];

  // The garments; one the model wasn't sure of (patches of a long top called Top among the Dress) merged into
  // the bigger garment it touches most, if it's much smaller than it and worn on the same part of the body
  // (pants never into a dress)
  const isLegGarment = (cls: number) => cls >= 7 && cls <= 9;
  const garments: Array<{ mask: Uint8Array; classId: number; size: number }> = [];
  for (let cls = 1; cls <= LAST_GARMENT_CLASS; cls += 1) {
    const mask = new Uint8Array(n);
    let size = 0;
    for (let p = 0; p < n; p += 1) {
      if (owner[p] === cls) {
        mask[p] = 1;
        size += 1;
      }
    }
    if (size) garments.push({ mask, classId: cls, size });
  }
  garments.sort((a, b) => a.size - b.size);
  for (let i = 0; i < garments.length; i += 1) {
    const small = garments[i];
    const reach = grow(small.mask, w, h, 2);
    let into = -1;
    let mostContact = 0;
    for (let j = i + 1; j < garments.length; j += 1) {
      const big = garments[j];
      if (small.size >= big.size * GARMENT_MERGE || isLegGarment(small.classId) !== isLegGarment(big.classId)) continue;
      let contact = 0;
      for (let p = 0; p < n; p += 1) if (reach[p] && big.mask[p]) contact += 1;
      if (contact > mostContact) {
        mostContact = contact;
        into = j;
      }
    }
    if (into < 0) continue;
    const big = garments[into];
    for (let p = 0; p < n; p += 1) if (small.mask[p]) big.mask[p] = 1;
    big.size += small.size;
    small.size = 0;
  }
  const found: Array<{ mask: Uint8Array; classId: number }> = garments
    .filter((g) => g.size >= n * MIN_OBJECT)
    .map((g) => ({ mask: g.mask, classId: g.classId }));
  for (let cls = LAST_GARMENT_CLASS + 1; cls <= LAST_WHOLE_CLASS; cls += 1) {
    const mask = new Uint8Array(n);
    let any = 0;
    for (let p = 0; p < n; p += 1) {
      if (owner[p] === cls) {
        mask[p] = 1;
        any += 1;
      }
    }
    if (any < n * MIN_OBJECT) continue;
    // (An accessory: each one on its own, a pair of shoes as two)
    const pieces = labelParts(mask, w, h);
    for (let k = 1; k <= pieces.count; k += 1) {
      const piece = new Uint8Array(n);
      for (let p = 0; p < n; p += 1) if (pieces.labels[p] === k) piece[p] = 1;
      found.push({ mask: piece, classId: cls });
    }
  }
  return found;
}

// The object cut out of the full-size picture: its pixels where the mask is (the mask's edge softened by
// being scaled up), cropped to it
function cutOut(
  img: HTMLImageElement,
  mask: Uint8Array,
  w: number,
  h: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
): { dataUrl: string; bounds: SourceObject["bounds"] } {
  const scale = img.naturalWidth / w;
  const pad = 1;
  const bx = Math.max(0, box.minX - pad);
  const by = Math.max(0, box.minY - pad);
  const bw = Math.min(w, box.maxX + pad + 1) - bx;
  const bh = Math.min(h, box.maxY + pad + 1) - by;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = bw;
  maskCanvas.height = bh;
  const maskCtx = maskCanvas.getContext("2d");
  const maskImage = maskCtx?.createImageData(bw, bh);
  if (maskImage) {
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        if (mask[(by + y) * w + bx + x]) maskImage.data[(y * bw + x) * 4 + 3] = 255;
      }
    }
    maskCtx?.putImageData(maskImage, 0, 0);
  }
  // In the full-size picture
  const sx = bx * scale;
  const sy = by * scale;
  const sw = bw * scale;
  const sh = bh * scale;
  const fit = Math.min(1, CUTOUT_SIDE / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * fit));
  out.height = Math.max(1, Math.round(sh * fit));
  const ctx = out.getContext("2d");
  if (ctx) {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(maskCanvas, 0, 0, out.width, out.height);
  }
  return {
    dataUrl: out.toDataURL("image/png"),
    bounds: { x: Math.round(sx), y: Math.round(sy), width: Math.round(sw), height: Math.round(sh) },
  };
}

/** The separate objects in a picture, largest first, each cut out on its own. */
// The objects found, cut out of the full-size picture, largest first; the unnamed ones numbered (Item 1,
// Item 2 ...), and repeated names too (Shoe 1, Shoe 2)
function toObjects(
  img: HTMLImageElement,
  found: Array<{ mask: Uint8Array; classId: number }>,
  w: number,
  h: number,
): SourceObject[] {
  const fit = w / img.naturalWidth;
  const objects: Array<SourceObject & { order: number }> = [];
  for (const { mask, classId } of found) {
    const box = { minX: w, minY: h, maxX: -1, maxY: -1 };
    let pixels = 0;
    for (let p = 0; p < w * h; p += 1) {
      if (!mask[p]) continue;
      pixels += 1;
      const x = p % w;
      const y = (p - x) / w;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
    if (pixels < w * h * MIN_OBJECT) continue;
    const { dataUrl, bounds } = cutOut(img, mask, w, h, box);
    objects.push({
      id: `object-${objects.length}-${Date.now()}`,
      label: CLASS_NAMES[classId] ?? "",
      classId,
      imageDataUrl: dataUrl,
      bounds,
      pixelCount: Math.round(pixels / (fit * fit)),
      order: pixels,
    });
  }
  objects.sort((a, b) => b.order - a.order);
  const counts = new Map<string, number>();
  for (const o of objects) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return objects.map((o) => {
    const base = o.label || "Item";
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    const label = !o.label || (counts.get(o.label) ?? 0) > 1 ? `${base} ${k}` : base;
    return {
      id: o.id,
      label,
      classId: o.classId,
      imageDataUrl: o.imageDataUrl,
      bounds: o.bounds,
      pixelCount: o.pixelCount,
    };
  });
}

// Whether there's a person in the picture: a face, or enough other skin (as the body parser sees them), looked
// for in a small copy of it
async function hasPerson(canvas: HTMLCanvasElement): Promise<boolean> {
  const fit = Math.min(1, PERSON_SIDE / Math.max(canvas.width, canvas.height));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(canvas.width * fit));
  small.height = Math.max(1, Math.round(canvas.height * fit));
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const { face, skin } = await skinSharesOf(ctx.getImageData(0, 0, small.width, small.height));
  return face >= PERSON_FACE || skin >= PERSON_SKIN;
}

/** The separate objects in a picture, largest first, each cut out on its own. A photo's quick first answer
 * (by texture) is passed to onEarly while the slower checks (is there a person? what are they wearing?) run;
 * the answer returned is the final one. */
export async function findSourceObjects(
  src: string,
  onEarly?: (objects: SourceObject[]) => void,
): Promise<SourceObject[]> {
  const img = await loadImage(src);
  const fit = Math.min(1, WORK_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * fit));
  const h = Math.max(1, Math.round(img.naturalHeight * fit));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  // The models see the picture on white (a see-through background as white, as they were trained on)
  const parseCanvas = document.createElement("canvas");
  parseCanvas.width = w;
  parseCanvas.height = h;
  const parseCtx = parseCanvas.getContext("2d");
  if (parseCtx) {
    parseCtx.fillStyle = "#fff";
    parseCtx.fillRect(0, 0, w, h);
    parseCtx.drawImage(canvas, 0, 0);
  }

  const started = performance.now();
  const report = (how: string, found: Array<{ classId: number }>) =>
    console.info(
      `[Source objects] ${how}, ${Math.round(performance.now() - started)} ms: ` +
        found.map((f) => CLASS_NAMES[f.classId] || "item").join(", "),
    );

  // Things on a plain background: found at once, no model
  const background = plainBackground(data, w, h);
  if (background) {
    const found = objectsOnPlainBackground(background, w, h).map((mask) => ({ mask, classId: 0 }));
    report("plain background", found);
    return toObjects(img, found, w, h);
  }

  // A photo. What stands out from the surface it's on, by its texture, is the quick answer (jewelry on a
  // display bust), shown while the slower checks run: whether there's a person, and what the clothing model
  // finds. A person's clothing is the answer when there's a person (the texture of hair and arms isn't
  // anything); with no person, the texture's answer stands (the clothing model takes a display bust for a top),
  // and only if it found nothing is the clothing model's (a garment on its own, too plain to stand out).
  const byTexture = objectsByTexture(data, w, h).map((mask) => ({ mask, classId: 0 }));
  const early = toObjects(img, byTexture, w, h);
  if (early.length) onEarly?.(early);
  // (The person check first: the clothing model can hold up the page while it runs, so it's only run when
  // it's needed)
  const person = await hasPerson(parseCanvas).catch(() => false);
  // (No person: the texture's answer stands, unless it's many pieces, which is a patterned garment broken up
  // (polka dots): then the clothing model has its say)
  if (!person && byTexture.length && byTexture.length < TEXTURE_PIECES) {
    report("texture", byTexture);
    return early;
  }
  const classes = await parseFashionClasses(parseCanvas).catch(() => null);
  const byClothing = classes ? objectsFromClothing(classes, w, h) : [];
  if (byClothing.length) {
    report(person ? "clothing (a person)" : "clothing (nothing clear by texture)", byClothing);
    return toObjects(img, byClothing, w, h);
  }
  report(person ? "texture (a person, no clothing)" : byTexture.length ? "texture (no clothing)" : "nothing", byTexture);
  return early;
}

/** Starts loading the models a photo needs (the body parser that looks for a person, and the clothing model)
 * in the background, so they're ready by the time a photo is picked. */
export function preloadSourceObjectModels() {
  preloadFashionModel();
  void skinSharesOf(new ImageData(8, 8)).catch(() => undefined);
}
