// Grows a fabric swatch to any size while keeping its look: the same weave, print and scale, no stretching and
// no visible tiling. Image quilting (Efros & Freeman): the output is laid with square patches cut from the
// swatch, each overlapping its neighbours above and to the left; each patch is picked (among random cuts of
// the swatch) to match what's already there in the overlap, and joined along the seam where the two differ
// least, so no straight edges or grid show.

type RGBA = { data: Uint8ClampedArray; width: number; height: number };

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
// A patch is picked at random among the candidates matching within this much of the best (some variety, so
// the same cut doesn't repeat)
const MATCH_TOLERANCE = 1.15;

// The swatch with its light evened out: the folds, shading and sheen of the garment it was copied from (bright,
// dark or paler patches across it) taken out, keeping the fabric's own colour and pattern. Each colour of each
// pixel is set against its average around it (wider than the print's motifs), brought to the swatch's overall
// average. (Pixels that aren't fabric, like a white background, don't count toward the averages.)
function evenLight(src: RGBA): Uint8ClampedArray {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const weight = new Float64Array(n);
  let count = 0;
  for (let p = 0; p < n; p += 1) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    const lo = Math.min(r, g, b);
    if (data[p * 4 + 3] < 250 || (lo > 225 && Math.max(r, g, b) - lo < 20)) continue;
    weight[p] = 1;
    count += 1;
  }
  const out = new Uint8ClampedArray(data);
  if (count < n * 0.2) return out;
  // Box averages from running sums
  const radius = Math.max(4, Math.round(Math.min(w, h) / 6));
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
        const gain = Math.min(1.8, Math.max(0.55, mean / Math.max(1, around)));
        out[p * 4 + c] = data[p * 4 + c] * gain;
      }
    }
  }
  return out;
}

export function synthesizeFabric(src: RGBA, outW: number, outH: number, seed = 1): RGBA {
  const { width: sw, height: sh } = src;
  const s = evenLight(src);
  const out = new Uint8ClampedArray(outW * outH * 4);

  // Which swatch pixels are fabric: not see-through, and not the plain white background a garment photo is
  // cut out on (unless that's most of it: then it's a white fabric)
  const notFabric = new Uint8Array(sw * sh);
  let notFabricCount = 0;
  for (let p = 0; p < sw * sh; p += 1) {
    const r = s[p * 4];
    const g = s[p * 4 + 1];
    const b = s[p * 4 + 2];
    const lo = Math.min(r, g, b);
    if (s[p * 4 + 3] < 250 || (lo > 225 && Math.max(r, g, b) - lo < 20)) {
      notFabric[p] = 1;
      notFabricCount += 1;
    }
  }
  if (notFabricCount > sw * sh * 0.8) notFabric.fill(0);
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
          const e = errorOf(cx, cy, best * MATCH_TOLERANCE + 1);
          if (e === Infinity) return;
          tried.push({ x: cx, y: cy, e });
          best = Math.min(best, e);
        };
        for (const cut of cuts) tryCut(cut.x, cut.y);
        const good = tried.filter((t) => t.e <= best * MATCH_TOLERANCE + 1);
        const pick = good[Math.floor(rand() * good.length)];
        sx = pick.x;
        sy = pick.y;
      }

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
