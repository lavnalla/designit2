"""
Local FastAPI service for sayeed99/segformer-b3-fashion.

Run (from repo root, inside the project venv):
  pip install -r fashion-segmentation-test/requirements.txt -r fashion-segmentation-service/requirements.txt
  python -m uvicorn server:app --app-dir fashion-segmentation-service --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps

from inference import MODEL_ID, segmenter


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Eager-load model so the first request is not a multi-second cold start.
    segmenter.load()
    yield


app = FastAPI(
    title="Fashion Segmentation Service",
    description="Local SegFormer fashion segmentation for DesignIt try-on.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "ready": segmenter.ready,
        "model_id": MODEL_ID,
        "device": str(segmenter.device),
        "load_seconds": segmenter.load_seconds,
    }


@app.post("/segment")
def segment(file: UploadFile = File(...)):
    # Deliberately sync: FastAPI runs plain `def` handlers in a threadpool, so the
    # multi-second torch forward pass never blocks the event loop. As `async def` it
    # starved every other request for the whole inference — including /health, which
    # the Next.js proxy polls with a 4s timeout and then reports "service offline".
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload an image file (jpeg/png/webp).")

    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 12MB).")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        # Browsers apply EXIF orientation when they render the preview, PIL does not.
        # Without this a portrait phone photo is segmented sideways, so the mask,
        # overlay and image_size all disagree with what the user saw.
        image = ImageOps.exif_transpose(image)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read image: {exc}") from exc

    try:
        result = segmenter.segment(image)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {exc}") from exc

    # Keep payload lean: skip near-zero background noise in UI list, but include all in full.
    visible = [d for d in result.detections if d["id"] != 0 and d["percent"] >= 0.05]

    return {
        "model_id": result.model_id,
        "device": result.device,
        "inference_seconds": result.inference_seconds,
        "image_size": result.image_size,
        "detections": visible,
        "detections_all": result.detections,
        "mask_data_url": result.mask_data_url,
        "overlay_data_url": result.overlay_data_url,
    }
