"""Shared SegFormer fashion segmentation inference for the local API service."""

from __future__ import annotations

import base64
import io
import time
from dataclasses import dataclass

import numpy as np
import torch
from PIL import Image
from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor

from labels import normalize_id2label

MODEL_ID = "sayeed99/segformer-b3-fashion"


def pick_device(preferred: str | None = None) -> torch.device:
    if preferred:
        return torch.device(preferred)
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def colorize_mask(seg: np.ndarray, id2label: dict[int, str]) -> np.ndarray:
    rng = np.random.default_rng(42)
    max_id = max(int(seg.max()), max(id2label.keys(), default=0))
    palette = np.zeros((max_id + 1, 3), dtype=np.uint8)
    palette[0] = (20, 20, 20)
    for class_id in range(1, max_id + 1):
        palette[class_id] = rng.integers(40, 255, size=3, dtype=np.uint8)
    return palette[seg]


def overlay_mask(image: Image.Image, color_mask: np.ndarray, alpha: float = 0.55) -> Image.Image:
    base = np.asarray(image.convert("RGB"), dtype=np.float32)
    overlay = color_mask.astype(np.float32)
    blended = (1.0 - alpha) * base + alpha * overlay
    return Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8))


def summarize_detections(seg: np.ndarray, id2label: dict[int, str]) -> list[dict]:
    total = seg.size
    present, counts = np.unique(seg, return_counts=True)
    rows: list[dict] = []
    for class_id, count in sorted(zip(present.tolist(), counts.tolist()), key=lambda x: -x[1]):
        rows.append(
            {
                "id": int(class_id),
                "label": id2label.get(int(class_id), f"class_{class_id}"),
                "pixels": int(count),
                "percent": round(100.0 * count / total, 3),
            }
        )
    return rows


def image_to_data_url(image: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    image.save(buf, format=fmt)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "image/png" if fmt.upper() == "PNG" else f"image/{fmt.lower()}"
    return f"data:{mime};base64,{b64}"


@dataclass
class SegmentResult:
    detections: list[dict]
    mask_data_url: str
    overlay_data_url: str
    original_data_url: str
    inference_seconds: float
    device: str
    image_size: dict[str, int]
    model_id: str


class FashionSegmenter:
    def __init__(self, device_name: str | None = None) -> None:
        self.device = pick_device(device_name)
        self.processor: SegformerImageProcessor | None = None
        self.model: AutoModelForSemanticSegmentation | None = None
        self.id2label: dict[int, str] = {}
        self.ready = False
        self.load_seconds: float | None = None

    def load(self) -> None:
        if self.ready:
            return
        start = time.perf_counter()
        self.processor = SegformerImageProcessor.from_pretrained(MODEL_ID)
        self.model = AutoModelForSemanticSegmentation.from_pretrained(MODEL_ID)
        self.model.to(self.device)
        self.model.eval()
        self.id2label = normalize_id2label(getattr(self.model.config, "id2label", None))
        self.load_seconds = time.perf_counter() - start
        self.ready = True

    def segment(self, image: Image.Image) -> SegmentResult:
        self.load()
        assert self.processor is not None and self.model is not None

        rgb = image.convert("RGB")
        width, height = rgb.size
        inputs = self.processor(images=rgb, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        start = time.perf_counter()
        with torch.inference_mode():
            outputs = self.model(**inputs)
            upsampled = torch.nn.functional.interpolate(
                outputs.logits,
                size=rgb.size[::-1],
                mode="bilinear",
                align_corners=False,
            )
            pred = upsampled.argmax(dim=1)[0]
        infer_s = time.perf_counter() - start

        seg = pred.detach().cpu().numpy().astype(np.int32)
        color_mask = colorize_mask(seg, self.id2label)
        overlay = overlay_mask(rgb, color_mask)
        detections = summarize_detections(seg, self.id2label)

        return SegmentResult(
            detections=detections,
            mask_data_url=image_to_data_url(Image.fromarray(color_mask)),
            overlay_data_url=image_to_data_url(overlay),
            original_data_url=image_to_data_url(rgb),
            inference_seconds=round(infer_s, 3),
            device=str(self.device),
            image_size={"width": width, "height": height},
            model_id=MODEL_ID,
        )


segmenter = FashionSegmenter()
