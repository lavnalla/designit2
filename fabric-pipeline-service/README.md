# Fabric pipeline service

Extracts a flat, unwarped, seamless textile material from a wrinkle-distorted
clothing photo, then lays it onto another garment at its true physical scale
while keeping that garment's own folds, volume and lighting.

This replaces the old "copy fabric / paste fabric" behaviour, which stretched
the sampled pixels across the target's bounding box and distorted the weave.

## The four stages

| # | Stage | What it does | Where |
|---|-------|--------------|-------|
| 1 | Garment segmentation | Pixel-accurate garment mask, and the pixels-per-centimetre estimate derived from it | `segmenter.py` |
| 1b | Patch selection | Picks a region that is actually cloth, not neckline or backdrop | `patch.py` |
| 2 | Texture rectification | Diffusion pass that removes folds, shadows and perspective skew, producing a flat tileable swatch | `rectify.py` |
| 3 | Isotropic tiling | Repeats the swatch at a fixed px/cm ratio rather than resizing it to fit | `compositor.py` |
| 4 | Photometric blending | Modulates the tiled fabric by the destination's own shading to keep drape and cast shadows | `compositor.py` |

Stages 1–2 run on **copy** and are cached by crop hash. Stages 1, 3 and 4 run
on **paste**, which is why pasting the same swatch onto many targets is cheap.

## Models

| Purpose | Model | Notes |
|---------|-------|-------|
| Segmentation | `mattmdjaga/segformer_b2_clothes` | ATR/LIP 18-class scheme; garment classes 4 Upper-clothes, 5 Skirt, 6 Pants, 7 Dress |
| Rectification | `Yuanhao-Harry-Wang/fabric-diffusion-texture` | FabricDiffusion, an InstructPix2Pix model (SD 1.5) |

> The repo already contains a *different* segmenter — `sayeed99/segformer-b3-fashion`,
> used by `tools/garment_segment.py` with 46 fashion classes. The two label
> spaces are not interchangeable; this service deliberately uses the ATR one
> because that is the 4/5/6/7 scheme the pipeline is specified against.

Two details in the rectification stage are load-bearing and easy to lose if the
code is refactored, both taken from the reference implementation at
[humansensinglab/fabric-diffusion](https://github.com/humansensinglab/fabric-diffusion):

1. **Circular padding** is forced on every `Conv2d` in the UNet and VAE. This is
   what makes the generated swatch wrap seamlessly. Without it the swatch is
   flat but not tileable.
2. **Latent inversion** — the input is encoded to latents, renormalised, and
   noised to the first timestep, rather than starting from plain noise. This
   keeps the output faithful to the fabric that was actually photographed.

## Setup

Run everything from inside WSL. The default `python3` on this box is 3.14,
which has no torch wheels, so the venv is pinned to `python3.10`.

```bash
cd fabric-pipeline-service
./setup.sh                    # venv + torch/diffusers/transformers/fastapi
.venv/bin/python warm_models.py   # pre-download ~2.5GB of weights
./service.sh start            # listens on 127.0.0.1:8010
```

`./service.sh {start|stop|restart|status|logs}` manages the process. It uses
`setsid` and redirects stdin from `/dev/null`: a plain `nohup ... &` leaves
stdin at EOF, which some CLIs read as a shutdown signal, and the server then
dies seconds after reporting that it started.

The Next.js side reaches the service at `FABRIC_SERVICE_URL`, defaulting to
`http://127.0.0.1:8010`. If it is not running, copy and paste both fall back to
the previous stretch behaviour and say so in the UI rather than failing.

## API

- `GET /health` — model readiness, device, cache size
- `POST /warm` — load both models up front
- `POST /copy` — `{ imageDataUrl, rect?, seed?, rectify? }` → flat swatch + `srcPxPerCm`
- `POST /paste` — `{ swatchDataUrl, destImageDataUrl, cropWidth, cropHeight, srcPxPerCm, multiplier?, shadingStrength?, targetWidth?, targetHeight? }` → composited RGBA

`/copy` needs the **whole source photo**, not just the crop. Physical scale is
estimated from how large the garment is in frame, and a lone patch carries no
clue how big it is in the world.

`/paste` returns an image sized to exactly `targetWidth × targetHeight`. That
matters: the SVG `<image>` that displays it is drawn with
`preserveAspectRatio="none"`, so anything other than a 1:1 payload would be
stretched by the renderer — the second source of distortion, alongside the old
`createSharpStretchedTexture`.

## How physical scale is worked out

The swatch was cut from a photo at `srcPxPerCm` and is laid into one at
`dstPxPerCm`, so its size in destination pixels is the crop scaled by the ratio
of the two densities — the centimetres cancel:

```
tile_px = crop_px * (dstPxPerCm / srcPxPerCm) * multiplier
```

Each density comes from the garment's width in pixels divided by an assumed
real-world width (`labels.GARMENT_WIDTH_CM`, ~40cm across an upper-body
torso). Those are coarse adult averages, but because only the *ratio* is used,
a consistent bias cancels. The **Tile scale** slider in the UI corrects
whatever remains.

The same ratio is applied to both axes, which is what makes the tiling
isotropic: the weave cannot be squashed along one axis.

### Where the pixel width is measured, and why it depends on the shape

The class label cannot decide this. `segformer_b2_clothes` is trained on
photos of *people*, and on isolated product shots it collapses — all nine
garment images in `public/` come back as "Dress", including a t-shirt, a tank
top and a mannequin. A per-class width table is therefore inert.

The **silhouette** is reliable where the label is not, so `geometry.py`
classifies the mask's shape and measures accordingly:

| silhouette | how it is spotted | where it is measured | why |
|---|---|---|---|
| `straight` | hem no wider than the body | median row width | most rows cross the body; the median steps over sleeves |
| `flared` | hem ≥1.25× the median row | widest row in the top 3–20% | most rows cross the *skirt*, not the body |
| `legged` | ≥35% of lower rows contain 2+ runs | widest row in the top 3–20% | a row crosses two legs, summing to less than the hips |

Scored against synthetic garments whose true scale is known by construction
(`eval_scale.py`), over every ordered pair:

| estimator | mean error | pairs within 15% | worst |
|---|---:|---:|---:|
| bounding-box width | 43.3% | 19% | 186% |
| median row width | 20.9% | 44% | 79% |
| **silhouette landmark** | **3.4%** | **100%** | **11%** |

The median row alone is fine for straight garments (0–4%) and fails exactly
where the shape changes: **+43% on a gown, +43% on a skirt, −20% on trousers**.

`eval_robust.py` re-runs this on 240 randomised garments — widths, lengths,
sleeve spans, flare, leg splits, mask noise and rotation all drawn per trial,
none of them looked at while choosing the thresholds — and gets 100%
silhouette accuracy with 2.3% mean error, against 18.2% for the median row.

## Tests

```bash
.venv/bin/python eval_scale.py          # scale estimators vs. known ground truth
.venv/bin/python eval_robust.py         # same, on 240 randomised garments
.venv/bin/python test_scale_transfer.py # end-to-end transfer across garment types
.venv/bin/python test_tiling.py         # scale maths + tiling geometry, needs the service up
.venv/bin/python test_shading.py        # isolates stage 4 with a flat grey swatch
.venv/bin/python test_cross_garment.py  # pattern transfer between different garment types
.venv/bin/python test_api_routes.py     # through the Next.js proxy routes, needs `npm run dev`
.venv/bin/python test_pipeline.py ../public/designFrom.png ../public/designTo1.png
.venv/bin/python diag_mask.py ../public/designTo1.png    # which classes the segmenter finds
.venv/bin/python diag_patch.py ../public/templates/blouse.jpg ../public/templates/t-shirt.jpg
```

`test_shading.py` pastes a **flat grey** swatch: any structure in the output
must have come from the destination's shading, so it measures stage 4 on its
own instead of letting the swatch's pattern stand in for it.

`test_cross_garment.py` measures motif size from the 2-D power spectrum, and
begins by validating that instrument against synthetic patterns of known
spacing. Two cautions are baked into it, both learned the hard way:

- Only the **ratio** of two measurements is used. The radial peak of a
  staggered grid sits on the diagonal, at `spacing/√2`, so absolute values
  carry a ~29% geometric offset that cancels in a ratio.
- A peak pinned to the **low edge** of the search band means smooth shading,
  not a motif — a plain black t-shirt otherwise scores a spectral prominence
  of 87 with no pattern on it at all. Cases with no real motif are skipped
  rather than asserted on, because there is nothing there to preserve.

Note what `test_cross_garment.py` can and cannot show. Its motif check divides
both sides by the same px/cm the pipeline chose, so a wrong scale estimate
cancels itself out and still passes; it catches tiling and sizing bugs, not
bad scale. **`test_scale_transfer.py` is the one that tests scale for real** —
synthetic garments carry a motif of known centimetre size, so the output can be
measured against ground truth rather than against the pipeline's own opinion.
Across all 72 ordered pairs of garment types it holds the motif to a median of
5.9% and a mean of 7.2%.

Two measurement traps cost real time here and are worth not repeating: a
window cropped from the middle of a mask's bounding box lands in the **gap
between trouser legs**, which made every trouser destination report the same
nonsense figure; and a 1-D profile **cancels staggered dots** entirely.

## Worn photos vs flat product shots

The supported directions are **worn → flat** and **flat → flat**. Worn → worn
is out of scope.

These are two genuinely different regimes and the code branches on them. A
visible face separates them — present in every worn photo, absent from every
product shot.

**Labels are trustworthy on a worn photo and not on a flat one.** All nine flat
images in `public/` come back as "Dress". A photographed person is what this
model was trained on, and it cleanly separates `Upper-clothes` from `Skirt`,
plus `Face`, `Hair` and both arms.

That flips one heuristic on its head. On a flat shot, folding substantial
garment classes together is right, because one garment gets split across
labels. On a person it is wrong: separate labels mean *separate garments*, and
merging a striped jumper with the skirt below it gives a mask that is neither.
So `COMPANION_CLASS_FRAC` applies only when no face is found, and on a worn
photo the user's selection decides which garment is meant (`focus_rect`).

### Scale on a worn photo

`scale.py` combines two independent anthropometric references, because neither
is good enough alone:

| reference | strength | weakness |
|---|---|---|
| face breadth (~14cm) | tight across adults | hair over the cheeks and a turned head both narrow it; the face region's own aspect ranged 0.23–0.61 across four photos |
| garment body width | always available | cut varies 34–56cm, and a skirt whose flare runs off frame reads as straight (~35% high) |

They are merged as a confidence-weighted **geometric** mean — these are scale
factors, so a multiplicative average stays symmetric when source and
destination swap. Their disagreement is reported: on the four reference photos
it was 7%, 17%, 20% and 39%, and anything above 35% shows an explicit
"scale uncertain" warning in the UI pointing at the Tile scale slider.

**Deliberately not used: head height including hair.** Hair length swamps it —
on the two long-haired subjects it implied 9.0 px/cm against 2.4 from the face.

## Evaluation on VITON-HD

`fetch_dataset.py` streams a subset of
[SaffalPoosh/VITON-HD-test](https://huggingface.co/datasets/SaffalPoosh/VITON-HD-test)
(Apache-2.0 on the Hub; upstream VITON-HD is research-use, so the data stays in
the gitignored `testdata/`). `eval_dataset.py` then scores against it.

It is worth the download for one reason: **each photo of a person is paired
with the flat product shot of the garment they are wearing**, plus a
ground-truth human parsing map. That pairing is the only way to check that
fabric copied off a worn photo matches the real garment, rather than merely
looking plausible — every earlier test could only check the pipeline against
its own opinion.

Measured over 40 pairs:

| what | result |
|---|---|
| garment mask vs ground-truth parsing, told which garment | mean IoU **0.945**, median 0.981, 98% ≥ 0.70 |
| fabric fidelity: worn-derived vs flat-derived swatch | median **17.5** RGB units apart, 95% within 40 |
| motif period, where both swatches had one | agreed within **8%** (median) |
| patches sampling non-fabric | **0 / 40** |
| garment chosen with no selection | upper garment 68% of the time |

That last row is behaviour, not failure: most of these subjects wear a top and
jeans, and unguided the pipeline takes whichever garment is larger. When it
takes the jeans it produces a perfectly accurate mask of the jeans. Passing the
user's selection through as `focus_rect` is what settles it, and doing so is
what lifts IoU from a bimodal mess to 0.945.

### A real failure this surfaced

On a garment carrying a **placed graphic** — a chest print, a logo — the patch
selector picks the largest clean region inside the mask, which on a t-shirt is
centred on the chest, which is exactly where the print is. The swatch then
contains the logo and tiles it across the target. Confirmed by eye on the
"MON CHÉRI" tee in `outputs/dataset/000_worn_flat_swatches.png`.

No reliable automated count for this: measuring how far a patch's colours sit
from the garment's dominant colour flags busy allover florals just as readily
as logos, and it did not flag the MON CHÉRI case at all.

**The obvious fix was built, measured, and rejected.** Scoring candidate
patches for stationarity — a repeating fabric looks the same in each of its
quadrants, a logo does not — and preferring the most homogeneous region is
implemented in `patch.best_fabric_patch`, but `choose_patch` does not call it.

`sweep_patch_weights.py` says why. Across the whole weighting grid, on 40
VITON-HD garments:

| stationarity | typicality | size | margin | pattern richness | patches losing >30% | graphic content | patches >15% graphic |
|---:|---:|---:|---:|---:|---:|---:|---:|
| — | — | — | baseline | 1.00 | 0 | 7.2% | 7 |
| 0.30 | 0.45 | 0.25 | 0.00 | 0.94 | 4 | 6.5% | 6 |
| 0.20 | 0.55 | 0.25 | 0.05 | 1.02 | 0 | 7.2% | 7 |
| 0.10 | 0.60 | 0.30 | 0.00 | 1.03 | 0 | 7.2% | 7 |
| 0.00 | 0.65 | 0.35 | 0.00 | 1.03 | 0 | 7.2% | 7 |

Every setting that measurably reduced graphic content also cost pattern; every
setting that preserved pattern left graphic content exactly at baseline. An
earlier, more aggressive version scored beautifully on its own objective
(stationarity 0.40 → 0.80) while stripping **28 of 40** patches of more than
30% of their pattern richness — it had learned to sample the calm gaps between
the flowers.

Since the requirement is that repeating patterns work and logos need not
transfer, the simple largest-interior-patch rule is the right one. Revisit only
with a scorer that distinguishes "locally atypical" from "calm", and only
against that sweep.

## Tuning notes

`compositor.DEFAULT_DETAIL_SIGMA_FRAC` (0.012) is the blur radius used to
separate drape from the old fabric's weave, as a fraction of the frame's
longest side. It is the main quality knob, and it is a genuine trade-off —
measured on `public/designTo1.png`:

| sigma frac | tracks destination lighting (r) | old weave carried across |
|-----------:|--------------------------------:|-------------------------:|
| 0.002 | 0.877 | 46.6% |
| 0.004 | 0.851 | 21.5% |
| 0.008 | 0.796 | 8.1% |
| **0.012** | **0.739** | **4.1%** |
| 0.020 | 0.645 | 1.5% |
| 0.050 | 0.461 | 0.2% |

Too small and the destination's existing weave prints itself on the new
material; too large and only broad lighting survives and the folds flatten out.
0.012 is the knee of that curve. Correlation is deliberately *not* driven
towards 1.0 — that would mean copying the old fabric back in.
