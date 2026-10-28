// The piece of fabric under a point on a picture, for pasting a fabric onto just that piece (a dress's body, a
// skirt, a top) instead of the whole picture. Found by the clothing model (garmentSegmenter: what each pixel is
// part of); where it sees no clothing there (jewellery, a plain object), by colour: the area around the point
// of about the same colour.

import { parseFashionClasses } from "./garmentSegmenter";

export type FabricRegion = {
  // White where the fabric is, transparent elsewhere (drawn over the whole picture, stretched to its size)
  maskSrc: string;
  // Its bounds, in the picture's own pixels
  area: { x: number; y: number; width: number; height: number };
};

// The picture is worked on at most this many pixels on its long side (the mask is stretched back over it)
const WORK_SIDE = 512;
// Alpha (0-255) above which a pixel is part of the picture (not its transparent background)
const SOLID_ALPHA = 24;
// Colour fallback: how far (RGB distance, 0-441) a pixel may be from the colour at the point and still count
const COLOUR_TOLERANCE = 60;
// Smaller than this share of the picture: not a piece of fabric, nothing found
const MIN_SHARE = 0.003;

// Upper-body garments (shirt, top, sweater, cardigan, jacket, vest, coat, dress, jumpsuit, cape) and their
// sleeves are one fabric piece; garment details (collar, neckline, pocket, ruffle ...) are part of whatever
// they're on
const UPPER = new Set([1, 2, 3, 4, 5, 6, 10, 11, 12, 13]);
const SLEEVE = 32;
const DETAILS = new Set([28, 29, 30, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]);
const GARMENTS = new Set([...UPPER, SLEEVE, 7, 8, 9, 26]);

/** The fabric piece at (x, y) (in the picture's own pixels, the picture `width` x `height`), or null if
 * there's nothing there to go by. */
export async function fabricRegionAt(
  img: HTMLImageElement,
  width: number,
  height: number,
  x: number,
  y: number,
): Promise<FabricRegion | null> {
  const fit = Math.min(1, WORK_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * fit));
  const h = Math.max(1, Math.round(height * fit));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const px = Math.max(0, Math.min(w - 1, Math.round(x * fit)));
  const py = Math.max(0, Math.min(h - 1, Math.round(y * fit)));
  const start = py * w + px;
  if (pixels[start * 4 + 3] <= SOLID_ALPHA) return null;

  let region: Uint8Array | null = null;
  try {
    // (The model wants an opaque picture: transparent parts on white, as the Source window's are)
    const opaque = document.createElement("canvas");
    opaque.width = w;
    opaque.height = h;
    const octx = opaque.getContext("2d");
    if (octx) {
      octx.fillStyle = "#fff";
      octx.fillRect(0, 0, w, h);
      octx.drawImage(canvas, 0, 0);
      const classes = await parseFashionClasses(opaque);
      const clicked = classes[start];
      if (GARMENTS.has(clicked)) {
        const piece = new Set<number>([clicked, ...DETAILS]);
        if (UPPER.has(clicked)) piece.add(SLEEVE);
        if (clicked === SLEEVE) UPPER.forEach((cls) => piece.add(cls));
        region = grow(w, h, start, (i) => pixels[i * 4 + 3] > SOLID_ALPHA && piece.has(classes[i]));
      }
    }
  } catch (err) {
    console.warn("[Replace fabric] the clothing model couldn't look; going by colour", err);
  }

  if (!region || count(region) < w * h * MIN_SHARE) {
    // By colour: the area joined to the point, about its colour (smoothed a little, so a weave's fine
    // light and dark threads don't break it up)
    const smooth = blur(pixels, w, h);
    const [r0, g0, b0] = [smooth[start * 3], smooth[start * 3 + 1], smooth[start * 3 + 2]];
    const limit = COLOUR_TOLERANCE * COLOUR_TOLERANCE;
    region = grow(w, h, start, (i) => {
      if (pixels[i * 4 + 3] <= SOLID_ALPHA) return false;
      const dr = smooth[i * 3] - r0;
      const dg = smooth[i * 3 + 1] - g0;
      const db = smooth[i * 3 + 2] - b0;
      return dr * dr + dg * dg + db * db <= limit;
    });
  }
  if (count(region) < w * h * MIN_SHARE) return null;

  // Small gaps closed (a print's dots, a shadow line), and the edge kept to the picture
  region = close(region, w, h, 2);
  for (let i = 0; i < w * h; i++) if (pixels[i * 4 + 3] <= SOLID_ALPHA) region[i] = 0;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const mask = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (!region[i]) continue;
    const rx = i % w;
    const ry = (i - rx) / w;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
    mask.data[i * 4] = 255;
    mask.data[i * 4 + 1] = 255;
    mask.data[i * 4 + 2] = 255;
    mask.data[i * 4 + 3] = 255;
  }
  if (maxX < 0) return null;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")?.putImageData(mask, 0, 0);
  return {
    maskSrc: out.toDataURL("image/png"),
    area: {
      x: minX / fit,
      y: minY / fit,
      width: (maxX - minX + 1) / fit,
      height: (maxY - minY + 1) / fit,
    },
  };
}

// The pixels joined to `start` (side by side) that pass `keep`
function grow(w: number, h: number, start: number, keep: (i: number) => boolean): Uint8Array {
  const region = new Uint8Array(w * h);
  if (!keep(start)) return region;
  region[start] = 1;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of next) {
      if (n >= 0 && !region[n] && keep(n)) {
        region[n] = 1;
        stack.push(n);
      }
    }
  }
  return region;
}

function count(region: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < region.length; i++) n += region[i];
  return n;
}

// Grown then shrunk by `r` pixels: gaps narrower than that filled in, the outline otherwise as it was
function close(region: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const grownBy = (src: Uint8Array, value: number) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let hit = false;
        for (let dy = -r; dy <= r && !hit; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < w && src[yy * w + xx] === value) {
              hit = true;
              break;
            }
          }
        }
        out[y * w + x] = value === 1 ? (hit ? 1 : 0) : hit ? 0 : 1;
      }
    }
    return out;
  };
  return grownBy(grownBy(region, 1), 0);
}

// The picture's colours averaged over a 5 x 5 neighbourhood (RGB, 3 per pixel)
function blur(pixels: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  const R = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -R; dx <= R; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const j = (yy * w + xx) * 4;
          r += pixels[j];
          g += pixels[j + 1];
          b += pixels[j + 2];
          n++;
        }
      }
      out[(y * w + x) * 3] = r / n;
      out[(y * w + x) * 3 + 1] = g / n;
      out[(y * w + x) * 3 + 2] = b / n;
    }
  }
  return out;
}
