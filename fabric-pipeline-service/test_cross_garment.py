"""Cross-garment transfer: does a pattern keep its physical size and stay clean?

  .venv/bin/python test_cross_garment.py

The case this guards is a patterned sleeveless top copied onto a sleeved
t-shirt, which failed two ways: the sampled patch caught the neckline and
backdrop, and the bounding-box scale estimate treated the t-shirt's sleeves as
extra body width and oversized the motif by ~30%.

Motif size is measured by autocorrelation rather than by eye: a repeating
pattern peaks at its own period, so the period found in the pasted result
should equal the source's period times the scale ratio the pipeline chose.
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
OUT = Path("outputs/cross")


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read())


def to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def from_data_url(url: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))


def dominant_period(gray: np.ndarray, min_period: float = 4.0, max_period_frac: float = 0.25) -> float:
    """Spacing of the strongest repeat, from the 2-D power spectrum.

    Collapsing the field to a 1-D profile does not work here: polka dots are
    staggered, so averaging along either axis cancels them out and the
    autocorrelation finds only noise. The 2-D spectrum keeps the geometry, and
    a regular motif shows up as a ring of energy whose radius is the pattern's
    fundamental frequency. Period is then side / frequency.
    """
    x = gray.astype(np.float32)
    if x.size == 0 or x.shape[0] < 16 or x.shape[1] < 16:
        return float("nan"), 0.0

    # Square off and window, so the ring is not smeared by edge discontinuities
    # or by the two axes having different lengths.
    n = min(x.shape)
    x = x[:n, :n]
    x = x - x.mean()
    w = np.hanning(n)
    x = x * w[:, None] * w[None, :]

    power = np.abs(np.fft.fftshift(np.fft.fft2(x))) ** 2

    cy = cx = n // 2
    yy, xx = np.ogrid[:n, :n]
    radius = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2).astype(np.int32)

    radial = np.bincount(radius.ravel(), weights=power.ravel())
    counts = np.bincount(radius.ravel())
    radial = radial / np.maximum(counts, 1)

    # Ignore DC and the lowest frequencies -- on a real garment those carry the
    # drape and the silhouette, which swamp the motif -- and anything finer
    # than min_period (sensor noise, JPEG blocking).
    lo = max(2, int(np.ceil(n / (n * max_period_frac))))
    hi = int(np.floor(n / min_period))
    hi = min(hi, len(radial) - 1)
    if hi <= lo + 1:
        return float("nan"), 0.0

    band = radial[lo:hi]
    if band.size == 0 or not np.isfinite(band).any():
        return float("nan"), 0.0

    freq = lo + int(np.argmax(band))
    if freq <= 0:
        return float("nan"), 0.0

    # Is this a real motif, or just smooth shading?
    #
    # Peak height alone does not tell them apart: a plain garment's spectrum
    # falls away monotonically from DC, so the largest value in the band sits
    # at its low edge and can tower over the rest -- a black t-shirt scores a
    # prominence of 87 with no pattern on it whatsoever. What distinguishes a
    # repeating motif is that its peak sits *inside* the band, at the pattern's
    # own frequency, rather than being pinned against the edge.
    median = float(np.median(band))
    height = float(band.max() / median) if median > 0 else 0.0

    idx = int(np.argmax(band))
    on_edge = idx <= 0 or idx >= len(band) - 1
    prominence = 0.0 if on_edge else height

    return float(n) / freq, prominence


def run_case(name: str, src_path: str, dst_path: str, results: list) -> dict | None:
    src = Image.open(src_path).convert("RGB")
    dst = Image.open(dst_path).convert("RGB")
    print(f"\n=== {name}: {Path(src_path).name} -> {Path(dst_path).name} ===")

    # No rect: this is the "copy the fabric off this garment" path, where the
    # pipeline must find the fabric itself.
    copy = post("/copy", {"imageDataUrl": to_data_url(src), "rect": None, "seed": 0})
    paste = post("/paste", {
        "swatchDataUrl": copy["swatchDataUrl"],
        "destImageDataUrl": to_data_url(dst),
        "cropWidth": copy["cropWidth"],
        "cropHeight": copy["cropHeight"],
        "srcPxPerCm": copy["srcPxPerCm"],
        "multiplier": 1.0,
        "shadingStrength": 1.0,
    })

    OUT.mkdir(parents=True, exist_ok=True)
    tag = name.replace(" ", "_")
    swatch = from_data_url(copy["swatchDataUrl"])
    swatch.save(OUT / f"{tag}_swatch.png")
    pasted = from_data_url(paste["imageDataUrl"])
    flat = Image.alpha_composite(dst.convert("RGBA"), pasted).convert("RGB")
    flat.save(OUT / f"{tag}_composite.png")

    print(f"   patch      : {copy['cropWidth']}x{copy['cropHeight']} at {copy['patchRect']} "
          f"({100 * copy['patchCoverage']:.1f}% fabric)")
    print(f"   reason     : {copy['patchReason']}")
    print(f"   scale      : src {copy['srcPxPerCm']:.2f} px/cm -> dst {paste['dstPxPerCm']:.2f} px/cm "
          f"= x{paste['scaleRatio']:.3f}")
    print(f"   tile       : {paste['tileWidth']}x{paste['tileHeight']}")

    # 1. The patch must be essentially pure fabric.
    clean = copy["patchCoverage"] >= 0.97
    print(f"   [{'PASS' if clean else 'FAIL'}] patch is fabric, not background: "
          f"{100 * copy['patchCoverage']:.1f}% >= 97%")
    results.append(clean)

    # 2. Internal consistency: the laid-down motif matches the scale the
    #    pipeline declared.
    #
    # NOTE this is *not* proof that the scale is anatomically right. Both sides
    # are divided by the same px/cm the pipeline chose, so a wrong estimate
    # cancels itself out and still passes. It catches tiling and sizing bugs,
    # nothing more. Ground-truth scale is tested in test_scale_transfer.py,
    # against synthetic garments whose true px/cm is known by construction.
    def interior_of(img: Image.Image, mask: np.ndarray) -> np.ndarray:
        ys, xs = np.nonzero(mask)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        gy, gx = (y1 - y0) // 4, (x1 - x0) // 4
        return np.asarray(img.convert("L"))[y0 + gy: y1 - gy, x0 + gx: x1 - gx]

    src_patch = src.crop((
        copy["patchRect"]["x"], copy["patchRect"]["y"],
        copy["patchRect"]["x"] + copy["patchRect"]["width"],
        copy["patchRect"]["y"] + copy["patchRect"]["height"],
    ))
    period_src_px, prominence = dominant_period(np.asarray(src_patch.convert("L")))
    period_dst_px, _ = dominant_period(interior_of(flat, np.asarray(pasted)[..., 3] > 128))

    # A plain garment has no motif, so there is nothing for the transfer to
    # preserve and any "period" measured off it is noise. Asserting on that
    # would be measuring the instrument, not the pipeline.
    MIN_PROMINENCE = 3.0
    print(f"   motif      : period {period_src_px:.1f}px, spectral prominence {prominence:.2f}")
    if prominence < MIN_PROMINENCE:
        print(f"   [skip] source has no repeating motif to preserve "
              f"(prominence {prominence:.2f} < {MIN_PROMINENCE})")
    else:
        cm_src = period_src_px / copy["srcPxPerCm"]
        cm_dst = period_dst_px / paste["dstPxPerCm"]
        err = abs(cm_dst - cm_src) / max(cm_src, 1e-6)
        ok_period = err < 0.25
        print(f"   [{'PASS' if ok_period else 'FAIL'}] motif matches declared scale: "
              f"{period_src_px:.1f}px @ {copy['srcPxPerCm']:.2f}px/cm = {cm_src:.2f}cm  ->  "
              f"{period_dst_px:.1f}px @ {paste['dstPxPerCm']:.2f}px/cm = {cm_dst:.2f}cm ({100 * err:+.0f}%)")
        results.append(ok_period)

    return {"copy": copy, "paste": paste}


def self_check(results: list) -> None:
    """Validate the period measurement on patterns whose spacing is known.

    An unvalidated instrument cannot be used to judge the pipeline: if this
    disagrees with ground truth, a failure below says nothing about the code
    under test.
    """
    print("=== self-check: dominant_period tracks relative scale ===")
    print("   (absolute value carries a geometric offset -- the radial peak of a")
    print("    staggered grid sits on the diagonal, at spacing/sqrt(2) -- so only")
    print("    the ratio between two measurements is used, where that cancels.)")

    def dots(n: int, spacing: float) -> np.ndarray:
        yy, xx = np.mgrid[:n, :n]
        field = (np.sin(2 * np.pi * xx / spacing) * np.sin(2 * np.pi * yy / spacing) > 0.3)
        return (field * 200 + 30).astype(np.uint8)

    base, _ = dominant_period(dots(256, 16))
    for factor in (1.5, 2.0, 3.0):
        got, _ = dominant_period(dots(256, 16 * factor))
        ratio = got / base
        err = abs(ratio - factor) / factor
        ok = err < 0.12
        print(f"   [{'PASS' if ok else 'FAIL'}] spacing x{factor}: measured ratio "
              f"{ratio:.2f} vs {factor:.2f} ({100 * err:+.0f}%)")
        results.append(ok)


def main() -> int:
    results: list[bool] = []
    self_check(results)

    a = run_case("blouse to tshirt", "../public/templates/blouse.jpg", "../public/templates/t-shirt.jpg", results)
    b = run_case("tshirt to blouse", "../public/templates/t-shirt.jpg", "../public/templates/blouse.jpg", results)

    # Round-tripping must be self-consistent: scaling up then back down should
    # land near 1.0, otherwise the estimator is not measuring the same thing on
    # both silhouettes.
    if a and b:
        rt = a["paste"]["scaleRatio"] * b["paste"]["scaleRatio"]
        ok_rt = 0.75 < rt < 1.33
        print(f"\n   [{'PASS' if ok_rt else 'FAIL'}] round trip is self-consistent: "
              f"{a['paste']['scaleRatio']:.3f} x {b['paste']['scaleRatio']:.3f} = {rt:.3f} (want ~1.0)")
        results.append(ok_rt)

    # Guard the case that already worked, so the scale-estimator change does
    # not quietly regress it.
    run_case("dress to dress", "../public/designFrom.png", "../public/designTo1.png", results)

    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    print(f"images -> {OUT}/")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
