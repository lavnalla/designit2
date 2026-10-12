// Photo try-on without generative AI: puts the garment from one photo onto the person in another, using
// geometry and the person photo's own shading.
//
// Both photos arrive parsed (photoTryOnParsing.ts): fashion classes per pixel (shirt, pants, dress, sleeve,
// ...), human classes per pixel (skin, face, hair, clothes, background) and, for a person, pose landmarks.
//
// 1. Parts. Each photo's garments become parts by body zone: torso, image-left and image-right sleeve,
//    skirt-like (skirts, the lower half of a dress), leg-wear (pants, shorts, the lower half of a jumpsuit)
//    and drape (scarf, dupatta, cape).
// 2. Putting on. The garment is drawn over the photo in its own shape, placed by the pose: its shoulders
//    start where the person's do at the neck, a skirt or pants hang from the waist (their hem as far down
//    the legs as on whoever wears it in the garment photo), and each sleeve stays attached at its seam,
//    turned partway toward the arm. Nothing of the person's is erased: where the new garment covers less
//    than their own clothes, theirs show (except sleeves: a garment without them takes the person's off, and
//    their arms are painted in); their face, arms and hands go back on top.
// 3. Shading. The garment photo's own lighting is divided out, and the person photo's lighting multiplied in.

export type RGBAImage = { data: Uint8ClampedArray; width: number; height: number };
export type Landmark = { x: number; y: number; visibility?: number };

export type PhotoParse = {
  image: RGBAImage;
  // Fashion class per pixel (SegFormer Fashionpedia ids, 0 = none)
  fashion: Uint8Array;
  // Human class per pixel (HUMAN_*)
  human: Uint8Array;
  // Pose landmarks (MediaPipe's 33, normalized to the image), or null if no person
  pose: Landmark[] | null;
};

export type PartKind = "torso" | "sleeveLeft" | "sleeveRight" | "skirt" | "legs" | "drape";

export type TryOnReport = {
  // Garment parts drawn onto the person
  placed: PartKind[];
  // How each garment part was measured and placed, for debugging
  notes: string[];
};

export const HUMAN_BACKGROUND = 0;
export const HUMAN_HAIR = 1;
export const HUMAN_BODY_SKIN = 2;
export const HUMAN_FACE_SKIN = 3;
export const HUMAN_CLOTHES = 4;
export const HUMAN_OTHER = 5;

// --- fashion classes -> garment families ---

type Family = "upper" | "dress" | "jumpsuit" | "pants" | "shorts" | "skirt" | "drape" | "sleeve";

const FAMILY_OF_CLASS: Record<number, Family> = {
  1: "upper", // shirt, blouse
  2: "upper", // top, t-shirt, sweatshirt
  3: "upper", // sweater
  4: "upper", // cardigan
  5: "upper", // jacket
  6: "upper", // vest
  7: "pants",
  8: "shorts",
  9: "skirt",
  10: "upper", // coat
  11: "dress",
  12: "jumpsuit",
  13: "drape", // cape
  26: "drape", // scarf
  32: "sleeve",
};
// Garment details (hood, collar, lapel, epaulette, pocket, neckline, buckle, zipper, applique, bead, bow,
// flower, fringe, ribbon, rivet, ruffle, sequin, tassel): part of whichever garment they're on
const DETAIL_CLASSES = new Set([28, 29, 30, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]);
const FAMILIES: Family[] = ["upper", "dress", "jumpsuit", "pants", "shorts", "skirt", "drape", "sleeve"];

// --- tuning ---

// Fraction of the garment photo's border pixels that must share one colour for it to count as a plain
// backdrop, and how close (Lab) a garment-labelled pixel must be to it to be dropped as backdrop
const BACKDROP_UNIFORM = 0.7;
const BACKDROP_DISTANCE = 7;
// How strongly the creases and shadows of what the person wore carry into the new garment (1 = fully)
const FOLD_STRENGTH = 0.7;
// Roundness shading of the garment over the body: darkest at the body's sides, this much below the middle
const ROUNDNESS_DEPTH = 0.3;
// The soft shadow a garment casts just beyond its edges onto the person: how dark, and how far (fraction of
// the shoulder width)
const CONTACT_SHADOW = 0.35;
const CONTACT_SHADOW_REACH = 0.035;

// How far above where the neck meets the shoulders a garment's neck points go (fraction of shoulder width)
const NECK_LIFT = 0.04;
// The size from lining up the necks is kept within this range of the size from the shoulder tips (a neckline
// is rarely narrower than the neck: one that is, like a small collar, would otherwise blow the garment up)
const NECK_SCALE_RANGE = [0.6, 1.05];
// How far each sleeve is turned from its angle in the garment photo toward hanging along the arm: 0 keeps the
// garment photo's angle, 1 lines it up with the upper arm
const SLEEVE_TOWARD_ARM = 0.5;
// A body (or garment) tilted less than this (radians, about 8 degrees) is treated as upright
const UPRIGHT_TOLERANCE = 0.14;

// The waist's span (front view) per hip-joint distance
const WAIST_PER_HIP_JOINTS = 1.45;
// Shading multipliers are kept within this range
const SHADE_MIN = 0.3;
const SHADE_MAX = 1.6;
// A pixel this far (Lab, lightness counting half) from its part's local colour is print, not shading
const MOTIF_DISTANCE = 14;
// Pose landmarks below this visibility are treated as missing
const MIN_VISIBILITY = 0.3;
// Garment-side pose only counts when the garment photo shows this much skin and face (a flat-lay can fool
// the pose model)
const MIN_GARMENT_SKIN_FRACTION = 0.01;

// --- small maths ---

type Vec = { x: number; y: number };
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scaleVec = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const len = (a: Vec) => Math.hypot(a.x, a.y);
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const unit = (a: Vec): Vec => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 1 };
};

// --- colour ---

const LINEAR = new Float32Array(256).map((_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
});

function linearToByte(v: number) {
  const c = Math.min(1, Math.max(0, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}

function labF(t: number) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

// Linear RGB to CIE Lab (D65)
function linearToLab(r: number, g: number, b: number): [number, number, number] {
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIE lightness back to relative luminance
function luminanceOfL(L: number) {
  return L > 8 ? Math.pow((L + 16) / 116, 3) : L / 903.3;
}

// An image in linear RGB (3 floats per pixel), with its Lab
type LinearImage = { rgb: Float32Array; lab: Float32Array; width: number; height: number };

function toLinearImage(img: RGBAImage): LinearImage {
  const n = img.width * img.height;
  const rgb = new Float32Array(n * 3);
  const lab = new Float32Array(n * 3);
  for (let p = 0; p < n; p += 1) {
    const r = LINEAR[img.data[p * 4]];
    const g = LINEAR[img.data[p * 4 + 1]];
    const b = LINEAR[img.data[p * 4 + 2]];
    rgb[p * 3] = r;
    rgb[p * 3 + 1] = g;
    rgb[p * 3 + 2] = b;
    const [L, A, B] = linearToLab(r, g, b);
    lab[p * 3] = L;
    lab[p * 3 + 1] = A;
    lab[p * 3 + 2] = B;
  }
  return { rgb, lab, width: img.width, height: img.height };
}

// Bilinear sample of a 3-channel image at (x, y) into out
function sampleRGB(img: LinearImage, x: number, y: number, out: Float32Array) {
  const { width: w, height: h, rgb } = img;
  const fx = Math.min(w - 1, Math.max(0, x));
  const fy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 3; c += 1) {
    const top = rgb[(y0 * w + x0) * 3 + c] * (1 - tx) + rgb[(y0 * w + x1) * 3 + c] * tx;
    const bottom = rgb[(y1 * w + x0) * 3 + c] * (1 - tx) + rgb[(y1 * w + x1) * 3 + c] * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
}

// Bilinear sample of a 1-channel float map
function sample1(map: Float32Array, w: number, h: number, x: number, y: number) {
  if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return 0;
  const fx = Math.min(w - 1, Math.max(0, x));
  const fy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = map[y0 * w + x0] * (1 - tx) + map[y0 * w + x1] * tx;
  const bottom = map[y1 * w + x0] * (1 - tx) + map[y1 * w + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

// --- filters ---

// Sum over the (2r+1)^2 box around each pixel, clipped at the edges (running sums: O(n) for any r)
function boxSum(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let acc = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x += 1) acc += src[row + x];
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = acc;
      if (x + r + 1 < w) acc += src[row + x + r + 1];
      if (x - r >= 0) acc -= src[row + x - r];
    }
  }
  for (let x = 0; x < w; x += 1) {
    let acc = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y += 1) acc += tmp[y * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = acc;
      if (y + r + 1 < h) acc += tmp[(y + r + 1) * w + x];
      if (y - r >= 0) acc -= tmp[(y - r) * w + x];
    }
  }
  return out;
}

// Mean of values over the weighted pixels in the box (NaN where none), and how much of the box was weighted
function weightedBoxBlur(values: Float32Array, weights: Float32Array, w: number, h: number, r: number) {
  const vw = new Float32Array(w * h);
  for (let p = 0; p < vw.length; p += 1) vw[p] = values[p] * weights[p];
  const sumVW = boxSum(vw, w, h, r);
  const sumW = boxSum(weights, w, h, r);
  const mean = new Float32Array(w * h);
  const coverage = new Float32Array(w * h);
  const full = (2 * r + 1) * (2 * r + 1);
  for (let p = 0; p < mean.length; p += 1) {
    mean[p] = sumW[p] > 1e-6 ? sumVW[p] / sumW[p] : NaN;
    coverage[p] = sumW[p] / full;
  }
  return { mean, coverage };
}

// Normalized-convolution blur at several radii, narrowest first: each narrower pass takes over where its
// box is well covered, so detail is kept where there's data and wider boxes fill the gaps
function fillBlur(values: Float32Array, weights: Float32Array, w: number, h: number, radii: number[]) {
  const passes = radii.map((r) => weightedBoxBlur(values, weights, w, h, Math.max(1, Math.round(r))));
  const out = new Float32Array(w * h);
  for (let p = 0; p < out.length; p += 1) {
    let value = NaN;
    for (let i = passes.length - 1; i >= 0; i -= 1) {
      const m = passes[i].mean[p];
      if (Number.isNaN(m)) continue;
      const t = Number.isNaN(value) ? 1 : Math.min(1, passes[i].coverage[p] / 0.35);
      value = Number.isNaN(value) ? m : t * m + (1 - t) * value;
    }
    out[p] = value;
  }
  return out;
}

// Fills the unknown pixels of a 3-channel image from the known ones around them (push-pull: average down a
// pyramid of halvings, then fill each level's gaps from the coarser one)
function pushPullFill(values: Float32Array, known: Float32Array, w: number, h: number): Float32Array {
  if (w <= 1 && h <= 1) return values.slice();
  const w2 = Math.max(1, Math.ceil(w / 2));
  const h2 = Math.max(1, Math.ceil(h / 2));
  const small = new Float32Array(w2 * h2 * 3);
  const smallKnown = new Float32Array(w2 * h2);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const k = known[p];
      if (k <= 0) continue;
      const q = (y >> 1) * w2 + (x >> 1);
      smallKnown[q] += k;
      for (let c = 0; c < 3; c += 1) small[q * 3 + c] += values[p * 3 + c] * k;
    }
  }
  for (let q = 0; q < w2 * h2; q += 1) {
    if (smallKnown[q] <= 0) continue;
    for (let c = 0; c < 3; c += 1) small[q * 3 + c] /= smallKnown[q];
    smallKnown[q] = Math.min(1, smallKnown[q]);
  }
  const coarse = w2 === w && h2 === h ? small : pushPullFill(small, smallKnown, w2, h2);
  const out = values.slice();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const k = Math.min(1, known[p]);
      if (k >= 1) continue;
      // Bilinear from the coarser level
      const sx = Math.min(w2 - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
      const sy = Math.min(h2 - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(w2 - 1, x0 + 1);
      const y1 = Math.min(h2 - 1, y0 + 1);
      const tx = sx - x0;
      const ty = sy - y0;
      for (let c = 0; c < 3; c += 1) {
        const v =
          (coarse[(y0 * w2 + x0) * 3 + c] * (1 - tx) + coarse[(y0 * w2 + x1) * 3 + c] * tx) * (1 - ty) +
          (coarse[(y1 * w2 + x0) * 3 + c] * (1 - tx) + coarse[(y1 * w2 + x1) * 3 + c] * tx) * ty;
        out[p * 3 + c] = k * values[p * 3 + c] + (1 - k) * v;
      }
    }
  }
  return out;
}

// --- body frame from the pose ---

type Arm = { shoulder: Vec; elbow: Vec | null; wrist: Vec | null };
type Leg = { hip: Vec; knee: Vec | null; ankle: Vec | null };

// The pose in pixels, sides named by image position (both photos face the camera, so image-left matches
// image-left)
type Body = {
  shoulders: { left: Vec; right: Vec };
  hips: { left: Vec; right: Vec } | null;
  arms: { left: Arm; right: Arm };
  legs: { left: Leg; right: Leg } | null;
  hands: Vec[];
  // The middle of the mouth (else the nose), for finding the neck
  mouth: Vec | null;
  // Shoulder width at the outside of the shoulders, and the direction down the body
  shoulderWidth: number;
  down: Vec;
};

function bodyFromPose(pose: Landmark[] | null, w: number, h: number): Body | null {
  if (!pose || pose.length < 29) return null;
  const at = (i: number): Vec | null =>
    (pose[i].visibility ?? 1) >= MIN_VISIBILITY ? { x: pose[i].x * w, y: pose[i].y * h } : null;
  const s11 = at(11);
  const s12 = at(12);
  if (!s11 || !s12) return null;
  // Landmark 11 is the person's left shoulder; work out which is image-left
  const flip = s11.x > s12.x;
  const side = (personLeft: number, personRight: number) =>
    flip ? { left: at(personRight), right: at(personLeft) } : { left: at(personLeft), right: at(personRight) };
  const shoulders = flip ? { left: s12, right: s11 } : { left: s11, right: s12 };
  const elbows = side(13, 14);
  const wrists = side(15, 16);
  const hipPair = side(23, 24);
  const knees = side(25, 26);
  const ankles = side(27, 28);
  const hips = hipPair.left && hipPair.right ? { left: hipPair.left, right: hipPair.right } : null;
  const shoulderMid = mid(shoulders.left, shoulders.right);
  const down = hips ? unit(sub(mid(hips.left, hips.right), shoulderMid)) : { x: 0, y: 1 };
  const hands: Vec[] = [];
  for (const i of [15, 16, 17, 18, 19, 20, 21, 22]) {
    const v = at(i);
    if (v) hands.push(v);
  }
  return {
    shoulders,
    hips,
    arms: {
      left: { shoulder: shoulders.left, elbow: elbows.left, wrist: wrists.left },
      right: { shoulder: shoulders.right, elbow: elbows.right, wrist: wrists.right },
    },
    legs: hips
      ? {
          left: { hip: hips.left, knee: knees.left, ankle: ankles.left },
          right: { hip: hips.right, knee: knees.right, ankle: ankles.right },
        }
      : null,
    hands,
    mouth: (() => {
      const left = at(9);
      const right = at(10);
      return left && right ? mid(left, right) : at(0);
    })(),
    // The shoulder joints sit inside the shoulders
    shoulderWidth: len(sub(shoulders.right, shoulders.left)) * 1.2,
    down,
  };
}

// Where a garment's shoulders start on a body: the tops of the shoulders, out toward their tips (the joints
// sit inside the body, below the top of the shoulder)
function bodyShoulderPoints(body: Body): { left: Vec; right: Vec } {
  const joints = len(sub(body.shoulders.right, body.shoulders.left));
  const across = unit(sub(body.shoulders.right, body.shoulders.left));
  const up = scaleVec(body.down, -joints * 0.2);
  return {
    left: add(add(body.shoulders.left, scaleVec(across, -joints * 0.075)), up),
    right: add(add(body.shoulders.right, scaleVec(across, joints * 0.075)), up),
  };
}

// Where the neck meets the shoulders on the person, each side: the neck's edges (its skin, halfway between the
// mouth and the shoulders, either side of the body's centre line), followed down to where the shoulder starts
// (the first pixel of the person beside the neck)
function personNeckPoints(body: Body, human: Uint8Array, w: number, h: number): { left: Vec; right: Vec } | null {
  if (!body.mouth) return null;
  const sMid = mid(body.shoulders.left, body.shoulders.right);
  const midNeckY = Math.round((body.mouth.y + sMid.y) / 2);
  if (midNeckY < 0 || midNeckY >= h) return null;
  const cx = Math.round(sMid.x);
  const isSkin = (x: number, y: number) => {
    const c = human[y * w + x];
    return c === HUMAN_BODY_SKIN || c === HUMAN_FACE_SKIN;
  };
  // The run of skin across the neck through the centre line (searching a little either side for it)
  let start = -1;
  for (let dx = 0; dx < w * 0.05 && start < 0; dx += 1) {
    for (const x of [cx - dx, cx + dx]) if (x >= 0 && x < w && isSkin(x, midNeckY)) start = x;
  }
  if (start < 0) return null;
  let left = start;
  let right = start;
  while (left > 0 && isSkin(left - 1, midNeckY)) left -= 1;
  while (right < w - 1 && isSkin(right + 1, midNeckY)) right += 1;
  const joints = len(sub(body.shoulders.right, body.shoulders.left));
  if (right - left < joints * 0.15 || right - left > joints * 0.8) return null;
  // Down from the neck's edge, a couple of pixels outside it, to the top of the shoulder
  const shoulderTop = (x: number) => {
    const xc = Math.min(w - 1, Math.max(0, x));
    for (let y = midNeckY; y < Math.min(h, sMid.y + joints * 0.2); y += 1) {
      if (human[y * w + xc] !== HUMAN_BACKGROUND && human[y * w + xc] !== HUMAN_HAIR) return y;
    }
    return Math.round(sMid.y - joints * 0.25);
  };
  const outside = Math.max(2, Math.round(joints * 0.03));
  return {
    left: { x: left, y: shoulderTop(left - outside) },
    right: { x: right, y: shoulderTop(right + outside) },
  };
}

// Where the garment's shoulders meet its neckline, each side: going down the top of its torso row by row,
// the first row with an opening at its middle (empty there, with garment on both sides), whose two edges,
// each taken up to the top of its column, are the neck points. Null for a garment closed at the neck.
function garmentNeckPoints(torso: Uint8Array, w: number, h: number): { left: Vec; right: Vec } | null {
  let top = h;
  let bottom = -1;
  let minX = w;
  let maxX = -1;
  for (let p = 0; p < torso.length; p += 1) {
    if (!torso[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  if (bottom < 0) return null;
  const centre = Math.round((minX + maxX) / 2);
  const columnTop = (x: number) => {
    for (let y = top; y <= bottom; y += 1) if (torso[y * w + x]) return y;
    return top;
  };
  // A neck opening is open at the garment's top edge: look only near the top (a round collar lower down, with
  // garment above it, isn't one)
  const lastRow = top + Math.max(2, Math.round((bottom - top) * 0.12));
  for (let y = top; y <= lastRow; y += 1) {
    const row = y * w;
    if (torso[row + centre]) continue;
    let left = centre;
    let right = centre;
    while (left > minX && !torso[row + left - 1]) left -= 1;
    while (right < maxX && !torso[row + right + 1]) right += 1;
    // Garment on both sides, and an opening of a sensible width (not a sliver, not the gap between two pieces)
    if (left <= minX || right >= maxX) continue;
    const width = right - left + 1;
    if (width < (maxX - minX) * 0.08 || width > (maxX - minX) * 0.8) continue;
    return { left: { x: left - 1, y: columnTop(left - 1) }, right: { x: right + 1, y: columnTop(right + 1) } };
  }
  return null;
}

// Where a garment's shoulders start, from its shape (a garment photo without a person in it): the outermost
// points across the top of its torso (the top 8% of its height), each at the top of its column there
function garmentShoulderPoints(torso: Uint8Array, w: number, h: number): { left: Vec; right: Vec } | null {
  let top = h;
  let bottom = -1;
  for (let p = 0; p < torso.length; p += 1) {
    if (!torso[p]) continue;
    const y = Math.floor(p / w);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (bottom < 0) return null;
  const bandEnd = top + Math.max(2, Math.round((bottom - top) * 0.08));
  let left = w;
  let right = -1;
  for (let y = top; y <= bandEnd; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!torso[y * w + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (right - left < 4) return null;
  const columnTop = (x: number) => {
    for (let y = top; y <= bottom; y += 1) if (torso[y * w + x]) return y;
    return top;
  };
  return { left: { x: left, y: columnTop(left) }, right: { x: right, y: columnTop(right) } };
}

// The pose model can fold both shoulders onto one point (when the head is cut off by the frame, say). When
// the shoulders are implausibly narrow against the hips, they're re-measured from the person's silhouette
// at shoulder height: its outer edges, brought in a little.
function repairShoulders(body: Body, human: Uint8Array, w: number, h: number) {
  const joints = len(sub(body.shoulders.right, body.shoulders.left));
  const hips = body.hips ? len(sub(body.hips.right, body.hips.left)) : 0;
  if (!hips || joints >= hips * 0.9) return;
  const y = Math.min(h - 1, Math.max(0, Math.round(mid(body.shoulders.left, body.shoulders.right).y)));
  // The widest silhouette row a little below the shoulder line (the line itself can be the neck)
  let left = -1;
  let right = -1;
  for (let row = y; row <= Math.min(h - 1, y + Math.round(hips * 0.5)); row += 1) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < w; x += 1) {
      if (human[row * w + x] === HUMAN_BACKGROUND) continue;
      if (l < 0) l = x;
      r = x;
    }
    if (l >= 0 && r - l > right - left) {
      left = l;
      right = r;
    }
  }
  if (right - left <= joints) return;
  const inset = (right - left) * 0.1;
  body.shoulders.left = { x: left + inset, y: body.shoulders.left.y };
  body.shoulders.right = { x: right - inset, y: body.shoulders.right.y };
  body.arms.left.shoulder = body.shoulders.left;
  body.arms.right.shoulder = body.shoulders.right;
  body.shoulderWidth = len(sub(body.shoulders.right, body.shoulders.left)) * 1.2;
}

// Half the width of an arm's visible forearm: across the bone (elbow to wrist) at a few points along it, how
// far skin reaches either side; the median, kept to a plausible range for the shoulders. Null when too little
// of the forearm's skin shows to measure.
function forearmHalfWidth(arm: Arm, human: Uint8Array, w: number, h: number, shoulderWidth: number): number | null {
  if (!arm.elbow || !arm.wrist) return null;
  const along = sub(arm.wrist, arm.elbow);
  const length = len(along);
  if (length < 4) return null;
  const dir = scaleVec(along, 1 / length);
  const across = { x: -dir.y, y: dir.x };
  const isSkin = (p: Vec) => {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    return x >= 0 && y >= 0 && x < w && y < h && human[y * w + x] === HUMAN_BODY_SKIN;
  };
  const maxReach = shoulderWidth * 0.25;
  const widths: number[] = [];
  for (let t = 0.25; t <= 0.75; t += 0.05) {
    const centre = add(arm.elbow, scaleVec(along, t));
    if (!isSkin(centre)) continue;
    const reach = (sign: number) => {
      let d = 0;
      while (d < maxReach && isSkin(add(centre, scaleVec(across, sign * (d + 1))))) d += 1;
      return d;
    };
    const left = reach(-1);
    const right = reach(1);
    // An arm resting against the body reads as skin running on: leave those out
    if (left < maxReach && right < maxReach) widths.push((left + right) / 2);
  }
  if (widths.length < 3) return null;
  widths.sort((a, b) => a - b);
  return Math.min(shoulderWidth * 0.14, Math.max(shoulderWidth * 0.06, widths[Math.floor(widths.length / 2)] * 1.1));
}

// Distance from point to segment ab
function segmentDistance(p: Vec, a: Vec, b: Vec) {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab))));
  return len(sub(p, add(a, scaleVec(ab, t))));
}

// Where the body is under the clothes, roughly: the torso between shoulders and hips, and the limbs as
// capsules round their bones. 1 = body, plus which limb (for putting arms back in front of the torso), and
// how round the body is at each pixel: 1 along the middle of a limb or the torso, falling toward the edges
// (for shading skin painted in where clothes were).
function bodyZones(body: Body, w: number, h: number, human?: Uint8Array) {
  const n = w * h;
  const inBody = new Uint8Array(n);
  const inArm = new Uint8Array(n);
  const inTorso = new Uint8Array(n);
  const roundness = new Float32Array(n).fill(1);
  const curve = (d: number, r: number) => Math.sqrt(Math.max(0, 1 - (d / r) * (d / r)));
  const sw = body.shoulderWidth;
  // 1 = image-left arm, 2 = image-right arm, 3 = torso, 4 = legs (0 = not body)
  const area = new Uint8Array(n);
  const capsules: Array<{ a: Vec; b: Vec; r: number; arm: boolean; area: number }> = [];
  for (const arm of [body.arms.left, body.arms.right]) {
    const armArea = arm === body.arms.left ? 1 : 2;
    if (arm.elbow) {
      // About as thick as the arm really is where its forearm's skin shows (else a typical arm for the
      // shoulders), with room to spare: a removed sleeve's own outline gives the arm its exact shape inside
      // this, which only trims sleeves reaching far beyond any arm (a pallu hanging from the shoulder)
      const forearm = human ? forearmHalfWidth(arm, human, w, h, sw) : null;
      const upper = Math.min(sw * 0.2, Math.max(sw * 0.13, (forearm ?? sw * 0.1) * 1.6));
      capsules.push({ a: arm.shoulder, b: arm.elbow, r: upper, arm: true, area: armArea });
      if (arm.wrist) capsules.push({ a: arm.elbow, b: arm.wrist, r: (forearm ?? sw * 0.1) * 1.25, arm: true, area: armArea });
    }
  }
  if (body.legs && body.hips) {
    const hipWidth = len(sub(body.hips.right, body.hips.left));
    for (const leg of [body.legs.left, body.legs.right]) {
      if (leg.knee) {
        capsules.push({ a: leg.hip, b: leg.knee, r: hipWidth * 0.6, arm: false, area: 4 });
        if (leg.ankle) capsules.push({ a: leg.knee, b: leg.ankle, r: hipWidth * 0.38, arm: false, area: 4 });
      }
    }
  }
  // Torso: a quadrilateral from just outside and above the shoulder joints (over the tops of the shoulders)
  // to just outside the hips
  const across = unit(sub(body.shoulders.right, body.shoulders.left));
  const sMid = add(mid(body.shoulders.left, body.shoulders.right), scaleVec(body.down, -sw * 0.12));
  const torsoTop = [add(sMid, scaleVec(across, -sw * 0.52)), add(sMid, scaleVec(across, sw * 0.52))];
  const hipMid = body.hips ? mid(body.hips.left, body.hips.right) : add(sMid, scaleVec(body.down, sw * 1.3));
  const hipHalf = body.hips ? len(sub(body.hips.right, body.hips.left)) * 0.85 : sw * 0.45;
  const torsoBottom = [add(hipMid, scaleVec(across, -hipHalf)), add(hipMid, scaleVec(across, hipHalf))];
  const quad = [torsoTop[0], torsoTop[1], torsoBottom[1], torsoBottom[0]];
  const inQuad = (p: Vec) => {
    let sign = 0;
    for (let i = 0; i < 4; i += 1) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross === 0) continue;
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };
  // The torso's centre line, for its roundness across
  const torsoAxisTop = sMid;
  const torsoAxisBottom = hipMid;
  const torsoHalf = (sw * 0.52 + hipHalf) / 2;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = { x, y };
      const q = y * w + x;
      let round = 0;
      if (inQuad(p)) {
        inBody[q] = 1;
        inTorso[q] = 1;
        area[q] = 3;
        round = curve(Math.min(torsoHalf, segmentDistance(p, torsoAxisTop, torsoAxisBottom)), torsoHalf * 1.15);
      }
      for (const c of capsules) {
        const d = segmentDistance(p, c.a, c.b);
        if (d <= c.r) {
          inBody[q] = 1;
          if (c.arm) inArm[q] = 1;
          // Arms count over the torso (an arm in front of the body is arm)
          if (c.arm || !area[q]) area[q] = c.area;
          round = Math.max(round, curve(d, c.r));
        }
      }
      if (inBody[q]) roundness[q] = round;
    }
  }
  return { inBody, inArm, inTorso, roundness, area };
}

// --- parts ---

type Part = {
  kind: PartKind;
  // The garment family it came from (pants vs shorts, ...)
  family: Family;
  mask: Uint8Array;
  count: number;
};

// The garment family of every pixel, details folded into the garment they sit on
function familyMap(parse: PhotoParse, keep: (p: number) => boolean): Int8Array {
  const { width: w, height: h } = parse.image;
  const n = w * h;
  const fam = new Int8Array(n).fill(-1);
  const pending: number[] = [];
  for (let p = 0; p < n; p += 1) {
    if (!keep(p)) continue;
    const cls = parse.fashion[p];
    const family = FAMILY_OF_CLASS[cls];
    if (family) fam[p] = FAMILIES.indexOf(family);
    else if (DETAIL_CLASSES.has(cls) || parse.human[p] === HUMAN_CLOTHES) pending.push(p);
  }
  // Grow the garments into the detail pixels (and, on a person, into clothes the fashion model missed)
  let frontier = pending;
  for (let pass = 0; pass < 64 && frontier.length; pass += 1) {
    const next: number[] = [];
    const assigned: Array<[number, number]> = [];
    for (const p of frontier) {
      const x = p % w;
      let found = -1;
      if (x > 0 && fam[p - 1] >= 0) found = fam[p - 1];
      else if (x < w - 1 && fam[p + 1] >= 0) found = fam[p + 1];
      else if (p >= w && fam[p - w] >= 0) found = fam[p - w];
      else if (p + w < n && fam[p + w] >= 0) found = fam[p + w];
      if (found >= 0) assigned.push([p, found]);
      else next.push(p);
    }
    for (const [p, f] of assigned) fam[p] = f;
    if (!assigned.length) break;
    frontier = next;
  }
  return fam;
}

// The backdrop colour of a product photo, if its border is mostly one colour
function backdropLab(img: LinearImage): [number, number, number] | null {
  const { width: w, height: h, lab } = img;
  const samples: number[] = [];
  for (let x = 0; x < w; x += 4) samples.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += 4) samples.push(y * w, y * w + w - 1);
  const Ls = samples.map((p) => lab[p * 3]).sort((a, b) => a - b);
  const As = samples.map((p) => lab[p * 3 + 1]).sort((a, b) => a - b);
  const Bs = samples.map((p) => lab[p * 3 + 2]).sort((a, b) => a - b);
  const m = Math.floor(samples.length / 2);
  const ref: [number, number, number] = [Ls[m], As[m], Bs[m]];
  let close = 0;
  for (const p of samples) {
    if (Math.hypot(lab[p * 3] - ref[0], lab[p * 3 + 1] - ref[1], lab[p * 3 + 2] - ref[2]) < BACKDROP_DISTANCE) {
      close += 1;
    }
  }
  return close / samples.length >= BACKDROP_UNIFORM ? ref : null;
}

// The plain backdrop of a product photo, if it has one: the backdrop-coloured pixels connected to the photo's
// edge without crossing the garment (white print inside a white-backed garment isn't backdrop, even where it
// reaches the garment's edge). onGarment: whether the fashion model put a garment at a pixel.
function backdropMask(img: LinearImage, onGarment: (p: number) => boolean): Uint8Array | null {
  const ref = backdropLab(img);
  if (!ref) return null;
  const { width: w, height: h, lab } = img;
  const isBackdropColour = (p: number) =>
    Math.hypot(lab[p * 3] - ref[0], lab[p * 3 + 1] - ref[1], lab[p * 3 + 2] - ref[2]) < BACKDROP_DISTANCE;
  const mask = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (p: number) => {
    if (!mask[p] && isBackdropColour(p) && !onGarment(p)) {
      mask[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x += 1) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p + w < w * h) push(p + w);
  }
  return mask;
}

// The y (along the body) where a dress or jumpsuit divides into top and bottom
function waistLine(mask: Uint8Array, w: number, h: number, body: Body | null): (x: number, y: number) => boolean {
  if (body) {
    // The natural waist sits a little above the hip joints; with the hips out of the photo, about a shoulder
    // width below the shoulders
    const sMid = mid(body.shoulders.left, body.shoulders.right);
    let waist: Vec;
    if (body.hips) {
      const hipMid = mid(body.hips.left, body.hips.right);
      waist = add(hipMid, scaleVec(sub(sMid, hipMid), 0.15));
    } else {
      waist = add(sMid, scaleVec(body.down, body.shoulderWidth));
    }
    return (x, y) => dot(sub({ x, y }, waist), body.down) > 0;
  }
  // Without a pose: the narrowest row between 20% and 60% of the way down
  let top = h;
  let bottom = -1;
  const widths = new Int32Array(h);
  for (let y = 0; y < h; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left >= 0) {
      widths[y] = right - left + 1;
      top = Math.min(top, y);
      bottom = y;
    }
  }
  if (bottom < 0) return () => false;
  const span = bottom - top;
  let waistY = top + Math.round(span * 0.35);
  let narrowest = Infinity;
  for (let y = top + Math.round(span * 0.2); y <= top + Math.round(span * 0.6); y += 1) {
    if (widths[y] > 0 && widths[y] < narrowest) {
      narrowest = widths[y];
      waistY = y;
    }
  }
  return (_x, y) => y > waistY;
}

// Splits a photo's garments into parts. On a person (body given), garment pixels must not be skin, face or
// hair; on a product photo, pixels the colour of a plain backdrop are dropped.
function extractParts(parse: PhotoParse, img: LinearImage, body: Body | null, isPerson: boolean): Part[] {
  const { width: w, height: h } = parse.image;
  const n = w * h;
  const backdrop = isPerson
    ? null
    : backdropMask(img, (p) => FAMILY_OF_CLASS[parse.fashion[p]] !== undefined || DETAIL_CLASSES.has(parse.fashion[p]));
  const keep = (p: number) => {
    const hc = parse.human[p];
    if (hc === HUMAN_BODY_SKIN || hc === HUMAN_FACE_SKIN || hc === HUMAN_HAIR) return false;
    return !backdrop?.[p];
  };
  const fam = familyMap(parse, keep);

  const masks = new Map<PartKind, { mask: Uint8Array; family: Family; count: number }>();
  const put = (kind: PartKind, family: Family, p: number) => {
    let entry = masks.get(kind);
    if (!entry) {
      entry = { mask: new Uint8Array(n), family, count: 0 };
      masks.set(kind, entry);
    }
    entry.mask[p] = 1;
    entry.count += 1;
  };

  // Dresses and jumpsuits split at the waist
  const whole = (family: Family) => {
    const mask = new Uint8Array(n);
    const index = FAMILIES.indexOf(family);
    for (let p = 0; p < n; p += 1) if (fam[p] === index) mask[p] = 1;
    return mask;
  };
  const dressBelow = waistLine(whole("dress"), w, h, body);
  const jumpsuitBelow = waistLine(whole("jumpsuit"), w, h, body);

  // Sleeves split by side: by the arms on a person, else by the torso's centre
  let centreX = w / 2;
  if (body) centreX = mid(body.shoulders.left, body.shoulders.right).x;
  else {
    let sum = 0;
    let count = 0;
    for (let p = 0; p < n; p += 1) {
      const f = FAMILIES[fam[p]];
      if (f === "upper" || f === "dress" || f === "jumpsuit") {
        sum += p % w;
        count += 1;
      }
    }
    if (count) centreX = sum / count;
  }
  const sleeveSide = (x: number, y: number): PartKind => {
    if (body) {
      const point = { x, y };
      const armDistance = (arm: Arm) => {
        let d = len(sub(point, arm.shoulder));
        if (arm.elbow) d = Math.min(d, segmentDistance(point, arm.shoulder, arm.elbow));
        if (arm.elbow && arm.wrist) d = Math.min(d, segmentDistance(point, arm.elbow, arm.wrist));
        return d;
      };
      return armDistance(body.arms.left) <= armDistance(body.arms.right) ? "sleeveLeft" : "sleeveRight";
    }
    return x < centreX ? "sleeveLeft" : "sleeveRight";
  };

  for (let p = 0; p < n; p += 1) {
    if (fam[p] < 0) continue;
    const family = FAMILIES[fam[p]];
    const x = p % w;
    const y = (p - x) / w;
    switch (family) {
      case "upper":
        put("torso", family, p);
        break;
      case "dress":
        put(dressBelow(x, y) ? "skirt" : "torso", family, p);
        break;
      case "jumpsuit":
        put(jumpsuitBelow(x, y) ? "legs" : "torso", family, p);
        break;
      case "pants":
      case "shorts":
        put("legs", family, p);
        break;
      case "skirt":
        put("skirt", family, p);
        break;
      case "drape":
        put("drape", family, p);
        break;
      case "sleeve":
        put(sleeveSide(x, y), family, p);
        break;
    }
  }

  // Specks aren't parts
  const minCount = n * 0.002;
  const parts: Part[] = [];
  for (const [kind, entry] of masks) if (entry.count >= minCount) parts.push({ kind, ...entry });
  return parts;
}

// --- part shapes: measured along and across an axis ---

type Shape = {
  origin: Vec;
  axis: Vec;
  perp: Vec;
  tMin: number;
  // Rows across the axis, one per pixel of length: each a list of [start, end] spans of the part
  rows: Array<Array<[number, number]>>;
  // Median total width across
  medianWidth: number;
};

// The principal direction of a mask's pixels
function principalAxis(mask: Uint8Array, w: number): { centre: Vec; axis: Vec } {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    sx += p % w;
    sy += Math.floor(p / w);
    count += 1;
  }
  const cx = sx / Math.max(1, count);
  const cy = sy / Math.max(1, count);
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    const dx = (p % w) - cx;
    const dy = Math.floor(p / w) - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { centre: { x: cx, y: cy }, axis: { x: Math.cos(angle), y: Math.sin(angle) } };
}

// Measures a part along axis (pointing from the end it hangs from to its free end)
function measureShape(mask: Uint8Array, w: number, h: number, origin: Vec, axis: Vec): Shape {
  const perp = { x: -axis.y, y: axis.x };
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    const x = (p % w) - origin.x;
    const y = Math.floor(p / w) - origin.y;
    const t = x * axis.x + y * axis.y;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  const count = Math.max(1, Math.round(tMax - tMin) + 1);
  const us: number[][] = Array.from({ length: count }, () => []);
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    const x = (p % w) - origin.x;
    const y = Math.floor(p / w) - origin.y;
    const row = Math.round(x * axis.x + y * axis.y - tMin);
    us[row].push(x * perp.x + y * perp.y);
  }
  const rows: Array<Array<[number, number]>> = us.map((list) => {
    list.sort((a, b) => a - b);
    const spans: Array<[number, number]> = [];
    for (const u of list) {
      const last = spans[spans.length - 1];
      if (last && u - last[1] <= 2.5) last[1] = u;
      else spans.push([u, u]);
    }
    return spans.filter(([a, b]) => b - a >= 1);
  });
  smoothRows(rows);
  const widthOf = (spans: Array<[number, number]>) => spans.reduce((s, [a, b]) => s + b - a, 0);
  const widths = rows.map(widthOf).filter((v) => v > 0);
  const sorted = [...widths].sort((a, b) => a - b);
  return {
    origin,
    axis,
    perp,
    tMin,
    rows,
    medianWidth: sorted[Math.floor(sorted.length / 2)] ?? 1,
  };
}

// The axis a part is measured along: down the body for torso, skirt, legs and drape. A sleeve is measured
// from its seam with the torso (where it touches the torso; else the shoulder) toward its middle, or on a
// person down the upper arm. (A short sleeve laid flat is wider than it is long, so its principal direction
// would run along the cuff.)
function shapeOf(part: Part, w: number, h: number, body: Body | null, torso: Uint8Array | null): Shape {
  if (part.kind !== "sleeveLeft" && part.kind !== "sleeveRight") {
    return measureShape(part.mask, w, h, { x: 0, y: 0 }, body ? body.down : { x: 0, y: 1 });
  }
  const { centre, axis: principal } = principalAxis(part.mask, w);
  let seam: Vec | null = null;
  if (torso) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let p = 0; p < part.mask.length; p += 1) {
      if (!part.mask[p]) continue;
      const x = p % w;
      const touches =
        (x > 1 && torso[p - 2]) || (x < w - 2 && torso[p + 2]) || (p >= 2 * w && torso[p - 2 * w]) ||
        (p + 2 * w < torso.length && torso[p + 2 * w]);
      if (!touches) continue;
      sx += x;
      sy += (p - x) / w;
      count += 1;
    }
    if (count >= 5) seam = { x: sx / count, y: sy / count };
  }
  const arm = body ? (part.kind === "sleeveLeft" ? body.arms.left : body.arms.right) : null;
  if (!seam) seam = arm ? arm.shoulder : centre;
  let axis: Vec;
  if (arm?.elbow) axis = unit(sub(arm.elbow, arm.shoulder));
  else if (len(sub(centre, seam)) > 2) axis = unit(sub(centre, seam));
  else axis = principal;
  return measureShape(part.mask, w, h, seam, axis);
}

// Evens out the ragged edges of a shape's rows (segmentation edges step from row to row, and a warp that
// follows them row by row streaks): each span's ends become the mean over the nearby rows with as many spans
function smoothRows(rows: Array<Array<[number, number]>>, radius = 3) {
  const original = rows.map((row) => row.map(([a, b]) => [a, b] as [number, number]));
  for (let i = 0; i < rows.length; i += 1) {
    const count = original[i].length;
    if (!count) continue;
    for (let k = 0; k < count; k += 1) {
      let a = 0;
      let b = 0;
      let used = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(rows.length - 1, i + radius); j += 1) {
        if (original[j].length !== count) continue;
        a += original[j][k][0];
        b += original[j][k][1];
        used += 1;
      }
      rows[i][k] = [a / used, b / used];
    }
  }
}

// The centre (across) of the widest outer span over a stretch of a shape's rows, given as fractions
function spanCentre(shape: Shape, from: number, to: number): number {
  const n = shape.rows.length;
  let widest = -1;
  let centre = 0;
  for (let i = Math.floor(from * (n - 1)); i <= Math.ceil(to * (n - 1)); i += 1) {
    const row = shape.rows[i];
    if (!row?.length) continue;
    const width = row[row.length - 1][1] - row[0][0];
    if (width > widest) {
      widest = width;
      centre = (row[row.length - 1][1] + row[0][0]) / 2;
    }
  }
  return centre;
}

// The widest outer span (first span's start to last span's end) over a stretch of a shape's rows, given as
// fractions of its length
function spanWidth(shape: Shape, from: number, to: number): number {
  const n = shape.rows.length;
  let widest = 0;
  for (let i = Math.floor(from * (n - 1)); i <= Math.ceil(to * (n - 1)); i += 1) {
    const row = shape.rows[i];
    if (row?.length) widest = Math.max(widest, row[row.length - 1][1] - row[0][0]);
  }
  return widest;
}

const isUpper = (kind: PartKind) => kind !== "skirt" && kind !== "legs";

// --- shading ---

// A region's dominant colour (Lab): the mean of the fullest cell of a coarse Lab histogram
function dominantLab(lab: Float32Array, region: Uint8Array): [number, number, number] {
  const cells = new Map<number, number>();
  const cellOf = (p: number) =>
    Math.round(lab[p * 3] / 12) * 10000 + Math.round(lab[p * 3 + 1] / 8 + 50) * 100 + Math.round(lab[p * 3 + 2] / 8 + 50);
  for (let p = 0; p < region.length; p += 1) if (region[p]) cells.set(cellOf(p), (cells.get(cellOf(p)) ?? 0) + 1);
  let modeCell = 0;
  let modeCount = -1;
  for (const [cell, count] of cells) {
    if (count > modeCount) {
      modeCount = count;
      modeCell = cell;
    }
  }
  const dominant: [number, number, number] = [0, 0, 0];
  let count = 0;
  for (let p = 0; p < region.length; p += 1) {
    if (!region[p] || cellOf(p) !== modeCell) continue;
    for (let c = 0; c < 3; c += 1) dominant[c] += lab[p * 3 + c];
    count += 1;
  }
  for (let c = 0; c < 3; c += 1) dominant[c] /= Math.max(1, count);
  return dominant;
}

// Shading multipliers over a region (linear light, 1 = the region's typical brightness): its lightness,
// blurred over the pixels that look like the region around them (print and motifs left out), relative to
// the region's median. radii: blur radii from fine to wide.
function regionShading(img: LinearImage, region: Uint8Array, radii: number[]): Float32Array {
  const { width: w, height: h, lab } = img;
  const n = w * h;
  const ones = new Float32Array(n);
  const channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let p = 0; p < n; p += 1) {
    if (!region[p]) continue;
    ones[p] = 1;
    for (let c = 0; c < 3; c += 1) channels[c][p] = lab[p * 3 + c];
  }
  const localR = radii[Math.min(1, radii.length - 1)];
  const local = channels.map((ch) => weightedBoxBlur(ch, ones, w, h, Math.max(2, Math.round(localR))).mean);
  // Prints bigger than the local box, like a large logo, are told apart from shading by being far from the
  // region's dominant colour
  const dominant = dominantLab(lab, region);
  const motif = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    if (!region[p]) continue;
    const d = Math.hypot((lab[p * 3] - local[0][p]) * 0.5, lab[p * 3 + 1] - local[1][p], lab[p * 3 + 2] - local[2][p]);
    const fromDominant = Math.hypot(
      (lab[p * 3] - dominant[0]) * 0.5,
      lab[p * 3 + 1] - dominant[1],
      lab[p * 3 + 2] - dominant[2],
    );
    if (d > MOTIF_DISTANCE || fromDominant > 2 * MOTIF_DISTANCE) motif[p] = 1;
  }
  const nearMotif = boxSum(motif, w, h, 2);
  const weights = new Float32Array(n);
  const values = new Float32Array(n);
  const Ls: number[] = [];
  for (let p = 0; p < n; p += 1) {
    if (!region[p] || nearMotif[p] > 0) continue;
    weights[p] = 1;
    values[p] = lab[p * 3];
    Ls.push(lab[p * 3]);
  }
  if (Ls.length < 20) {
    for (let p = 0; p < n; p += 1) {
      if (!region[p]) continue;
      weights[p] = 1;
      values[p] = lab[p * 3];
      Ls.push(lab[p * 3]);
    }
  }
  Ls.sort((a, b) => a - b);
  const median = Math.max(1, Ls[Math.floor(Ls.length / 2)] ?? 50);
  for (let p = 0; p < n; p += 1) {
    if (weights[p]) values[p] = Math.min(SHADE_MAX * median, Math.max(SHADE_MIN * median, values[p]));
  }
  const blurred = fillBlur(values, weights, w, h, radii);
  const ref = luminanceOfL(median);
  const shade = new Float32Array(n).fill(1);
  for (let p = 0; p < n; p += 1) {
    if (!Number.isNaN(blurred[p])) shade[p] = Math.min(SHADE_MAX, Math.max(SHADE_MIN, luminanceOfL(blurred[p]) / ref));
  }
  return shade;
}

// --- the try-on ---

// Fills the holes in a garment, the garment hidden behind something in the garment photo: pixels enclosed by
// it (not reachable from the photo's edge without crossing it), and the wearer's skin lying across it (within
// the garment's width on its row: a hand or forearm resting on the front, not an arm hanging beside it). Each
// hole pixel joins the part directly above it (else below). Returns the pixels filled.
function fillGarmentHoles(parts: Part[], human: Uint8Array, w: number, h: number): Uint8Array {
  const filled = new Uint8Array(w * h);
  const n = w * h;
  const owner = new Int16Array(n).fill(-1);
  parts.forEach((part, i) => {
    for (let p = 0; p < n; p += 1) if (part.mask[p]) owner[p] = i;
  });
  // (Only skin with garment above it too: a hand resting on the front, not the skin inside an open neckline)
  const garmentAbove = new Uint8Array(n);
  for (let p = w; p < n; p += 1) garmentAbove[p] = owner[p - w] >= 0 || garmentAbove[p - w] ? 1 : 0;
  const across = new Uint8Array(n);
  for (let y = 0; y < h; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < w; x += 1) {
      if (owner[y * w + x] < 0) continue;
      if (left < 0) left = x;
      right = x;
    }
    for (let x = left + 1; left >= 0 && x < right; x += 1) {
      const p = y * w + x;
      if (owner[p] < 0 && human[p] === HUMAN_BODY_SKIN && garmentAbove[p]) across[p] = 1;
    }
  }
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const push = (p: number) => {
    if (owner[p] < 0 && !across[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x += 1) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p + w < n) push(p + w);
  }
  for (let p = 0; p < n; p += 1) {
    if (owner[p] >= 0 || (outside[p] && !across[p])) continue;
    let q = p;
    while (q >= w && owner[q] < 0) q -= w;
    let i = owner[q];
    if (i < 0) {
      q = p;
      while (q + w < n && owner[q] < 0) q += w;
      i = owner[q];
    }
    if (i < 0) continue;
    parts[i].mask[p] = 1;
    parts[i].count += 1;
    filled[p] = 1;
  }
  return filled;
}

// How far down the body (along body.down) the ankles are: from the pose where they show, else where the
// person's figure ends (a little above it: the feet), unless the figure runs off the bottom of the photo
function ankleLevel(body: Body, human: Uint8Array, w: number, h: number): number | null {
  const ankles = body.legs ? [body.legs.left.ankle, body.legs.right.ankle].filter((a): a is Vec => a !== null) : [];
  if (ankles.length) return Math.max(...ankles.map((a) => dot(a, body.down)));
  let lowest = -Infinity;
  let lowestY = 0;
  for (let p = 0; p < human.length; p += 1) {
    if (human[p] === HUMAN_BACKGROUND) continue;
    const x = p % w;
    const y = (p - x) / w;
    const t = dot({ x, y }, body.down);
    if (t > lowest) {
      lowest = t;
      lowestY = y;
    }
  }
  if (lowest === -Infinity || lowestY >= h - 3) return null;
  return lowest - body.shoulderWidth * 0.1;
}

// Paints skin where clothes came off (toSkin), blended into the person's real skin so no seam shows:
// 1. An estimate: the colour of the person's arms' skin (each arm its own; the torso and legs both arms'),
//    blended softly across the areas' boundaries, a touch darker toward the edges of a limb or the torso.
// 2. The light: how much brighter or darker the real skin is than that estimate is measured on the visible
//    skin (well inside it: pixels at its edge are mixed with clothes or background) and spread smoothly over
//    the painted area (the way seamless cloning works), so at its edges the painted skin matches the
//    brightness of the skin beside it, and shadows carry across. Only brightness carries: the colour stays
//    the skin's own.
// 3. A faint grain, so it isn't flat paint.
function paintSkin(
  out: Float32Array,
  img: LinearImage,
  human: Uint8Array,
  zones: { inBody: Uint8Array; area: Uint8Array; roundness: Float32Array },
  toSkin: Uint8Array,
  shoulderWidth: number,
) {
  const { width: w, height: h } = img;
  const n = w * h;
  let any = false;
  for (let p = 0; p < n; p += 1) if (toSkin[p]) any = true;
  if (!any) return;

  // 1. The estimate, per area and blended across areas (over the body and the visible skin)
  const byArea = areaSkinColours(img, human, zones.area);
  const isRealSkin = (p: number) => !toSkin[p] && (human[p] === HUMAN_BODY_SKIN || human[p] === HUMAN_FACE_SKIN);
  const weights = new Float32Array(n);
  const channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let p = 0; p < n; p += 1) {
    if (!zones.inBody[p] && !isRealSkin(p)) continue;
    weights[p] = 1;
    const colour = byArea[zones.area[p]];
    for (let c = 0; c < 3; c += 1) channels[c][p] = colour[c];
  }
  const radius = Math.max(2, Math.round(shoulderWidth * 0.06));
  const blended = channels.map((ch) => weightedBoxBlur(ch, weights, w, h, radius).mean);
  const estimate = (p: number, c: number) => {
    const v = blended[c][p];
    const base = Number.isNaN(v) ? byArea[0][c] : v;
    return base * (0.92 + 0.08 * zones.roundness[p]);
  };

  // 2. Real skin brightness / estimated brightness, from skin at least EDGE pixels inside the skin, spread
  // over the painted area
  const EDGE = 3;
  const realSkin = new Float32Array(n);
  for (let p = 0; p < n; p += 1) if (isRealSkin(p)) realSkin[p] = 1;
  const nearNonSkin = boxSum(realSkin, w, h, EDGE);
  const full = (2 * EDGE + 1) * (2 * EDGE + 1);
  const brightness = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // (Leaving out pixels far less or more colourful than the skin typically is: not really skin)
  const chromaOf = (p: number) => Math.hypot(img.lab[p * 3 + 1], img.lab[p * 3 + 2]);
  const skinChromas: number[] = [];
  for (let p = 0; p < n; p += 1) if (realSkin[p] && nearNonSkin[p] >= full) skinChromas.push(chromaOf(p));
  skinChromas.sort((a, b) => a - b);
  const typicalChroma = skinChromas[Math.floor(skinChromas.length / 2)] ?? 0;
  const ratio = new Float32Array(n * 3);
  const known = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    if (!realSkin[p] || nearNonSkin[p] < full) continue;
    const chroma = chromaOf(p);
    if (typicalChroma > 0 && (chroma < typicalChroma * 0.6 || chroma > typicalChroma * 1.6)) continue;
    known[p] = 1;
    const real = brightness(img.rgb[p * 3], img.rgb[p * 3 + 1], img.rgb[p * 3 + 2]);
    const est = brightness(estimate(p, 0), estimate(p, 1), estimate(p, 2));
    ratio[p * 3] = Math.min(1.5, Math.max(0.6, real / Math.max(1e-4, est)));
  }
  // The spread is smoothed a little first, so the skin's own fine texture at the boundary doesn't streak in
  const ratioValues = new Float32Array(n);
  for (let p = 0; p < n; p += 1) ratioValues[p] = ratio[p * 3];
  const smoothed = weightedBoxBlur(ratioValues, known, w, h, 3).mean;
  for (let p = 0; p < n; p += 1) {
    if (!known[p]) continue;
    ratio[p * 3] = ratio[p * 3 + 1] = ratio[p * 3 + 2] = smoothed[p];
  }
  const light = pushPullFill(ratio, known, w, h);

  // 3. Paint, with a faint grain
  for (let p = 0; p < n; p += 1) {
    if (!toSkin[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    const grain = 1 + 0.012 * (hashNoise(x, y) + hashNoise(x + 1, y) + hashNoise(x, y + 1) + hashNoise(x + 1, y + 1)) / 4;
    const l = light[p * 3] || 1;
    for (let c = 0; c < 3; c += 1) out[p * 3 + c] = estimate(p, c) * l * grain;
  }
}

// A repeatable pseudo-random value in [-1, 1] for pixel (x, y)
function hashNoise(x: number, y: number) {
  let v = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return (((v ^ (v >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

// The colour to paint skin in each body area (index by area: 1, 2 arms, 3 torso, 4 legs, 0 none): each arm's
// visible skin's median colour, and both arms' for everything else (falling back to all visible skin). Edge pixels of skin (mixed with hair, clothes or
// background) don't count.
function areaSkinColours(img: LinearImage, human: Uint8Array, area: Uint8Array): Array<[number, number, number]> {
  const w = img.width;
  const n = human.length;
  const isSkin = (q: number) => human[q] === HUMAN_BODY_SKIN;
  const lists: number[][][] = Array.from({ length: 5 }, () => [[], [], []]);
  const all: number[][] = [[], [], []];
  // Skin pixels (away from the skin's edge) and how colourful each is; pixels far less (or more) colourful
  // than skin typically is here are something else the parser took for skin (white fabric, a grey wall)
  const candidates: number[] = [];
  const chroma = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    const x = p % w;
    if (!isSkin(p) || x < 2 || x >= w - 2 || p < 2 * w || p + 2 * w >= n) continue;
    if (!isSkin(p - 2) || !isSkin(p + 2) || !isSkin(p - 2 * w) || !isSkin(p + 2 * w)) continue;
    candidates.push(p);
    chroma[p] = Math.hypot(img.lab[p * 3 + 1], img.lab[p * 3 + 2]);
  }
  const chromas = candidates.map((p) => chroma[p]).sort((a, b) => a - b);
  const typical = chromas[Math.floor(chromas.length / 2)] ?? 0;
  for (const p of candidates) {
    if (typical > 0 && (chroma[p] < typical * 0.6 || chroma[p] > typical * 1.6)) continue;
    for (let c = 0; c < 3; c += 1) {
      all[c].push(img.rgb[p * 3 + c]);
      lists[area[p]][c].push(img.rgb[p * 3 + c]);
    }
  }
  const median = (chans: number[][]): [number, number, number] | null => {
    if (chans[0].length < 60) return null;
    return chans.map((list) => {
      list.sort((a, b) => a - b);
      return list[Math.floor(list.length / 2)];
    }) as [number, number, number];
  };
  const anySkin = median(all) ?? [0.6, 0.4, 0.3];
  const arms = median([0, 1, 2].map((c) => [...lists[1][c], ...lists[2][c]])) ?? anySkin;
  // Arms keep their own colour; the torso and legs take the arms' (their shown skin, around a neckline or a
  // hem, is often lit differently)
  return [arms, median(lists[1]) ?? arms, median(lists[2]) ?? arms, arms, arms];
}

// Closes small notches and slits in each garment part's outline (where the parser missed a sliver, like a
// label or a fold at the collar): a morphological closing, by a radius of 2% of the garment's width
function closeNotches(parts: Part[], w: number, h: number) {
  for (const part of parts) {
    let minX = w;
    let maxX = -1;
    for (let p = 0; p < part.mask.length; p += 1) {
      if (!part.mask[p]) continue;
      const x = p % w;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (maxX < 0) continue;
    const r = Math.max(1, Math.round((maxX - minX) * 0.02));
    const full = (2 * r + 1) * (2 * r + 1);
    const grown = boxSum(Float32Array.from(part.mask), w, h, r).map((v) => (v > 0 ? 1 : 0));
    const shrunk = boxSum(grown, w, h, r);
    let count = 0;
    for (let p = 0; p < part.mask.length; p += 1) {
      if (shrunk[p] >= full - 0.5) part.mask[p] = 1;
      count += part.mask[p];
    }
    part.count = count;
  }
}

// Rebuilds background where clothes came off: each gap pixel takes the background beside the gap on its row,
// mirrored across the gap's edge (so the wall's or floor's own texture carries in, rather than a blur), from
// both sides weighted by nearness. Rows with no background beside the gap keep the fallback fill.
function mirrorFill(
  rgb: Float32Array,
  known: Float32Array,
  gap: Uint8Array,
  w: number,
  h: number,
  fallback: Float32Array,
): Float32Array {
  const out = fallback.slice();
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let x = 0;
    while (x < w) {
      if (!gap[row + x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end + 1 < w && gap[row + end + 1]) end += 1;
      // Background just outside the run on each side (looking past any non-background pixels)
      const left = x - 1;
      const right = end + 1;
      const leftOk = left >= 0 && known[row + left] > 0;
      const rightOk = right < w && known[row + right] > 0;
      for (let xi = x; xi <= end; xi += 1) {
        const p = row + xi;
        let sum = [0, 0, 0];
        let weight = 0;
        const take = (src: number, wgt: number) => {
          for (let c = 0; c < 3; c += 1) sum[c] += rgb[src * 3 + c] * wgt;
          weight += wgt;
        };
        if (leftOk) {
          const d = xi - left;
          let sx = left - (d - 1);
          if (sx < 0 || !known[row + sx]) sx = left;
          take(row + sx, 1 / d);
        }
        if (rightOk) {
          const d = right - xi;
          let sx = right + (d - 1);
          if (sx >= w || !known[row + sx]) sx = right;
          take(row + sx, 1 / d);
        }
        if (weight > 0) {
          sum = sum.map((v) => v / weight);
          for (let c = 0; c < 3; c += 1) out[p * 3 + c] = sum[c];
        }
      }
      x = end + 1;
    }
  }
  return out;
}

// The top edge of a garment part once placed on the person (xf: garment photo -> person photo), per column
// of the person photo: the highest placed pixel in each column, carried out flat past the part's sides
function placedTopEdge(
  mask: Uint8Array,
  gw: number,
  xf: { forward: (p: Vec) => Vec },
  w: number,
  h: number,
  scale: number,
): Float32Array {
  const top = new Float32Array(w).fill(Infinity);
  // Each garment pixel covers about scale person pixels across
  const spread = Math.max(0, Math.ceil(scale / 2));
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    const x = p % gw;
    const q = xf.forward({ x, y: (p - x) / gw });
    const qx = Math.round(q.x);
    for (let dx = -spread; dx <= spread; dx += 1) {
      const col = qx + dx;
      if (col >= 0 && col < w && q.y < top[col]) top[col] = q.y;
    }
  }
  let first = -1;
  let last = -1;
  for (let x = 0; x < w; x += 1) {
    if (top[x] === Infinity) continue;
    if (first < 0) first = x;
    last = x;
  }
  if (first < 0) return top.fill(-Infinity);
  for (let x = 0; x < first; x += 1) top[x] = top[first];
  for (let x = last + 1; x < w; x += 1) top[x] = top[last];
  // Columns inside the span the part missed (thin gaps) take their neighbours' edge
  for (let x = first; x <= last; x += 1) if (top[x] === Infinity) top[x] = top[x - 1];
  return top.map((v) => Math.min(v, h));
}

// The top end of a sleeve's seam with the torso (its highest pixel touching the torso), or null if it doesn't
// touch the torso
function seamTop(sleeve: Uint8Array, torso: Uint8Array | null, w: number): Vec | null {
  if (!torso) return null;
  for (let p = 0; p < sleeve.length; p += 1) {
    if (!sleeve[p]) continue;
    const x = p % w;
    const touches =
      (x > 1 && torso[p - 2]) || (x < w - 2 && torso[p + 2]) || (p >= 2 * w && torso[p - 2 * w]) ||
      (p + 2 * w < torso.length && torso[p + 2 * w]);
    if (touches) return { x, y: (p - x) / w };
  }
  return null;
}

// The person photo wearing the garment photo's garment
export function tryOnGarment(person: PhotoParse, garment: PhotoParse): { image: RGBAImage; report: TryOnReport } {
  const P = toLinearImage(person.image);
  const G = toLinearImage(garment.image);
  const w = P.width;
  const h = P.height;
  const n = w * h;
  const gw = G.width;
  const gh = G.height;
  const report: TryOnReport = { placed: [], notes: [] };

  const body = bodyFromPose(person.pose, w, h);
  if (!body) throw new Error("No person found in the photo");
  repairShoulders(body, person.human, w, h);
  let garmentSkin = 0;
  for (let p = 0; p < gw * gh; p += 1) {
    const hc = garment.human[p];
    if (hc === HUMAN_BODY_SKIN || hc === HUMAN_FACE_SKIN) garmentSkin += 1;
  }
  const gBody = garmentSkin >= gw * gh * MIN_GARMENT_SKIN_FRACTION ? bodyFromPose(garment.pose, gw, gh) : null;

  const gParts = extractParts(garment, G, gBody, false);
  // (The neck opening is found on the torso as the garment photo shows it, before hidden areas are filled in:
  // filling can close it)
  const gTorsoAsShown = gParts.find((p) => p.kind === "torso")?.mask.slice() ?? null;
  const gHoles = fillGarmentHoles(gParts, garment.human, gw, gh);
  closeNotches(gParts, gw, gh);
  if (!gParts.length) throw new Error("No garment found in the garment photo");
  const pParts = extractParts(person, P, body, true);

  const gTorso = gParts.find((p) => p.kind === "torso")?.mask ?? null;
  const gShapes = new Map(gParts.map((part) => [part.kind, shapeOf(part, gw, gh, gBody, gTorso)]));
  for (const [kind, shape] of gShapes) {
    report.notes.push(
      `garment ${kind}: ${shape.rows.length}px long from (${Math.round(shape.origin.x)}, ${Math.round(shape.origin.y)}) ` +
        `along ${Math.round((Math.atan2(shape.axis.y, shape.axis.x) * 180) / Math.PI)}deg`,
    );
  }

  // Body-scale references: the shoulders' span and the waist's span, on the person from the pose, on the
  // garment from its pose too or else from its own shape (the widest span across the top of the torso, and
  // across the waistband)
  const sw = body.shoulderWidth;
  const hipJoints = body.hips ? len(sub(body.hips.right, body.hips.left)) : sw * 0.45;
  const pWaistSpan = hipJoints * WAIST_PER_HIP_JOINTS;
  const gTorsoShape = gShapes.get("torso");
  const gLowerShape = gShapes.get("skirt") ?? gShapes.get("legs");
  const gUpperSpan = gBody ? gBody.shoulderWidth : gTorsoShape ? spanWidth(gTorsoShape, 0.05, 0.3) : null;
  const gLowerSpan = gBody?.hips
    ? len(sub(gBody.hips.right, gBody.hips.left)) * WAIST_PER_HIP_JOINTS
    : gLowerShape
      ? spanWidth(gLowerShape, 0, 0.08)
      : null;
  // The torso goes on with its shoulders where the person's start at the neck: the garment's two neck points
  // (the edges of its neck opening) onto the person's (where their neck meets their shoulders), which sets its
  // size too. Without neck points (a garment closed at the neck, or a neck that can't be found), the shoulder
  // tips are lined up instead.
  const pTips = bodyShoulderPoints(body);
  const gTips = gBody ? bodyShoulderPoints(gBody) : gTorso ? garmentShoulderPoints(gTorso, gw, gh) : null;
  const tipScale = gTips ? len(sub(pTips.right, pTips.left)) / len(sub(gTips.right, gTips.left)) : null;
  const pNeck = personNeckPoints(body, person.human, w, h);
  const gNeck = gTorsoAsShown ? garmentNeckPoints(gTorsoAsShown, gw, gh) : null;
  const describePoints = (pts: { left: Vec; right: Vec }) =>
    `(${Math.round(pts.left.x)}, ${Math.round(pts.left.y)})-(${Math.round(pts.right.x)}, ${Math.round(pts.right.y)})`;
  let shoulderTransform: ReturnType<typeof similarity> | null = null;
  let shoulderScale: number | null = null;
  // The garment stays upright unless the person clearly leans: the tilt of their shoulder line, if more than
  // UPRIGHT_TOLERANCE (the two neck points can sit at different heights when one shoulder is covered, so they
  // don't set the tilt)
  const shoulderLine = sub(body.shoulders.right, body.shoulders.left);
  const lean = Math.atan2(shoulderLine.y, shoulderLine.x);
  const personAcross = Math.abs(lean) > UPRIGHT_TOLERANCE ? unit(shoulderLine) : { x: 1, y: 0 };
  const garmentAcross = (pts: { left: Vec; right: Vec }) =>
    Math.abs(Math.atan2(pts.right.y - pts.left.y, pts.right.x - pts.left.x)) > UPRIGHT_TOLERANCE
      ? unit(sub(pts.right, pts.left))
      : { x: 1, y: 0 };
  const level = (pts: { left: Vec; right: Vec }) => mid(pts.left, pts.right);
  // A garment with sleeves has its shoulder seams at the shoulder tips, so it's placed by those; one without
  // (a blouse, a tank top) stops short of the tips, so it's placed by its neck opening
  const gSleeved = gParts.some((p) => p.kind === "sleeveLeft" || p.kind === "sleeveRight");
  if (pNeck && gNeck && !(gSleeved && gTips && tipScale)) {
    // Sized and placed so the garment's shoulders start where the person's do, at the neck (kept within
    // NECK_SCALE_RANGE of the shoulder tips' size, in case a neck was misread)
    const neckScale = len(sub(pNeck.right, pNeck.left)) / Math.max(1, len(sub(gNeck.right, gNeck.left)));
    shoulderScale = tipScale
      ? Math.min(tipScale * NECK_SCALE_RANGE[1], Math.max(tipScale * NECK_SCALE_RANGE[0], neckScale))
      : neckScale;
    // (A touch higher than where the neck meets the shoulders: a garment's shoulder rests on top of them)
    const neckAnchor = add(level(pNeck), scaleVec(body.down, -sw * NECK_LIFT));
    shoulderTransform = similarity(level(gNeck), garmentAcross(gNeck), neckAnchor, personAcross, shoulderScale);
    report.notes.push(`neck: garment ${describePoints(gNeck)} onto person ${describePoints(pNeck)}`);
  } else if (gTips && tipScale) {
    report.notes.push(
      gSleeved
        ? "sleeved garment: placed by the shoulder tips"
        : !gNeck
          ? "neck: no neck opening found on the garment"
          : "neck: the person's neck couldn't be found",
    );
    shoulderScale = tipScale;
    shoulderTransform = similarity(level(gTips), garmentAcross(gTips), level(pTips), personAcross, tipScale);
    report.notes.push(`shoulder tips: garment ${describePoints(gTips)} onto person ${describePoints(pTips)}`);
  }
  // Garment-photo pixels to person pixels, for upper and lower garments (each standing in for the other
  // when missing)
  const scaleUpper = shoulderScale ?? (gUpperSpan ? sw / gUpperSpan : gLowerSpan ? pWaistSpan / gLowerSpan : 1);
  const scaleLower = gLowerSpan ? pWaistSpan / gLowerSpan : scaleUpper;

  // Lighting: each of the person's garment parts has its own (its own colour is its typical brightness),
  // skin has its own, elsewhere 1
  const shade = new Float32Array(n).fill(1);
  const inAnyPart = new Uint8Array(n);
  for (const part of pParts) {
    const partShade = regionShading(P, part.mask, [sw * 0.03, sw * 0.1, sw * 0.3]);
    for (let p = 0; p < n; p += 1) {
      if (!part.mask[p]) continue;
      shade[p] = partShade[p];
      inAnyPart[p] = 1;
    }
  }
  const skinRegion = new Uint8Array(n);
  let skinCount = 0;
  for (let p = 0; p < n; p += 1) {
    if (person.human[p] === HUMAN_BODY_SKIN) {
      skinRegion[p] = 1;
      skinCount += 1;
    }
  }
  if (skinCount < 50) for (let p = 0; p < n; p += 1) if (person.human[p] === HUMAN_FACE_SKIN) skinRegion[p] = 1;
  const skinShade = regionShading(P, skinRegion, [sw * 0.15, sw * 0.4, sw * 1.2]);
  for (let p = 0; p < n; p += 1) if (!inAnyPart[p]) shade[p] = skinShade[p];
  // A garment's lighting over the person: the folds of what they wore (softened), wrapped round the body
  // (lighter along the middle of the torso and arms, darker toward their sides); where it hangs clear of the
  // body, a little in shade
  const garmentShade = new Float32Array(n);

  // The garment's colours with its own lighting divided out (smooth shading only, so its print stays)
  const gAlbedo = G.rgb.slice();
  for (const part of gParts) {
    const gShade = regionShading(G, part.mask, [Math.max(4, gShapes.get(part.kind)!.medianWidth * 0.08)]);
    for (let p = 0; p < gw * gh; p += 1) {
      if (!part.mask[p]) continue;
      for (let c = 0; c < 3; c += 1) gAlbedo[p * 3 + c] = Math.min(1, G.rgb[p * 3 + c] / gShade[p]);
    }
  }
  // Each part's outline is trimmed by a pixel (its edge pixels carry backdrop colour), and the colours just
  // inside are spread outward, so sampling at the outline never picks up the backdrop
  // (Trimmed and feathered on the garment's outline only: where two parts of it meet, like the halves of a
  // dress at the waist, each part reaches a little past the other, so no seam opens)
  const union = new Uint8Array(gw * gh);
  for (const part of gParts) for (let p = 0; p < gw * gh; p += 1) if (part.mask[p]) union[p] = 1;
  const innerUnion = erodeMask(union, gw);
  // (Holes filled in the garment take their colour from the fabric around them, not from what covered them)
  const insideAny = Float32Array.from(innerUnion, (v, p) => (gHoles[p] ? 0 : v));
  const softMasks = new Map<PartKind, Float32Array>();
  for (const part of gParts) {
    const grown = boxSum(Float32Array.from(part.mask), gw, gh, 2);
    const inner = new Uint8Array(gw * gh);
    for (let p = 0; p < gw * gh; p += 1) if (innerUnion[p] && grown[p] > 0) inner[p] = 1;
    // The edge feathered over about two person pixels, so it reads as fabric, not a cut-out
    const k = isUpper(part.kind) ? scaleUpper : scaleLower;
    const r = Math.max(1, Math.round(1 / Math.max(0.05, k)));
    const sums = boxSum(Float32Array.from(inner), gw, gh, r);
    const full = (2 * r + 1) * (2 * r + 1);
    softMasks.set(part.kind, sums.map((v) => Math.min(1, (v / full) * 1.15)));
  }
  const albedoImage: LinearImage = { rgb: pushPullFill(gAlbedo, insideAny, gw, gh), lab: G.lab, width: gw, height: gh };

  const out = P.rgb.slice();
  const zones = bodyZones(body, w, h, person.human);
  for (let p = 0; p < n; p += 1) {
    const folds = inAnyPart[p] ? 1 + FOLD_STRENGTH * (shade[p] - 1) : skinShade[p];
    const round = zones.inBody[p] ? 1 - ROUNDNESS_DEPTH + ROUNDNESS_DEPTH * zones.roundness[p] : 1 - ROUNDNESS_DEPTH * 0.6;
    garmentShade[p] = folds * round;
  }

  const torsoTransform =
    shoulderTransform ?? (gTorsoShape ? overlayTransform("torso", gTorsoShape, gBody, body, scaleUpper) : null);

  // Taking off what the new garment replaces. Skin is painted where the body is, background around it.
  // Skin also where the new top leaves the body bare: on a side where it has no sleeve, the person's sleeve and
  // any of their clothes over that arm come off (over a sleeved top, a sleeveless one shows bare arms), and so
  // does whatever the person wore above its top edge (around the neck,
  // inside its neckline, over the shoulders). Skin is painted there (in the arms' own colour and light), and
  // background around the body.
  const gKinds = new Set(gParts.map((p) => p.kind));
  {
    const toSkin = new Uint8Array(n);
    const toBackground = new Uint8Array(n);
    let anyBackground = false;
    // Part for part: each part the garment has takes the person's same part off (a skirt or pants take off
    // both: either is the lower garment), so none of the old one shows round the new one's edges
    const lowerKinds: PartKind[] = ["skirt", "legs"];
    const gLower = lowerKinds.some((k) => gKinds.has(k));
    for (const part of pParts) {
      const replaced = gKinds.has(part.kind) || (gLower && lowerKinds.includes(part.kind));
      if (!replaced) continue;
      for (let p = 0; p < n; p += 1) {
        if (!part.mask[p]) continue;
        if (zones.inBody[p]) toSkin[p] = 1;
        else {
          toBackground[p] = 1;
          anyBackground = true;
        }
      }
    }
    if (gKinds.has("torso") && torsoTransform && gTorso) {
      const topEdge = placedTopEdge(gTorso, gw, torsoTransform, w, h, scaleUpper);
      for (let p = 0; p < n; p += 1) {
        if (!inAnyPart[p] || !(zones.inTorso[p] || zones.inArm[p])) continue;
        const x = p % w;
        if ((p - x) / w < topEdge[x]) toSkin[p] = 1;
      }
    }
    for (const kind of ["sleeveLeft", "sleeveRight"] as const) {
      if (!gKinds.has("torso") || gKinds.has(kind)) continue;
      const sleeve = pParts.find((p) => p.kind === kind);
      const side = kind === "sleeveLeft" ? 1 : 2;
      report.notes.push(`${kind}: the garment has none, so the arm is bare`);
      for (let p = 0; p < n; p += 1) {
        // The person's sleeve, and any of their clothes over that arm (a pallu over the shoulder)
        if (sleeve?.mask[p]) {
          if (zones.inBody[p]) toSkin[p] = 1;
          else {
            toBackground[p] = 1;
            anyBackground = true;
          }
        } else if (inAnyPart[p] && zones.inArm[p] && zones.area[p] === side) {
          toSkin[p] = 1;
        }
      }
    }
    paintSkin(out, P, person.human, zones, toSkin, sw);
    if (anyBackground) {
      // Known: background pixels, not anything being replaced
      const known = new Float32Array(n);
      for (let p = 0; p < n; p += 1) {
        if (person.human[p] === HUMAN_BACKGROUND && !inAnyPart[p] && !toBackground[p]) known[p] = 1;
      }
      const filled = mirrorFill(P.rgb, known, toBackground, w, h, pushPullFill(P.rgb, known, w, h));
      for (let p = 0; p < n; p += 1) {
        if (toBackground[p]) for (let c = 0; c < 3; c += 1) out[p * 3 + c] = filled[p * 3 + c];
      }
    }
  }

  // Put the garment on, in its own shape, over the photo (where it covers less than the person's own clothes,
  // theirs still show), back to front: lower garments, torso and drape, then the arms back in front of them,
  // sleeves, and hands, face and hair on top of everything
  const coverage = new Float32Array(n);
  const draw = (kind: PartKind, xf: ReturnType<typeof similarity> | null) => {
    const gPart = gParts.find((p) => p.kind === kind);
    if (!gPart || !xf) return;
    report.placed.push(kind);
    drawPlaced(out, w, h, albedoImage, gPart.mask, softMasks.get(kind)!, xf, garmentShade, coverage);
  };
  const lowerTransform = (kind: PartKind) => {
    const gPart = gParts.find((p) => p.kind === kind);
    if (!gPart) return null;
    // A dress or jumpsuit goes where its top goes, so its halves stay joined at the waist
    const torsoFamily = gParts.find((p) => p.kind === "torso")?.family;
    const placed =
      (gPart.family === "dress" || gPart.family === "jumpsuit") && torsoFamily === gPart.family && torsoTransform
        ? torsoTransform
        : overlayTransform(kind, gShapes.get(kind)!, gBody, body, scaleLower);
    return placed ? withHemAtSameHeight(placed, gPart.mask) : null;
  };
  // When the garment photo shows it worn, a skirt's or pants' length follows the legs, not the shoulders: the
  // hem is stretched (or shrunk) down the body so it falls the same fraction of the way from hips to ankles on
  // the person as on the wearer (a floor-length saree stays floor-length on a taller person). Ankles hidden by
  // clothes are taken to be where the person's figure ends.
  const personAnkleLevel = ankleLevel(body, person.human, w, h);
  const withHemAtSameHeight = (xf: ReturnType<typeof similarity>, mask: Uint8Array) => {
    if (!gBody?.hips || !body.hips || personAnkleLevel === null) return xf;
    const gAnkle = ankleLevel(gBody, garment.human, gw, gh);
    if (gAnkle === null) return xf;
    const gDown = gBody.down;
    const gHip = dot(mid(gBody.hips.left, gBody.hips.right), gDown);
    let gHem = -Infinity;
    let hemPoint: Vec | null = null;
    for (let p = 0; p < mask.length; p += 1) {
      if (!mask[p]) continue;
      const x = p % gw;
      const point = { x, y: (p - x) / gw };
      const t = dot(point, gDown);
      if (t > gHem) {
        gHem = t;
        hemPoint = point;
      }
    }
    if (!hemPoint || gAnkle - gHip < 1) return xf;
    const fraction = (gHem - gHip) / (gAnkle - gHip);
    const pHip = dot(mid(body.hips.left, body.hips.right), body.down);
    const target = pHip + fraction * (personAnkleLevel - pHip);
    const placedHem = dot(xf.forward(hemPoint), body.down);
    if (placedHem - pHip < 1) return xf;
    // Stretch only below the hips, along the body
    const stretch = Math.min(1.6, Math.max(0.8, (target - pHip) / (placedHem - pHip)));
    report.notes.push(`hem: ${Math.round((fraction * 100))}% of the way from hips to ankles, length x${stretch.toFixed(2)}`);
    const along = (p: Vec) => dot(p, body.down) - pHip;
    return {
      forward: (p: Vec) => {
        const q = xf.forward(p);
        const t = along(q);
        return t > 0 ? add(q, scaleVec(body.down, t * (stretch - 1))) : q;
      },
      inverse: (p: Vec) => {
        const t = along(p);
        return xf.inverse(t > 0 ? add(p, scaleVec(body.down, t * (1 / stretch - 1))) : p);
      },
    };
  };
  // A sleeve stays attached where it was sewn on, carried along with the torso, and is turned partway from its
  // angle in the garment photo toward the upper arm, hinged (like a real sleeve) at the top of its seam, the
  // shoulder: it stays joined there, and its underarm side tucks against the body
  const sleeveTransform = (kind: "sleeveLeft" | "sleeveRight") => {
    const gShape = gShapes.get(kind);
    const gSleeve = gParts.find((p) => p.kind === kind);
    if (!gShape || !gSleeve) return null;
    const arm = kind === "sleeveLeft" ? body.arms.left : body.arms.right;
    const armDirection = unit(arm.elbow ? sub(arm.elbow, arm.shoulder) : body.down);
    if (!torsoTransform) return similarity(gShape.origin, gShape.axis, arm.shoulder, armDirection, scaleUpper);
    const hinge = seamTop(gSleeve.mask, gTorso, gw) ?? gShape.origin;
    const placedHinge = torsoTransform.forward(hinge);
    const placedDirection = unit(sub(torsoTransform.forward(add(hinge, gShape.axis)), placedHinge));
    const direction = unit(
      add(scaleVec(placedDirection, 1 - SLEEVE_TOWARD_ARM), scaleVec(armDirection, SLEEVE_TOWARD_ARM)),
    );
    return similarity(hinge, gShape.axis, placedHinge, direction, scaleUpper);
  };
  const restore = (test: (p: number) => boolean) => {
    for (let p = 0; p < n; p += 1) if (test(p)) for (let c = 0; c < 3; c += 1) out[p * 3 + c] = P.rgb[p * 3 + c];
  };
  draw("legs", lowerTransform("legs"));
  draw("skirt", lowerTransform("skirt"));
  draw("torso", torsoTransform);
  draw("drape", gParts.some((p) => p.kind === "drape") ? torsoTransform ?? overlayTransform("drape", gShapes.get("drape")!, gBody, body, scaleUpper) : null);
  // The person's own arms stay as they are: their visible skin goes back over the garment (the arms, and any
  // skin beside the torso above the hips, where an arm thicker than its estimate still is). Only the
  // garment's sleeves go over the arms; legs stay under a skirt.
  const hipLevel = body.hips
    ? dot(mid(body.hips.left, body.hips.right), body.down)
    : dot(mid(body.shoulders.left, body.shoulders.right), body.down) + sw * 1.3;
  restore((p) => {
    if (person.human[p] !== HUMAN_BODY_SKIN) return false;
    if (zones.inArm[p]) return true;
    const x = p % w;
    const y = (p - x) / w;
    return zones.area[p] === 0 && dot({ x, y }, body.down) < hipLevel;
  });
  draw("sleeveLeft", sleeveTransform("sleeveLeft"));
  draw("sleeveRight", sleeveTransform("sleeveRight"));
  // The garment's soft shadow on the person just beyond its edges
  const reach = Math.max(1, Math.round(sw * CONTACT_SHADOW_REACH));
  const nearGarment = boxSum(coverage, w, h, reach);
  const reachArea = (2 * reach + 1) * (2 * reach + 1);
  for (let p = 0; p < n; p += 1) {
    if (coverage[p] >= 0.99 || person.human[p] === HUMAN_BACKGROUND) continue;
    const darken = 1 - CONTACT_SHADOW * Math.min(1, (nearGarment[p] / reachArea) * 2) * (1 - coverage[p]);
    for (let c = 0; c < 3; c += 1) out[p * 3 + c] *= darken;
  }
  const handR = sw * 0.12;
  restore((p) => {
    const hc = person.human[p];
    if (hc === HUMAN_FACE_SKIN || hc === HUMAN_HAIR) return true;
    if (hc !== HUMAN_BODY_SKIN) return false;
    const x = p % w;
    const y = (p - x) / w;
    return body.hands.some((hand) => Math.hypot(hand.x - x, hand.y - y) <= handR);
  });

  const data = new Uint8ClampedArray(person.image.data);
  for (let p = 0; p < n; p += 1) {
    for (let c = 0; c < 3; c += 1) data[p * 4 + c] = linearToByte(out[p * 3 + c]);
  }
  return { image: { data, width: w, height: h }, report };
}

// Draws a garment part placed by transform xf (garment photo -> person photo)
// (soft: its feathered alpha in the garment photo; coverage collects how much garment covers each pixel)
function drawPlaced(
  out: Float32Array,
  w: number,
  h: number,
  garment: LinearImage,
  mask: Uint8Array,
  soft: Float32Array,
  xf: { forward: (p: Vec) => Vec; inverse: (p: Vec) => Vec },
  shade: Float32Array,
  coverage: Float32Array,
) {
  const gw = garment.width;
  const gh = garment.height;
  // Bounding box of the garment part, mapped into the photo
  const corners = maskCorners(mask, gw, gh).map((c) => xf.forward(c));
  const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...corners.map((c) => c.x))));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...corners.map((c) => c.y))));
  const tmp = new Float32Array(3);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const g = xf.inverse({ x, y });
      const a = sample1(soft, gw, gh, g.x, g.y);
      if (a <= 0.02) continue;
      const p = y * w + x;
      sampleRGB(garment, g.x, g.y, tmp);
      for (let c = 0; c < 3; c += 1) out[p * 3 + c] = (1 - a) * out[p * 3 + c] + a * tmp[c] * shade[p];
      coverage[p] = Math.max(coverage[p], a);
    }
  }
}

// The mask shrunk by a pixel (a pixel stays if it and its four neighbours are all on the mask); a part too
// thin to survive keeps its original mask
function erodeMask(mask: Uint8Array, w: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  let kept = 0;
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    const x = p % w;
    if (x > 0 && x < w - 1 && p >= w && p + w < mask.length && mask[p - 1] && mask[p + 1] && mask[p - w] && mask[p + w]) {
      out[p] = 1;
      kept += 1;
    }
  }
  return kept > 20 ? out : mask;
}

function maskCorners(mask: Uint8Array, w: number, h: number): Vec[] {
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
  ];
}

// A similarity transform (scale, rotation, translation) taking garment-photo point a to person point b,
// garment direction da to person direction db, scaled by k
function similarity(a: Vec, da: Vec, b: Vec, db: Vec, k: number) {
  const angle = Math.atan2(db.y, db.x) - Math.atan2(da.y, da.x);
  const cos = Math.cos(angle) * k;
  const sin = Math.sin(angle) * k;
  const forward = (p: Vec): Vec => {
    const x = p.x - a.x;
    const y = p.y - a.y;
    return { x: b.x + cos * x - sin * y, y: b.y + sin * x + cos * y };
  };
  const det = cos * cos + sin * sin;
  const inverse = (p: Vec): Vec => {
    const x = p.x - b.x;
    const y = p.y - b.y;
    return { x: a.x + (cos * x + sin * y) / det, y: a.y + (-sin * x + cos * y) / det };
  };
  return { forward, inverse };
}

// Where an unmatched garment part goes on the person. With a pose in the garment photo too, pose maps to
// pose; otherwise the garment's own geometry stands in: the top of a torso spans the shoulders, the top of
// a skirt or legs sits at the waist, a sleeve hangs from its shoulder along the upper arm.
function overlayTransform(
  kind: PartKind,
  gShape: Shape,
  gBody: Body | null,
  body: Body,
  k: number,
) {
  const sw = body.shoulderWidth;
  const sMid = mid(body.shoulders.left, body.shoulders.right);
  const across = unit(sub(body.shoulders.right, body.shoulders.left));
  const hipMid = body.hips ? mid(body.hips.left, body.hips.right) : add(sMid, scaleVec(body.down, sw * 1.3));
  // Where a waistband sits: a little above the hip joints
  const waist = add(hipMid, scaleVec(sub(sMid, hipMid), 0.22));

  // The garment part's anchor: its top edge, centred on the shoulder span (torso, drape) or the waistband
  // (skirt, legs). The very top row can be off-centre: one strap of a tank top reaches higher than the other.
  const topIndex = Math.max(0, gShape.rows.findIndex((r) => r.length));
  const topU = isUpper(kind) ? spanCentre(gShape, 0.05, 0.3) : spanCentre(gShape, 0, 0.08);
  const topT = gShape.tMin + topIndex;
  const gTop = {
    x: gShape.origin.x + topT * gShape.axis.x + topU * gShape.perp.x,
    y: gShape.origin.y + topT * gShape.axis.y + topU * gShape.perp.y,
  };
  const right = { x: 1, y: 0 };

  if (gBody) {
    const gsMid = mid(gBody.shoulders.left, gBody.shoulders.right);
    if (kind === "sleeveLeft" || kind === "sleeveRight") {
      const gArm = kind === "sleeveLeft" ? gBody.arms.left : gBody.arms.right;
      const arm = kind === "sleeveLeft" ? body.arms.left : body.arms.right;
      if (gArm.elbow && arm.elbow) {
        return similarity(gArm.shoulder, sub(gArm.elbow, gArm.shoulder), arm.shoulder, sub(arm.elbow, arm.shoulder), k);
      }
    }
    if ((kind === "skirt" || kind === "legs") && gBody.hips && body.hips) {
      const gHip = mid(gBody.hips.left, gBody.hips.right);
      return similarity(gHip, sub(gBody.hips.right, gBody.hips.left), hipMid, sub(body.hips.right, body.hips.left), k);
    }
    return similarity(gsMid, sub(gBody.shoulders.right, gBody.shoulders.left), sMid, across, k);
  }

  if (kind === "torso" || kind === "drape") {
    // The garment's top edge is the top of the shoulders, a little above the joints
    const shoulderTop = add(sMid, scaleVec(body.down, -sw * 0.13));
    return similarity(gTop, right, shoulderTop, across, k);
  }
  if (kind === "skirt" || kind === "legs") {
    return similarity(gTop, right, waist, across, k);
  }
  return null;
}
