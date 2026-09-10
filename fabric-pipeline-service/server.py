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
import json
import os
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

import compositor
import delight
import patch
import rectify
import runtime
import segmenter

SERVICE_DIR = Path(__file__).resolve().parent

# Device, thread count and quality tier for this process (see runtime.py).
PROFILE = runtime.resolve()
if os.environ.get("FABRIC_DEVICE"):
    # The module-level singletons pick CUDA when present; honour an override.
    segmenter.segmenter = segmenter.GarmentSegmenter(PROFILE.device)
    rectify.rectifier = rectify.TextureRectifier(PROFILE.device)

# Optional shared secret. When set, every route except /health requires
# `Authorization: Bearer <token>`. Needed the moment the service is reachable
# from anywhere but localhost.
SERVICE_TOKEN = os.environ.get("FABRIC_SERVICE_TOKEN", "").strip()

# Swatches also go to disk so a restart (or a laptop that was closed) does not
# recompute them. One small JSON file per key.
CACHE_DIR = Path(os.environ.get("FABRIC_CACHE_DIR") or SERVICE_DIR / "cache")

# Bundled template garments are flattened in the background at startup so the
# copies users are most likely to try first are instant even on CPU. Set
# FABRIC_PREWARM=0 to skip (e.g. in tests).
PREWARM = os.environ.get("FABRIC_PREWARM", "1").strip().lower() not in ("0", "false", "no")
TEMPLATE_DIR = SERVICE_DIR.parent / "public" / "templates"
_prewarm_state: dict = {"status": "pending" if PREWARM else "disabled", "done": [], "errors": []}

MAX_IMAGE_BYTES = 16 * 1024 * 1024

# Flattening is the expensive stage (~2-5s on a 3070), and the same crop gets
# pasted onto many targets, so the swatch is cached by content hash.
SWATCH_CACHE_SIZE = 64
_swatch_cache: "OrderedDict[str, dict]" = OrderedDict()

# One model call at a time. FastAPI runs sync handlers on a thread pool and
# the pre-warm runs on its own thread; on a CPU box two concurrent UNet
# passes each take twice as long, so serialising them costs nothing overall
# and keeps a user's copy from being slowed by the background work.
_infer_lock = threading.Lock()


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


def _disk_cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def _disk_cache_get(key: str) -> dict | None:
    path = _disk_cache_path(key)
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _disk_cache_put(key: str, value: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = _disk_cache_path(key).with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(value, fh)
        tmp.replace(_disk_cache_path(key))
    except OSError:
        # A read-only or full disk must not break a copy.
        pass


def _disk_cache_count() -> int:
    try:
        return sum(1 for _ in CACHE_DIR.glob("*.json"))
    except OSError:
        return 0


# Perceptual-hash cache keys.
#
# The browser re-encodes the source through a canvas (bounded, JPEG), so the
# bytes it sends never match what PIL decodes from the same file on disk, and
# even the patch chooser can land a pixel or two elsewhere. Hashing the crop's
# content therefore missed every pre-warmed template. The key is instead a
# 64-bit difference hash of the *whole source image* (robust to re-encoding
# and resizing) plus the selection rectangle rounded to a 2% grid, and
# lookups accept a small Hamming distance rather than demanding equality.
DHASH_MAX_DISTANCE = 4


def _dhash(image: Image.Image) -> int:
    small = image.convert("L").resize((9, 8), Image.LANCZOS)
    arr = np.asarray(small, dtype=np.int16)
    bits = (arr[:, 1:] > arr[:, :-1]).flatten()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return value


def _rect_bucket(requested: tuple[int, int, int, int] | None, size: tuple[int, int]) -> str:
    if requested is None:
        return "none"
    w, h = max(1, size[0]), max(1, size[1])
    return ",".join(f"{v:.2f}" for v in (requested[0] / w, requested[1] / h, requested[2] / w, requested[3] / h))


def _params_hash(params: str) -> str:
    return hashlib.sha256(params.encode()).hexdigest()[:24]


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _cache_lookup(params_hash: str, phash: int) -> tuple[str, dict] | None:
    """Nearest hash within DHASH_MAX_DISTANCE, memory first then disk."""
    best: tuple[int, str, dict] | None = None
    for key, entry in _swatch_cache.items():
        if not key.startswith(params_hash + "-"):
            continue
        d = _hamming(int(key.rsplit("-", 1)[1], 16), phash)
        if d <= DHASH_MAX_DISTANCE and (best is None or d < best[0]):
            best = (d, key, entry)
    if best is None:
        try:
            for path in CACHE_DIR.glob(f"{params_hash}-*.json"):
                d = _hamming(int(path.stem.rsplit("-", 1)[1], 16), phash)
                if d <= DHASH_MAX_DISTANCE and (best is None or d < best[0]):
                    entry = _disk_cache_get(path.stem)
                    if entry:
                        best = (d, path.stem, entry)
        except OSError:
            pass
    if best is None:
        return None
    _cache_put(best[1], best[2])
    return best[1], best[2]


def _prewarm_templates() -> None:
    """Flatten every bundled template garment once, in the background."""
    _prewarm_state["status"] = "running"
    try:
        segmenter.segmenter.load()
        if PROFILE.uses_diffusion:
            rectify.rectifier.load()
        files = sorted(TEMPLATE_DIR.glob("*.jpg")) + sorted(TEMPLATE_DIR.glob("*.png"))
        for path in files:
            try:
                image = Image.open(path).convert("RGB")
                result = _copy_from_image(
                    image, None, seed=None, seam_blend_px=0, do_rectify=True, do_delight=True, quality=None
                )
                _prewarm_state["done"].append(
                    {"file": path.name, "cached": result["fromCache"], "seconds": result["rectifySeconds"]}
                )
            except Exception as error:  # noqa: BLE001 -- one bad template must not stop the rest
                _prewarm_state["errors"].append(f"{path.name}: {error}")
        _prewarm_state["status"] = "done"
    except Exception as error:  # noqa: BLE001
        _prewarm_state["status"] = f"failed: {error}"


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if PREWARM:
        threading.Thread(target=_prewarm_templates, name="fabric-prewarm", daemon=True).start()
    yield


app = FastAPI(
    title="Fabric Pipeline Service",
    description="Segment -> rectify -> isotropic tile -> photometric blend.",
    version="1.1.0",
    lifespan=_lifespan,
)


@app.middleware("http")
async def _require_token(request, call_next):
    if SERVICE_TOKEN and request.url.path != "/health" and request.method != "OPTIONS":
        if request.headers.get("authorization", "") != f"Bearer {SERVICE_TOKEN}":
            from fastapi.responses import JSONResponse

            return JSONResponse(
                {"error": "Unauthorized", "hint": "Set FABRIC_SERVICE_TOKEN on both the service and the Next.js app."},
                status_code=401,
            )
    return await call_next(request)

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
    # Divide out the lighting that survives rectification (see delight.py).
    # Off only for A/B measurement.
    delight: bool = True
    # Override the quality tier for this request: full | fast | classic.
    # None means the server's resolved profile (see runtime.py and /health).
    quality: str | None = None


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
        "disk_cache": {"dir": str(CACHE_DIR), "entries": _disk_cache_count()},
        "profile": PROFILE.as_dict(),
        "prewarm": _prewarm_state,
        "auth": "token" if SERVICE_TOKEN else "none",
    }


@app.post("/warm")
def warm() -> dict:
    """Load both models up front so the first real request is not a cold start."""
    start = time.perf_counter()
    segmenter.segmenter.load()
    if PROFILE.uses_diffusion:
        rectify.rectifier.load()
    return {"ok": True, "seconds": round(time.perf_counter() - start, 3), "quality": PROFILE.quality}


def _copy_from_image(
    source: Image.Image,
    requested: tuple[int, int, int, int] | None,
    seed: int | None,
    seam_blend_px: int,
    do_rectify: bool,
    do_delight: bool,
    quality: str | None,
) -> dict:
    """Stages 1-2(b) on a decoded image. Shared by /copy and the pre-warm."""
    profile = runtime.resolve(quality) if quality else PROFILE
    full_w, full_h = source.size

    # Stage 1 -- the source garment's mask and pixel density. The selection is
    # passed in so that on a photo of someone wearing several garments, the
    # region the user dragged over decides which one is meant.
    with _infer_lock:
        seg = segmenter.segmenter.segment(source, focus_rect=requested)

    # Only sample from pixels that are actually cloth. A crop that catches the
    # neckline, a strap or the backdrop gets flattened along with the fabric
    # and then tiled, which bands the target with background instead of weave.
    choice = patch.choose_patch(seg.mask, requested, image=np.asarray(source))
    crop = source.crop(choice.rect)

    crop_w, crop_h = crop.size
    if crop_w < 8 or crop_h < 8:
        raise HTTPException(status_code=400, detail="Selection is too small to sample fabric from")

    # Stage 2 -- flatten, cached by (tolerant) crop content plus every
    # parameter that changes the output.
    tier = profile.quality if do_rectify else "raw"
    params = (
        f"{seed}|{seam_blend_px}|{tier}|{profile.steps}|{profile.guidance_scale}|"
        f"{profile.image_guidance_scale}|{do_delight}|rect={_rect_bucket(requested, source.size)}"
    )
    params_hash = _params_hash(params)
    phash = _dhash(source)
    cache_key = f"{params_hash}-{phash:016x}"

    hit = _cache_lookup(params_hash, phash)
    if hit:
        cache_key, cached = hit
        swatch_data_url = cached["swatchDataUrl"]
        rectify_seconds = 0.0
        from_cache = True
    else:
        start = time.perf_counter()
        if not do_rectify:
            swatch_image = crop.resize((rectify.PATCH_SIZE, rectify.PATCH_SIZE), Image.LANCZOS)
        elif not profile.uses_diffusion:
            # `classic` tier: delight + seam blend, no model.
            swatch_image = delight.classic_swatch(crop, rectify.PATCH_SIZE)
        else:
            with _infer_lock:
                result = rectify.rectifier.flatten(
                    crop,
                    n_samples=1,
                    seed=seed,
                    seam_blend_px=seam_blend_px,
                    steps=profile.steps,
                    guidance_scale=profile.guidance_scale,
                    image_guidance_scale=profile.image_guidance_scale,
                )
            swatch_image = result.swatch
        # Stage 2b -- strip the lighting the diffusion left behind, so the
        # swatch carries pattern and colour only and takes all of its shading
        # from the destination at paste time. (classic_swatch already did.)
        if do_delight and (not do_rectify or profile.uses_diffusion):
            swatch_image = delight.delight(swatch_image)
        rectify_seconds = round(time.perf_counter() - start, 3)
        swatch_data_url = _encode_data_url(swatch_image)
        entry = {"swatchDataUrl": swatch_data_url}
        _cache_put(cache_key, entry)
        _disk_cache_put(cache_key, entry)
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
        "rectified": do_rectify,
        "delighted": do_delight,
        "quality": tier,
        "device": profile.device,
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


@app.post("/copy")
def copy_fabric(req: CopyRequest) -> dict:
    """Stages 1-2: segment the source for scale, then flatten the crop."""
    source = _decode_data_url(req.imageDataUrl).convert("RGB")

    requested = None
    if req.rect:
        requested = (
            int(round(req.rect.x)),
            int(round(req.rect.y)),
            int(round(req.rect.x + req.rect.width)),
            int(round(req.rect.y + req.rect.height)),
        )

    quality = req.quality.lower() if req.quality else None
    if quality is not None and quality not in runtime.QUALITY_TIERS:
        raise HTTPException(status_code=400, detail=f"quality must be one of {runtime.QUALITY_TIERS}")

    return _copy_from_image(
        source, requested, seed=req.seed, seam_blend_px=req.seamBlendPx,
        do_rectify=req.rectify, do_delight=req.delight, quality=quality,
    )


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
    with _infer_lock:
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
