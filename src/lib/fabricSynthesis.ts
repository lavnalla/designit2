// Grows a fabric swatch to any size while keeping its look: the same weave, print and scale, no stretching and
// no visible tiling. Image quilting (Efros & Freeman): the output is laid with square patches cut from the
// swatch, each overlapping its neighbours above and to the left; each patch is picked (among random cuts of
// the swatch) to match what's already there in the overlap, and joined along the seam where the two differ
// least, so no straight edges or grid show.

type RGBA = { data: Uint8ClampedArray; width: number; height: number };

// Which swatch pixels aren't fabric: see-through ones (around a garment cut out of its photo), and the pure
// white background a garment is shown on, where it runs in from the swatch's edge (white fabric, a little off
// pure white in a photo or enclosed by the print, stays fabric)
function backgroundOf(src: RGBA): Uint8Array {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const background = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (data[p * 4 + 3] < 250) background[p] = 1;
  const pureWhite = (p: number) => data[p * 4] >= 245 && data[p * 4 + 1] >= 245 && data[p * 4 + 2] >= 245;
  const queue: number[] = [];
  const visit = (p: number) => {
    if (background[p] || !pureWhite(p)) return;
    background[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < w; x += 1) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (queue.length) {
    const p = queue.pop()!;
    const x = p % w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < n - w) visit(p + w);
  }
  // And the garment's outermost few pixels beside it (its edge, blended with the background)
  let edge = background;
  for (let i = 0; i < EDGE_FRINGE; i += 1) {
    const grown = edge.slice();
    for (let p = 0; p < n; p += 1) {
      if (edge[p]) continue;
      const x = p % w;
      if ((x > 0 && edge[p - 1]) || (x < w - 1 && edge[p + 1]) || (p >= w && edge[p - w]) || (p < n - w && edge[p + w])) grown[p] = 1;
    }
    edge = grown;
  }
  return edge;
}

// A repeatable pseudo-random generator (mulberry32), so the same paste gives the same fabric
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// At most about this many cuts of the swatch are tried for each patch
const MAX_SEARCH = 6000;
// Patches are made smaller until at least this many cuts of the swatch are all fabric
const MIN_CUTS = 12;
// How much of the light's variation across the swatch is taken out (1: all of it)
const LIGHT_EVENING = 0.85;
// How many pixels in from a garment's edge with its background still count as background
const EDGE_FRINGE = 3;
// The smallest piece of fabric worth copying (pixels across)
const MIN_SWATCH = 24;
// How far (in brightness, 0-255) a thin line must stand out from both sides of it to count as a seam
const SEAM_CONTRAST = 14;
// How much worse a cut of the swatch counts for each time it (or one near it) has been used, so the same
// piece doesn't keep repeating
const REUSE_PENALTY = 0.6;
// A patch is picked at random among the candidates matching within this much of the best (some variety, so
// the same cut doesn't repeat)
const MATCH_TOLERANCE = 1.15;

// The swatch with its light evened out: light falling off across the garment it was copied from (one side
// brighter or paler than the other) taken out, keeping the fabric's own colour and pattern. Each colour of each
// pixel is set against its average over a wide area around it (far wider than a print's motifs, so big flowers
// aren't washed out), brought partway to the swatch's overall average. (Background pixels don't count.)
function evenLight(src: RGBA, background: Uint8Array): Uint8ClampedArray {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const weight = new Float64Array(n);
  let count = 0;
  for (let p = 0; p < n; p += 1) {
    if (background[p]) continue;
    weight[p] = 1;
    count += 1;
  }
  const out = new Uint8ClampedArray(data);
  if (count < n * 0.2) return out;
  // Box averages from running sums
  const radius = Math.max(4, Math.round(Math.max(w, h) / 4));
  const sumOf = (values: Float64Array) => {
    const sums = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y += 1) {
      let row = 0;
      for (let x = 0; x < w; x += 1) {
        row += values[y * w + x];
        sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
      }
    }
    return sums;
  };
  const box = (sums: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0];
  const weightSums = sumOf(weight);
  for (let c = 0; c < 3; c += 1) {
    const channel = new Float64Array(n);
    let total = 0;
    for (let p = 0; p < n; p += 1) {
      if (!weight[p]) continue;
      channel[p] = data[p * 4 + c];
      total += channel[p];
    }
    const mean = total / count;
    const sums = sumOf(channel);
    for (let y = 0; y < h; y += 1) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h, y + radius + 1);
      for (let x = 0; x < w; x += 1) {
        const p = y * w + x;
        if (!weight[p]) continue;
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(w, x + radius + 1);
        const around = box(sums, x0, y0, x1, y1) / Math.max(1, box(weightSums, x0, y0, x1, y1));
        const gain = Math.min(1.5, Math.max(0.7, Math.pow(mean / Math.max(1, around), LIGHT_EVENING)));
        out[p * 4 + c] = data[p * 4 + c] * gain;
      }
    }
  }
  return out;
}

export function synthesizeFabric(src: RGBA, outW: number, outH: number, seed = 1): RGBA {
  const { width: sw, height: sh } = src;
  const notFabric = backgroundOf(src);
  const s = evenLight(src, notFabric);
  const out = new Uint8ClampedArray(outW * outH * 4);

  // (Summed over the rectangle from the corner, so any box's count is four lookups)
  const sums = new Int32Array((sw + 1) * (sh + 1));
  for (let y = 0; y < sh; y += 1) {
    let row = 0;
    for (let x = 0; x < sw; x += 1) {
      row += notFabric[y * sw + x];
      sums[(y + 1) * (sw + 1) + x + 1] = sums[y * (sw + 1) + x + 1] + row;
    }
  }
  const allFabric = (x: number, y: number, bw: number, bh: number) =>
    sums[(y + bh) * (sw + 1) + x + bw] - sums[y * (sw + 1) + x + bw] - sums[(y + bh) * (sw + 1) + x] + sums[y * (sw + 1) + x] === 0;

  // Big enough already (and all fabric there): the middle of the swatch, as it is
  const cropX = Math.floor((sw - outW) / 2);
  const cropY = Math.floor((sh - outH) / 2);
  if (sw >= outW && sh >= outH && allFabric(cropX, cropY, outW, outH)) {
    for (let y = 0; y < outH; y += 1) {
      const from = ((cropY + y) * sw + cropX) * 4;
      out.set(s.subarray(from, from + outW * 4), y * outW * 4);
    }
    return { data: out, width: outW, height: outH };
  }

  // Patches big enough to hold the print's motifs whole (about half the swatch), overlapping by a fifth, and
  // the cuts of the swatch they can come from: all fabric (on a coarser grid for a large swatch, so the search
  // stays quick). Where the fabric is too narrow for that many whole patches, the patches are made smaller.
  const cutsFor = (size: number) => {
    const maxX = sw - size;
    const maxY = sh - size;
    const stride = Math.max(1, Math.ceil(Math.sqrt(((maxX + 1) * (maxY + 1)) / MAX_SEARCH)));
    const found: Array<{ x: number; y: number }> = [];
    for (let y = 0; y <= maxY; y += stride) for (let x = 0; x <= maxX; x += stride) if (allFabric(x, y, size, size)) found.push({ x, y });
    return found;
  };
  let block = Math.max(2, Math.min(sw, sh, Math.max(16, Math.min(160, Math.round(Math.min(sw, sh) * 0.5)))));
  let cuts = cutsFor(block);
  while (cuts.length < MIN_CUTS && block > 8) {
    block = Math.max(8, Math.round(block * 0.8));
    cuts = cutsFor(block);
  }
  if (!cuts.length) {
    // (No fabric anywhere big enough: use the swatch as it is)
    notFabric.fill(0);
    sums.fill(0);
    cuts = cutsFor(block);
  }
  const overlap = Math.max(1, Math.min(block - 1, Math.round(block / 5)));
  const step = block - overlap;
  const rand = random(seed);
  // How often each part of the swatch has been used (by cells half a patch across)
  const cell = Math.max(1, Math.round(block / 2));
  const cellsAcross = Math.ceil(sw / cell) + 1;
  const used = new Float64Array(cellsAcross * (Math.ceil(sh / cell) + 1));
  const usedAt = (x: number, y: number) => Math.floor(y / cell) * cellsAcross + Math.floor(x / cell);

  // Squared colour difference between a swatch pixel and an output pixel
  const diff = (si: number, oi: number) => {
    const dr = s[si] - out[oi];
    const dg = s[si + 1] - out[oi + 1];
    const db = s[si + 2] - out[oi + 2];
    return dr * dr + dg * dg + db * db;
  };

  for (let py = 0; py < outH; py += step) {
    for (let px = 0; px < outW; px += step) {
      const bw = Math.min(block, outW - px);
      const bh = Math.min(block, outH - py);
      const left = px > 0 ? Math.min(overlap, bw) : 0;
      const top = py > 0 ? Math.min(overlap, bh) : 0;

      // Pick the cut: how well it matches the output in the overlap (sampled every other pixel), over every
      // cut of the swatch (so a regular print's motifs line up across the seam), each abandoned as soon as it
      // can no longer be among the best
      const first = cuts[Math.floor(rand() * cuts.length)];
      let sx = first.x;
      let sy = first.y;
      if (left || top) {
        const errorOf = (cx: number, cy: number, limit: number) => {
          let e = 0;
          for (let y = 0; y < bh; y += 2) {
            // (Below the top overlap only the left one counts)
            const end = y < top ? bw : left;
            for (let x = 0; x < end; x += 2) {
              e += diff(((cy + y) * sw + cx + x) * 4, ((py + y) * outW + px + x) * 4);
            }
            if (e > limit) return Infinity;
          }
          return e;
        };
        const tried: Array<{ x: number; y: number; e: number }> = [];
        let best = Infinity;
        const tryCut = (cx: number, cy: number) => {
          const penalty = 1 + REUSE_PENALTY * used[usedAt(cx, cy)];
          const e = errorOf(cx, cy, (best * MATCH_TOLERANCE + 1) / penalty);
          if (e === Infinity) return;
          const scored = e * penalty;
          tried.push({ x: cx, y: cy, e: scored });
          best = Math.min(best, scored);
        };
        for (const cut of cuts) tryCut(cut.x, cut.y);
        const good = tried.filter((t) => t.e <= best * MATCH_TOLERANCE + 1);
        const pick = good[Math.floor(rand() * good.length)];
        sx = pick.x;
        sy = pick.y;
      }
      used[usedAt(sx, sy)] += 1;

      // The seams: down the left overlap and across the top one, each where the patch and the output differ
      // least (the cheapest path, found row by row / column by column)
      const errAt = (x: number, y: number) => diff(((sy + y) * sw + sx + x) * 4, ((py + y) * outW + px + x) * 4);
      const seamX = new Int32Array(bh); // per row: patch pixels from this x on
      const seamY = new Int32Array(bw); // per column: patch pixels from this y on
      if (left) {
        const cost = new Float64Array(bh * left);
        for (let y = 0; y < bh; y += 1) {
          for (let x = 0; x < left; x += 1) {
            let prev = 0;
            if (y > 0) {
              prev = cost[(y - 1) * left + x];
              if (x > 0) prev = Math.min(prev, cost[(y - 1) * left + x - 1]);
              if (x < left - 1) prev = Math.min(prev, cost[(y - 1) * left + x + 1]);
            }
            cost[y * left + x] = errAt(x, y) + prev;
          }
        }
        let x = 0;
        for (let i = 1; i < left; i += 1) if (cost[(bh - 1) * left + i] < cost[(bh - 1) * left + x]) x = i;
        for (let y = bh - 1; y >= 0; y -= 1) {
          seamX[y] = x;
          if (y > 0) {
            let next = x;
            for (const c of [x - 1, x + 1]) {
              if (c >= 0 && c < left && cost[(y - 1) * left + c] < cost[(y - 1) * left + next]) next = c;
            }
            x = next;
          }
        }
      }
      if (top) {
        const cost = new Float64Array(bw * top);
        for (let x = 0; x < bw; x += 1) {
          for (let y = 0; y < top; y += 1) {
            let prev = 0;
            if (x > 0) {
              prev = cost[(x - 1) * top + y];
              if (y > 0) prev = Math.min(prev, cost[(x - 1) * top + y - 1]);
              if (y < top - 1) prev = Math.min(prev, cost[(x - 1) * top + y + 1]);
            }
            cost[x * top + y] = errAt(x, y) + prev;
          }
        }
        let y = 0;
        for (let i = 1; i < top; i += 1) if (cost[(bw - 1) * top + i] < cost[(bw - 1) * top + y]) y = i;
        for (let x = bw - 1; x >= 0; x -= 1) {
          seamY[x] = y;
          if (x > 0) {
            let next = y;
            for (const c of [y - 1, y + 1]) {
              if (c >= 0 && c < top && cost[(x - 1) * top + c] < cost[(x - 1) * top + next]) next = c;
            }
            y = next;
          }
        }
      }

      // Lay the patch: past both seams
      for (let y = 0; y < bh; y += 1) {
        for (let x = 0; x < bw; x += 1) {
          if (left && x < seamX[y]) continue;
          if (top && y < seamY[x]) continue;
          const si = ((sy + y) * sw + sx + x) * 4;
          const oi = ((py + y) * outW + px + x) * 4;
          out[oi] = s[si];
          out[oi + 1] = s[si + 1];
          out[oi + 2] = s[si + 2];
          out[oi + 3] = s[si + 3];
        }
      }
    }
  }
  return { data: out, width: outW, height: outH };
}

// The swatch image grown (or cropped) to width x height pixels, as a PNG data URL
export function synthesizeFabricImage(img: HTMLImageElement, width: number, height: number, seed = 1): string | null {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh || width < 1 || height < 1) return null;
  const read = document.createElement("canvas");
  read.width = sw;
  read.height = sh;
  const readCtx = read.getContext("2d", { willReadFrequently: true });
  if (!readCtx) return null;
  readCtx.drawImage(img, 0, 0);
  const source = readCtx.getImageData(0, 0, sw, sh);
  const grown = synthesizeFabric(source, width, height, seed);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(grown.data);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// The cleanest piece of fabric in a garment's image, for copying its fabric with one click: the biggest
// square that's all fabric (inside the garment's outline, if it has one, and away from any background), placed
// where the garment shows the least seams, folds and edges (the least change in brightness across it beyond
// what the print itself has everywhere). Returns a PNG data URL of that square, at the image's own pixels, or
// null if no usable piece is found.
// outline: an SVG path of the garment's outline, in units where the image is width wide. garment: which pixels
// are the garment (from a garment parse of the image, at any size), for a photo with more than the garment in it.
export function pickFabricSwatch(
  img: HTMLImageElement,
  options: {
    outline?: { path: string; width: number };
    garment?: { mask: Uint8Array; width: number; height: number };
  } = {},
): string | null {
  const { outline, garment } = options;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // Only the garment: outside its outline is left see-through
  if (outline) {
    const k = w / outline.width;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clip(new Path2D(outline.path));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  // And only where the parse saw garment (the person, the room around them aren't fabric)
  if (garment) {
    for (let y = 0; y < h; y += 1) {
      const gy = Math.min(garment.height - 1, Math.floor((y * garment.height) / h));
      for (let x = 0; x < w; x += 1) {
        const gx = Math.min(garment.width - 1, Math.floor((x * garment.width) / w));
        if (!garment.mask[gy * garment.width + gx]) image.data[(y * w + x) * 4 + 3] = 0;
      }
    }
  }
  const square = cleanestSquare(image);
  if (!square) return null;
  const out = document.createElement("canvas");
  out.width = square.size;
  out.height = square.size;
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  outCtx.putImageData(image, -square.x, -square.y, square.x, square.y, square.size, square.size);
  return out.toDataURL("image/png");
}

// The square for pickFabricSwatch (see there)
export function cleanestSquare(src: RGBA): { x: number; y: number; size: number } | null {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const background = backgroundOf(src);
  const sumOf = (values: ArrayLike<number>) => {
    const sums = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y += 1) {
      let row = 0;
      for (let x = 0; x < w; x += 1) {
        row += values[y * w + x];
        sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
      }
    }
    return sums;
  };
  const box = (sums: Float64Array, x: number, y: number, size: number) =>
    sums[(y + size) * (w + 1) + x + size] - sums[y * (w + 1) + x + size] - sums[(y + size) * (w + 1) + x] + sums[y * (w + 1) + x];
  const backgroundSums = sumOf(background);
  const stride = (size: number) => Math.max(1, Math.round(size / 10));
  const fits = (size: number) => {
    for (let y = 0; y + size <= h; y += stride(size)) for (let x = 0; x + size <= w; x += stride(size)) if (!box(backgroundSums, x, y, size)) return true;
    return false;
  };
  // The biggest square that fits in the fabric
  let lo = 0;
  let hi = Math.min(w, h);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  if (lo < MIN_SWATCH) return null;
  const lum = new Float64Array(n);
  for (let p = 0; p < n; p += 1) lum[p] = 0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];
  // How much the brightness changes at each pixel, over a short distance (folds and edges change more than
  // the print does)
  const change = new Float64Array(n);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const p = y * w + x;
      change[p] = Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + w] - lum[p - w]);
    }
  }
  const changeSums = sumOf(change);
  // Seams: thin lines (a pixel set apart from both sides of it) running on unbroken for a while. A print's
  // motifs, even in rows or columns, have gaps between them; a seam doesn't.
  const run = Math.max(8, Math.round(lo / 6));
  const seam = new Uint8Array(n);
  const markLines = (across: number, along: number, length: number, count: number) => {
    // across/along: pixel steps across the line and along it; length/count: lines' length and how many
    const contrast = new Float64Array(n);
    for (let p = 0; p < n; p += 1) {
      const a1 = p - 2 * across;
      const a2 = p + 2 * across;
      if (a1 < 0 || a2 >= n) continue;
      contrast[p] = Math.abs(2 * lum[p] - lum[a1] - lum[a2]);
    }
    for (let line = 0; line < count; line += 1) {
      const start = line * across;
      // The weakest contrast over each stretch of run pixels along the line: high only if unbroken
      for (let i = 0; i + run <= length; i += 1) {
        let weakest = Infinity;
        for (let j = 0; j < run && weakest > SEAM_CONTRAST; j += 1) weakest = Math.min(weakest, contrast[start + (i + j) * along]);
        if (weakest > SEAM_CONTRAST) for (let j = 0; j < run; j += 1) seam[start + (i + j) * along] = 1;
      }
    }
  };
  markLines(1, w, h, w); // up and down
  markLines(w, 1, w, h); // across
  const seamSums = sumOf(seam);

  // The biggest square clear of seams (down to half the biggest that fits), placed where the fabric changes
  // least; with seams everywhere, the one with the fewest
  let best: { x: number; y: number; size: number } | null = null;
  const centreX = w / 2;
  const centreY = h / 2;
  const placeOf = (size: number, maxSeams: number) => {
    let found: { x: number; y: number; size: number } | null = null;
    let foundScore = Infinity;
    for (let y = 0; y + size <= h; y += stride(size)) {
      for (let x = 0; x + size <= w; x += stride(size)) {
        if (box(backgroundSums, x, y, size)) continue;
        const seams = box(seamSums, x, y, size);
        if (seams > maxSeams) continue;
        // (Ties go to the middle of the garment, its flattest part)
        const offCentre = Math.hypot(x + size / 2 - centreX, y + size / 2 - centreY) / Math.hypot(w, h);
        const score = (seams + 1) * (box(changeSums, x, y, size) / (size * size)) * (1 + 0.2 * offCentre);
        if (score < foundScore) {
          foundScore = score;
          found = { x, y, size };
        }
      }
    }
    return found;
  };
  for (let size = lo; size >= Math.max(MIN_SWATCH, lo / 2) && !best; size = Math.floor(size * 0.9)) {
    best = placeOf(size, size * size * 0.002);
    if (size === MIN_SWATCH) break;
  }
  if (!best) best = placeOf(Math.max(MIN_SWATCH, Math.round(lo * 0.85)), Infinity);
  return best;
}
