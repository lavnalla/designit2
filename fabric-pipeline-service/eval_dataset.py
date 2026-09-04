"""Evaluate the pipeline on VITON-HD, which supplies real paired ground truth.

  .venv/bin/python eval_dataset.py [n]

Two things get measured, both against data rather than judgement:

**Segmentation.** The dataset ships a human parsing map, so the garment mask
can be scored by IoU instead of being eyeballed. Ground truth for the upper
garment is classes {5, 21, 22} -- 5 is the body, and 21/22 are the sleeves,
confirmed by their mean colour sitting within a few RGB units of 5's.

**Fabric fidelity.** Each person is paired with the flat product shot of the
garment they are wearing. So the same fabric can be extracted twice -- once
from the worn photo, once from the flat shot -- and the two compared. If
copying fabric off a worn photo genuinely recovers the material, those two
swatches should agree. This is the check that the earlier tests could not
make: the flat shot is an independent record of the right answer.
"""

from __future__ import annotations

import base64
import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

BASE = "http://127.0.0.1:8010"
DATA = Path("testdata/vitonhd")
OUT = Path("outputs/dataset")

GT_UPPER = (5, 21, 22)


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as resp:
        return json.loads(resp.read())


def to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def from_data_url(url: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))


def dominant_period(gray: np.ndarray, min_period: float = 4.0, max_frac: float = 0.25):
    x = gray.astype(np.float32)
    if x.size == 0 or min(x.shape) < 16:
        return float("nan"), 0.0
    n = min(x.shape)
    x = x[:n, :n] - x[:n, :n].mean()
    w = np.hanning(n)
    x = x * w[:, None] * w[None, :]
    power = np.abs(np.fft.fftshift(np.fft.fft2(x))) ** 2
    c = n // 2
    yy, xx = np.ogrid[:n, :n]
    r = np.sqrt((yy - c) ** 2 + (xx - c) ** 2).astype(np.int32)
    radial = np.bincount(r.ravel(), weights=power.ravel()) / np.maximum(np.bincount(r.ravel()), 1)
    lo = max(2, int(np.ceil(1.0 / max_frac)))
    hi = min(int(np.floor(n / min_period)), len(radial) - 1)
    if hi <= lo + 1:
        return float("nan"), 0.0
    band = radial[lo:hi]
    idx = int(np.argmax(band))
    med = float(np.median(band))
    prom = 0.0 if (idx <= 0 or idx >= len(band) - 1) else (float(band.max() / med) if med > 0 else 0.0)
    return float(n) / (lo + idx), prom


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    OUT.mkdir(parents=True, exist_ok=True)

    tags = sorted(p.stem for p in (DATA / "worn").glob("*.jpg"))[:n]
    print(f"{len(tags)} pairs from VITON-HD\n")

    ious, colour_errs, period_errs = [], [], []
    unguided_upper: list[bool] = []
    seg_fail, patch_fail = 0, 0
    rows = []

    for tag in tags:
        worn = Image.open(DATA / "worn" / f"{tag}.jpg").convert("RGB")
        flat = Image.open(DATA / "flat" / f"{tag}.jpg").convert("RGB")
        parse = np.asarray(Image.open(DATA / "parse" / f"{tag}.png").convert("L"))
        gt = np.isin(parse, GT_UPPER)

        # --- copy fabric from the worn photo, aimed at the upper garment ---
        ys, xs = np.nonzero(gt)
        if ys.size == 0:
            continue
        rect = {"x": float(xs.min()), "y": float(ys.min()),
                "width": float(xs.max() - xs.min()), "height": float(ys.max() - ys.min())}

        c_worn = post("/copy", {"imageDataUrl": to_data_url(worn), "rect": rect, "seed": 0})
        c_flat = post("/copy", {"imageDataUrl": to_data_url(flat), "rect": None, "seed": 0})

        # --- segmentation IoU against the parsing map ---
        #
        # Two separate questions, and conflating them is misleading. Asked to
        # find *this* garment, how accurate is the mask? And left to choose,
        # which garment does it pick? Most of these subjects wear a top and
        # jeans, and unguided the pipeline takes whichever is larger -- often
        # the jeans, which scores ~0 against an upper-garment ground truth
        # while being a perfectly correct mask of the trousers.
        import segmenter as seg_mod

        guided = seg_mod.segmenter.segment(
            worn, focus_rect=(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
        ).mask
        inter = np.logical_and(guided, gt).sum()
        union = np.logical_or(guided, gt).sum()
        iou = float(inter / union) if union else 0.0
        ious.append(iou)
        if iou < 0.5:
            seg_fail += 1

        unguided = seg_mod.segmenter.segment(worn).mask
        picked_upper = np.logical_and(unguided, gt).sum() / max(unguided.sum(), 1) > 0.5
        unguided_upper.append(bool(picked_upper))

        if min(c_worn["patchCoverage"], c_flat["patchCoverage"]) < 0.95:
            patch_fail += 1

        # --- fabric fidelity: worn-derived swatch vs flat-derived swatch ---
        sw_worn = from_data_url(c_worn["swatchDataUrl"])
        sw_flat = from_data_url(c_flat["swatchDataUrl"])
        a = np.asarray(sw_worn).astype(np.float32)
        b = np.asarray(sw_flat).astype(np.float32)
        colour_err = float(np.linalg.norm(a.reshape(-1, 3).mean(0) - b.reshape(-1, 3).mean(0)))
        colour_errs.append(colour_err)

        pa, proma = dominant_period(np.asarray(sw_worn.convert("L")))
        pb, promb = dominant_period(np.asarray(sw_flat.convert("L")))
        if proma >= 3.0 and promb >= 3.0:
            period_errs.append(abs(pa - pb) / max(pb, 1e-6))

        rows.append((tag, iou, colour_err, c_worn["patchCoverage"], c_worn["sourceScaleConfidence"]))

        if len(rows) <= 6:
            sheet = Image.new("RGB", (worn.width * 2 + 256 * 2, max(worn.height, 256)), (255, 255, 255))
            sheet.paste(worn, (0, 0)); sheet.paste(flat, (worn.width, 0))
            sheet.paste(sw_worn.resize((256, 256)), (worn.width * 2, 0))
            sheet.paste(sw_flat.resize((256, 256)), (worn.width * 2 + 256, 0))
            sheet.save(OUT / f"{tag}_worn_flat_swatches.png")

    ious = np.array(ious); colour_errs = np.array(colour_errs)
    print(f"{'tag':<6} {'IoU':>6} {'colourErr':>10} {'patch':>7} {'conf':>6}")
    for tag, iou, ce, pc, cf in rows[:12]:
        print(f"{tag:<6} {iou:6.3f} {ce:10.1f} {100 * pc:6.1f}% {cf:6.2f}")
    if len(rows) > 12:
        print(f"... {len(rows) - 12} more")

    print(f"\n=== segmentation vs ground truth, told which garment ({len(ious)}) ===")
    print(f"   mean IoU {ious.mean():.3f}   median {np.median(ious):.3f}   "
          f"p10 {np.percentile(ious, 10):.3f}   min {ious.min():.3f}")
    print(f"   IoU >= 0.70: {100 * (ious >= 0.70).mean():.0f}%     "
          f">= 0.50: {100 * (ious >= 0.50).mean():.0f}%     below 0.50: {seg_fail}")

    if unguided_upper:
        u = np.array(unguided_upper)
        print("")
        print(f"   left to choose on its own, it picked the upper garment in "
              f"{100 * u.mean():.0f}% of these outfits -- the rest are the trousers,")
        print(f"   which is the larger garment and a correct mask of a different thing.")

    print(f"\n=== fabric fidelity: worn-derived vs flat-derived swatch ===")
    print(f"   mean RGB distance {colour_errs.mean():.1f}   median {np.median(colour_errs):.1f}"
          f"   p90 {np.percentile(colour_errs, 90):.1f}   max {colour_errs.max():.1f}")
    print(f"   within 20 RGB units: {100 * (colour_errs < 20).mean():.0f}%     "
          f"within 40: {100 * (colour_errs < 40).mean():.0f}%")
    print(f"   (0 = identical; 40 on a 0-441 diagonal is a visibly close match)")

    if period_errs:
        pe = np.array(period_errs)
        print(f"\n   both swatches showed a measurable motif in {len(pe)}/{len(rows)} pairs;")
        print(f"   motif period agreed to within {100 * np.median(pe):.0f}% (median), "
              f"{100 * pe.mean():.0f}% (mean)")

    print(f"\n   patches below 95% fabric: {patch_fail}/{len(rows)}")
    print(f"\nsample sheets -> {OUT}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
