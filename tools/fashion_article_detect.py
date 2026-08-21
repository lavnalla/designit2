import base64
import io
import json
import os
import sys
from typing import Any

import numpy as np
from PIL import Image
import torch.nn.functional as F
from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor

MODEL_NAME = os.environ.get("FASHION_SEGMENTATION_MODEL", "sayeed99/segformer-b3-fashion")
MIN_PIXELS = 800

BASE_CMAP_RGBA = [
    (0.12156862745098039, 0.4666666666666667, 0.7058823529411765, 1.0),
    (0.6823529411764706, 0.7803921568627451, 0.9098039215686274, 1.0),
    (1.0, 0.4980392156862745, 0.054901960784313725, 1.0),
    (1.0, 0.7333333333333333, 0.47058823529411764, 1.0),
    (0.17254901960784313, 0.6274509803921569, 0.17254901960784313, 1.0),
    (0.596078431372549, 0.8745098039215686, 0.5411764705882353, 1.0),
    (0.8392156862745098, 0.15294117647058825, 0.1568627450980392, 1.0),
    (1.0, 0.596078431372549, 0.5882352941176471, 1.0),
    (0.5803921568627451, 0.403921568627451, 0.7411764705882353, 1.0),
    (0.7725490196078432, 0.6901960784313725, 0.8352941176470589, 1.0),
    (0.5490196078431373, 0.33725490196078434, 0.29411764705882354, 1.0),
    (0.7686274509803922, 0.611764705882353, 0.5803921568627451, 1.0),
    (0.8901960784313725, 0.4666666666666667, 0.7607843137254902, 1.0),
    (0.9686274509803922, 0.7137254901960784, 0.8235294117647058, 1.0),
    (0.4980392156862745, 0.4980392156862745, 0.4980392156862745, 1.0),
    (0.7803921568627451, 0.7803921568627451, 0.7803921568627451, 1.0),
    (0.7372549019607844, 0.7411764705882353, 0.13333333333333333, 1.0),
    (0.8588235294117647, 0.8588235294117647, 0.5529411764705883, 1.0),
    (0.09019607843137255, 0.7450980392156863, 0.8117647058823529, 1.0),
    (0.6196078431372549, 0.8549019607843137, 0.8980392156862745, 1.0),
]

NON_GARMENT_LABELS = {
    "background",
    "unlabelled",
    "hat",
    "hair",
    "sunglasses",
    "face",
    "left arm",
    "right arm",
    "left leg",
    "right leg",
    "left shoe",
    "right shoe",
    "scarf",
    "bag",
}

MODEL = None
PROCESSOR = None


def build_custom_colors(id2label: dict[int, str]) -> list[tuple[float, float, float, float]]:
    num_classes = len(id2label)
    custom_colors = [BASE_CMAP_RGBA[i % len(BASE_CMAP_RGBA)] for i in range(num_classes)]

    for idx, label_name in id2label.items():
        name_lower = label_name.lower()
        if "sleeve" in name_lower:
            custom_colors[idx] = (1.0, 0.5, 0.0, 1.0)
        elif "coat" in name_lower:
            custom_colors[idx] = (0.0, 0.5, 0.0, 1.0)
        elif "shoulder" in name_lower or "epaulette" in name_lower:
            custom_colors[idx] = (1.0, 0.0, 0.0, 1.0)
        elif "t-shirt" in name_lower or "shirt" in name_lower or "top" in name_lower:
            custom_colors[idx] = (1.0, 0.41, 0.71, 1.0)

    return custom_colors


def ensure_model() -> tuple[SegformerImageProcessor, AutoModelForSemanticSegmentation]:
    global MODEL, PROCESSOR
    if MODEL is None or PROCESSOR is None:
        PROCESSOR = SegformerImageProcessor.from_pretrained(MODEL_NAME)
        MODEL = AutoModelForSemanticSegmentation.from_pretrained(MODEL_NAME)
    return PROCESSOR, MODEL


def decode_image(data_url: str) -> Image.Image:
    if not data_url.startswith("data:image/"):
        raise ValueError("Expected image data URL")

    _, encoded = data_url.split(",", 1)
    binary = base64.b64decode(encoded)
    return Image.open(io.BytesIO(binary)).convert("RGBA")


def encode_image(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('utf-8')}"


def normalize_label(label: str) -> str:
    return label.strip().lower().replace("_", " ")


def pretty_label(label: str) -> str:
    return label.replace("_", " ").title()


def process_payload(payload: dict[str, Any]) -> dict[str, Any]:
    image_data_url = payload.get("imageDataUrl")
    if not image_data_url:
        raise ValueError("Missing imageDataUrl")

    image = decode_image(image_data_url)
    rgb_image = image.convert("RGB")
    processor, model = ensure_model()
    inputs = processor(images=rgb_image, return_tensors="pt")
    outputs = model(**inputs)
    logits = outputs.logits.cpu()

    upsampled_logits = F.interpolate(
        logits,
        size=rgb_image.size[::-1],
        mode="bilinear",
        align_corners=False,
    )
    pred_seg = upsampled_logits.argmax(dim=1)[0].numpy()

    id2label: dict[int, str] = {int(k): v for k, v in model.config.id2label.items()}
    custom_colors = build_custom_colors(id2label)
    articles: list[dict[str, Any]] = []

    for class_id in np.unique(pred_seg):
        label = id2label.get(int(class_id), "")
        if not label:
            continue

        normalized = normalize_label(label)
        if normalized in NON_GARMENT_LABELS:
            continue

        mask = pred_seg == class_id
        if int(mask.sum()) < MIN_PIXELS:
            continue

        ys, xs = np.where(mask)
        min_x = int(xs.min())
        max_x = int(xs.max())
        min_y = int(ys.min())
        max_y = int(ys.max())

        crop = image.crop((min_x, min_y, max_x + 1, max_y + 1))
        crop_np = np.array(crop)
        alpha_mask = mask[min_y:max_y + 1, min_x:max_x + 1]
        crop_np[..., 3] = np.where(alpha_mask, crop_np[..., 3], 0)
        masked = Image.fromarray(crop_np, mode="RGBA")

        articles.append(
            {
                "id": f"article-{int(class_id)}",
                "label": pretty_label(label),
                "rawLabel": label,
                "classId": int(class_id),
                "color": {
                    "r": custom_colors[int(class_id)][0],
                    "g": custom_colors[int(class_id)][1],
                    "b": custom_colors[int(class_id)][2],
                    "a": custom_colors[int(class_id)][3],
                },
                "imageDataUrl": encode_image(masked),
                "bounds": {
                    "x": min_x,
                    "y": min_y,
                    "width": max_x - min_x + 1,
                    "height": max_y - min_y + 1,
                },
                "pixelCount": int(mask.sum()),
            }
        )

    articles.sort(key=lambda item: item["pixelCount"], reverse=True)
    return {"articles": articles}


def run_once() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw)
    print(json.dumps(process_payload(payload)))


def run_worker() -> None:
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue

        try:
            payload = json.loads(raw)
            print(json.dumps(process_payload(payload)), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)}), flush=True)


def main() -> None:
    if "--worker" in sys.argv:
        run_worker()
        return

    run_once()


if __name__ == "__main__":
    main()
