"""Local FastAPI service for the fabric copy/paste pipeline.

Run from the repo root (see README.md):

  fabric-pipeline-service/.venv/bin/python -m uvicorn server:app \
      --app-dir fabric-pipeline-service --host 127.0.0.1 --port 8010

Both models stay resident: the diffusion checkpoint is ~4GB and reloading it
per request would make the feature unusable.
"""

from __future__ import annotations

import base64
import hashlib
import io
import time
from collections import OrderedDict

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

import compositor
import patch
import rectify
import segmenter

MAX_IMAGE_BYTES = 16 * 1024 * 1024

# Flattening is the expensive stage (~2-5s on a 3070), and the same crop gets
# pasted onto many targets, so the swatch is cached by content hash.
SWATCH_CACHE_SIZE = 64
_swatch_cache: "OrderedDict[str, dict]" = OrderedDict()


def _decode_data_url(data_url: str) -> Image.Image:
    if not data_url or "," not in data_url:
        raise HTTPException(status_code=400, detail="Expected a base64 data URL")
    header, encoded = data_url.split(",", 1)
    if "base64" not in header:
        raise HTTPException(status_code=400, detail="Only base64 data URLs are supported")
    try:
        raw = base64.b64decode(encoded)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Bad base64 payload: {exc}") from exc
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 16MB)")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not decode image: {exc}") from exc
    return image


def _encode_data_url(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _cache_get(key: str) -> dict | None:
    if key in _swatch_cache:
        _swatch_cache.move_to_end(key)
        return _swatch_cache[key]
    return None


def _cache_put(key: str, value: dict) -> None:
    _swatch_cache[key] = value
    _swatch_cache.move_to_end(key)
    while len(_swatch_cache) > SWATCH_CACHE_SIZE:
        _swatch_cache.popitem(last=False)


app = FastAPI(
    title="Fabric Pipeline Service",
    description="Segment -> rectify -> isotropic tile -> photometric blend.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Rect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class CopyRequest(BaseModel):
    # The full source photo, used to estimate physical scale. The crop alone
    # cannot tell us how big the garment is in the frame.
    imageDataUrl: str
    rect: Rect | None = None
    seed: int | None = None
    seamBlendPx: int = 0
    # Skip the diffusion stage; useful for A/B against the old naive path.
    rectify: bool = True


class PasteRequest(BaseModel):
    swatchDataUrl: str
    destImageDataUrl: str
    cropWidth: float = Field(gt=0)
    cropHeight: float = Field(gt=0)
    srcPxPerCm: float = Field(gt=0)
    multiplier: float = 1.0
    shadingStrength: float = 1.0
    featherPx: int = 2
    # Optional override so the caller can request an exact output size.
    targetWidth: int | None = None
    targetHeight: int | None = None


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "segmenter": {
            "model_id": segmenter.MODEL_ID,
            "ready": segmenter.segmenter.ready,
            "device": str(segmenter.segmenter.device),
            "load_seconds": segmenter.segmenter.load_seconds,
        },
        "rectifier": {
            "model_id": rectify.MODEL_ID,
            "ready": rectify.rectifier.ready,
            "device": str(rectify.rectifier.device),
            "dtype": str(rectify.rectifier.dtype),
            "load_seconds": rectify.rectifier.load_seconds,
        },
        "swatch_cache": len(_swatch_cache),
    }


@app.post("/warm")
def warm() -> dict:
    """Load both models up front so the first real request is not a cold start."""
    start = time.perf_counter()
    segmenter.segmenter.load()
    rectify.rectifier.load()
    return {"ok": True, "seconds": round(time.perf_counter() - start, 3)}


@app.post("/copy")
def copy_fabric(req: CopyRequest) -> dict:
    """Stages 1-2: segment the source for scale, then flatten the crop."""
    source = _decode_data_url(req.imageDataUrl).convert("RGB")
    full_w, full_h = source.size

    requested = None
    if req.rect:
        requested = (
            int(round(req.rect.x)),
            int(round(req.rect.y)),
            int(round(req.rect.x + req.rect.width)),
            int(round(req.rect.y + req.rect.height)),
        )

    # Stage 1 -- the source garment's mask and pixel density. The selection is
    # passed in so that on a photo of someone wearing several garments, the
    # region the user dragged over decides which one is meant.
    seg = segmenter.segmenter.segment(source, focus_rect=requested)

    # Only sample from pixels that are actually cloth. A crop that catches the
    # neckline, a strap or the backdrop gets flattened along with the fabric
    # and then tiled, which bands the target with background instead of weave.

    choice = patch.choose_patch(seg.mask, requested, image=np.asarray(source))
    crop = source.crop(choice.rect)

    crop_w, crop_h = crop.size
    if crop_w < 8 or crop_h < 8:
        raise HTTPException(status_code=400, detail="Selection is too small to sample fabric from")

    # Stage 2 -- flatten, cached by crop content.
    crop_buf = io.BytesIO()
    crop.save(crop_buf, format="PNG")
    cache_key = hashlib.sha256(
        crop_buf.getvalue() + f"|{req.seed}|{req.seamBlendPx}|{req.rectify}".encode()
    ).hexdigest()

    cached = _cache_get(cache_key)
    if cached:
        swatch_data_url = cached["swatchDataUrl"]
        rectify_seconds = 0.0
        from_cache = True
    else:
        if req.rectify:
            result = rectify.rectifier.flatten(
                crop, n_samples=1, seed=req.seed, seam_blend_px=req.seamBlendPx
            )
            swatch_image = result.swatch
            rectify_seconds = result.seconds
        else:
            swatch_image = crop.resize((rectify.PATCH_SIZE, rectify.PATCH_SIZE), Image.LANCZOS)
            rectify_seconds = 0.0
        swatch_data_url = _encode_data_url(swatch_image)
        _cache_put(cache_key, {"swatchDataUrl": swatch_data_url})
        from_cache = False

    return {
        "swatchDataUrl": swatch_data_url,
        "cacheKey": cache_key,
        "fromCache": from_cache,
        "cropWidth": crop_w,
        "cropHeight": crop_h,
        "srcPxPerCm": round(seg.px_per_cm, 6),
        "sourceGarment": seg.label,
        "sourceGarmentFound": seg.class_id != 0,
        "sourceSilhouette": seg.silhouette,
        "sourceLandmark": seg.landmark,
        "sourceScaleConfidence": seg.scale_confidence,
        "sourceScaleSources": seg.scale_sources,
        "sourceScaleNote": seg.scale_note,
        "sourcePersonPresent": seg.person_present,
        "sourceCoverage": round(seg.coverage, 4),
        "segmentSeconds": seg.inference_seconds,
        "rectifySeconds": rectify_seconds,
        "rectified": req.rectify,
        # Where the fabric was actually taken from, so the UI can say when it
        # moved the sample rather than silently ignoring the user's selection.
        "patchRect": {
            "x": choice.rect[0], "y": choice.rect[1],
            "width": choice.width, "height": choice.height,
        },
        "patchCoverage": round(choice.coverage, 4),
        "patchRelocated": choice.relocated,
        "patchReason": choice.reason,
    }


@app.post("/paste")
def paste_fabric(req: PasteRequest) -> dict:
    """Stages 1, 3, 4: segment the destination, tile isotropically, relight."""
    swatch = _decode_data_url(req.swatchDataUrl).convert("RGB")
    destination = _decode_data_url(req.destImageDataUrl).convert("RGB")

    # Render at the caller's requested size so the SVG <image> can sit at 1:1
    # and its preserveAspectRatio="none" becomes a no-op instead of a stretch.
    if req.targetWidth and req.targetHeight:
        target = (max(1, int(req.targetWidth)), max(1, int(req.targetHeight)))
        if destination.size != target:
            destination = destination.resize(target, Image.LANCZOS)

    # Stage 1 -- destination mask and its pixel density.
    seg = segmenter.segmenter.segment(destination)
    if seg.is_empty:
        # No garment recognised: fall back to covering the whole frame rather
        # than returning an empty image, and say so in the response.
        mask = np.ones((destination.size[1], destination.size[0]), dtype=bool)
    else:
        mask = seg.mask

    # Stage 3 -- isotropic tiling at a fixed pixels-per-centimetre ratio.
    tile_w, tile_h, ratio = compositor.compute_tile_size(
        crop_width=int(round(req.cropWidth)),
        crop_height=int(round(req.cropHeight)),
        src_px_per_cm=req.srcPxPerCm,
        dst_px_per_cm=seg.px_per_cm,
        multiplier=req.multiplier,
    )

    # Stage 4 -- photometric blend against the destination's own shading.
    out = compositor.composite(
        swatch=swatch,
        destination=destination,
        mask=mask,
        tile_w=tile_w,
        tile_h=tile_h,
        shading_strength=req.shadingStrength,
        feather_px=req.featherPx,
    )

    canvas_w, canvas_h = destination.size
    return {
        "imageDataUrl": _encode_data_url(out),
        "width": canvas_w,
        "height": canvas_h,
        "tileWidth": tile_w,
        "tileHeight": tile_h,
        "repeatsX": round(canvas_w / tile_w, 3),
        "repeatsY": round(canvas_h / tile_h, 3),
        "scaleRatio": round(ratio, 6),
        "dstPxPerCm": round(seg.px_per_cm, 6),
        "destGarment": seg.label,
        "destGarmentFound": not seg.is_empty and seg.class_id != 0,
        "destSilhouette": seg.silhouette,
        "destLandmark": seg.landmark,
        "destScaleConfidence": seg.scale_confidence,
        "destScaleNote": seg.scale_note,
        "destCoverage": round(seg.coverage, 4),
        "segmentSeconds": seg.inference_seconds,
    }
