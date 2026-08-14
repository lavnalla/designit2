"""
Local FastAPI service for sayeed99/segformer-b3-fashion.

Run (from repo root):
  fashion-segmentation-test/.venv/bin/pip install fastapi uvicorn python-multipart
  fashion-segmentation-test/.venv/bin/uvicorn server:app --app-dir fashion-segmentation-service --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

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
async def segment(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload an image file (jpeg/png/webp).")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 12MB).")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
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
        "original_data_url": result.original_data_url,
        "mask_data_url": result.mask_data_url,
        "overlay_data_url": result.overlay_data_url,
    }
