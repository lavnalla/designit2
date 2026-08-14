#!/usr/bin/env python3
"""
Isolated proof-of-concept for sayeed99/segformer-b3-fashion.

Does NOT touch the Next.js app. Run from fashion-segmentation-test/.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
from PIL import Image
from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor

from labels import ID2LABEL, normalize_id2label

MODEL_ID = "sayeed99/segformer-b3-fashion"
ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "inputs" / "test.jpg"
DEFAULT_OUTPUT_DIR = ROOT / "outputs"


def pick_device(preferred: str | None = None) -> torch.device:
    """
    Choose inference device.

    Note: on this Mac, MPS produced noisy/incorrect SegFormer masks in testing,
    so we default to CPU unless the user explicitly requests another device.
    """
    if preferred:
        return torch.device(preferred)
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def process_rss_bytes() -> int | None:
    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes; Linux reports kilobytes
        if sys.platform == "darwin":
            return int(usage)
        return int(usage) * 1024
    except Exception:  # noqa: BLE001
        return None


def format_bytes(num: float) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(num)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.2f} {unit}"
        value /= 1024
    return f"{num:.0f} B"


def estimate_param_memory(model: torch.nn.Module) -> dict[str, float]:
    total_params = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    # float32 weights ≈ 4 bytes / param
    bytes_fp32 = total_params * 4
    bytes_fp16 = total_params * 2
    return {
        "total_params": float(total_params),
        "trainable_params": float(trainable),
        "weights_fp32_bytes": float(bytes_fp32),
        "weights_fp16_bytes": float(bytes_fp16),
    }


def colorize_mask(seg: np.ndarray, id2label: dict[int, str]) -> np.ndarray:
    """Map class ids to distinct RGB colors (deterministic)."""
    rng = np.random.default_rng(42)
    max_id = max(int(seg.max()), max(id2label.keys(), default=0))
    palette = np.zeros((max_id + 1, 3), dtype=np.uint8)
    palette[0] = (20, 20, 20)  # Unlabelled / background
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
        label = id2label.get(int(class_id), f"class_{class_id}")
        rows.append(
            {
                "id": int(class_id),
                "label": label,
                "pixels": int(count),
                "percent": round(100.0 * count / total, 3),
            }
        )
    return rows


def save_visualization(
    image: Image.Image,
    seg: np.ndarray,
    id2label: dict[int, str],
    detections: list[dict],
    output_dir: Path,
) -> dict[str, str]:
    color_mask = colorize_mask(seg, id2label)
    overlay = overlay_mask(image, color_mask)

    mask_path = output_dir / "segmentation_mask.png"
    overlay_path = output_dir / "segmentation_overlay.png"
    panel_path = output_dir / "segmentation_panel.png"
    pred_path = output_dir / "pred_class_ids.npy"

    Image.fromarray(color_mask).save(mask_path)
    overlay.save(overlay_path)
    np.save(pred_path, seg.astype(np.int32))

    # Panel with legend (clean version)
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    axes[0].imshow(image)
    axes[0].set_title("Input")
    axes[0].axis("off")
    axes[1].imshow(color_mask)
    axes[1].set_title("Segmentation mask")
    axes[1].axis("off")
    axes[2].imshow(overlay)
    axes[2].set_title("Overlay")
    axes[2].axis("off")

    legend_items = [d for d in detections if d["id"] != 0 and d["percent"] >= 0.05]
    if legend_items:
        rng = np.random.default_rng(42)
        palette = {0: (20 / 255, 20 / 255, 20 / 255)}
        for class_id in range(1, max(id2label.keys()) + 1):
            palette[class_id] = tuple((rng.integers(40, 255, size=3) / 255.0).tolist())
        handles = [plt.Rectangle((0, 0), 1, 1, color=palette[d["id"]]) for d in legend_items[:18]]
        labels = [f"{d['label']} ({d['percent']}%)" for d in legend_items[:18]]
        fig.legend(handles, labels, loc="lower center", ncol=3, fontsize=8, frameon=False)
        fig.tight_layout(rect=(0, 0.14, 1, 1))
    else:
        fig.tight_layout()

    fig.savefig(panel_path, dpi=140, bbox_inches="tight")
    plt.close(fig)

    return {
        "mask": str(mask_path),
        "overlay": str(overlay_path),
        "panel": str(panel_path),
        "pred_ids": str(pred_path),
    }


def run_inference(image_path: Path, output_dir: Path, device_name: str | None = None) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    device = pick_device(device_name)

    print(f"Device: {device}")
    print(f"Loading model: {MODEL_ID}")

    load_start = time.perf_counter()
    processor = SegformerImageProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForSemanticSegmentation.from_pretrained(MODEL_ID)
    model.to(device)
    model.eval()
    load_s = time.perf_counter() - load_start

    id2label = normalize_id2label(getattr(model.config, "id2label", None))
    mem = estimate_param_memory(model)
    rss_after_load = process_rss_bytes()

    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    print(f"Input image: {image_path} ({width}x{height})")

    inputs = processor(images=image, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    # Warmup
    with torch.inference_mode():
        _ = model(**inputs)

    if device.type == "cuda":
        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()
    elif device.type == "mps" and hasattr(torch, "mps"):
        torch.mps.synchronize()

    infer_start = time.perf_counter()
    with torch.inference_mode():
        outputs = model(**inputs)
        logits = outputs.logits  # (batch, num_labels, H/4, W/4)
        upsampled = torch.nn.functional.interpolate(
            logits,
            size=image.size[::-1],  # (height, width)
            mode="bilinear",
            align_corners=False,
        )
        pred = upsampled.argmax(dim=1)[0]
    if device.type == "cuda":
        torch.cuda.synchronize()
    elif device.type == "mps" and hasattr(torch, "mps"):
        torch.mps.synchronize()
    infer_s = time.perf_counter() - infer_start

    seg = pred.detach().cpu().numpy().astype(np.int32)
    detections = summarize_detections(seg, id2label)
    paths = save_visualization(image, seg, id2label, detections, output_dir)

    peak_cuda_bytes = None
    if device.type == "cuda":
        peak_cuda_bytes = float(torch.cuda.max_memory_allocated())

    rss_after_infer = process_rss_bytes()

    report = {
        "model_id": MODEL_ID,
        "device": str(device),
        "image": str(image_path),
        "image_size": {"width": width, "height": height},
        "num_labels": int(getattr(model.config, "num_labels", len(id2label))),
        "id2label": {str(k): v for k, v in sorted(id2label.items())},
        "load_seconds": round(load_s, 3),
        "inference_seconds": round(infer_s, 3),
        "params": {
            "total": int(mem["total_params"]),
            "trainable": int(mem["trainable_params"]),
            "weights_fp32": format_bytes(mem["weights_fp32_bytes"]),
            "weights_fp16": format_bytes(mem["weights_fp16_bytes"]),
            "weights_fp32_bytes": int(mem["weights_fp32_bytes"]),
            "weights_fp16_bytes": int(mem["weights_fp16_bytes"]),
        },
        "peak_cuda_allocated": format_bytes(peak_cuda_bytes) if peak_cuda_bytes is not None else None,
        "process_rss_after_load": format_bytes(rss_after_load) if rss_after_load else None,
        "process_rss_after_infer": format_bytes(rss_after_infer) if rss_after_infer else None,
        "detections": detections,
        "outputs": paths,
        "notes": [
            "Default device is CPU on macOS; MPS was observed to produce noisy SegFormer masks.",
            "Use --device mps or --device cuda to override.",
        ],
    }

    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["report_path"] = str(report_path)
    return report


def ensure_sample_image(path: Path) -> None:
    """Create a simple synthetic fashion-like image if no test image exists."""
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    # Minimal geometric stand-in so the script is runnable without network.
    img = Image.new("RGB", (512, 768), (240, 240, 245))
    # torso block
    for y in range(180, 520):
        for x in range(160, 352):
            img.putpixel((x, y), (40, 90, 180))
    # pants block
    for y in range(520, 720):
        for x in range(170, 342):
            img.putpixel((x, y), (30, 30, 40))
    # head
    for y in range(80, 170):
        for x in range(210, 300):
            if (x - 255) ** 2 + (y - 125) ** 2 < 45**2:
                img.putpixel((x, y), (220, 180, 150))
    img.save(path)
    print(f"Created synthetic sample image at {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="SegFormer fashion segmentation PoC")
    parser.add_argument("--image", type=Path, default=DEFAULT_INPUT, help="Path to local test image")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory")
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Force device: cpu | cuda | mps (default: cuda if available else cpu)",
    )
    args = parser.parse_args()

    try:
        if not args.image.exists():
            ensure_sample_image(args.image)
        report = run_inference(args.image, args.output_dir, args.device)
    except Exception as exc:  # noqa: BLE001
        print("ERROR:", exc)
        traceback.print_exc()
        return 1

    print("\n=== Fashion segmentation PoC ===")
    print(f"Model: {report['model_id']}")
    print(f"Device: {report['device']}")
    print(f"Load time: {report['load_seconds']} s")
    print(f"Inference time: {report['inference_seconds']} s")
    print(
        f"Params: {report['params']['total']:,} "
        f"(~{report['params']['weights_fp32']} fp32 / ~{report['params']['weights_fp16']} fp16)"
    )
    if report.get("process_rss_after_infer"):
        print(f"Process RSS after infer: {report['process_rss_after_infer']}")
    if report["peak_cuda_allocated"]:
        print(f"Peak CUDA memory: {report['peak_cuda_allocated']}")
    print("\nDetected classes (≥0.05%):")
    for row in report["detections"]:
        if row["id"] == 0 or row["percent"] < 0.05:
            continue
        print(f"  [{row['id']:2d}] {row['label']}: {row['percent']}%")
    print("\nSaved:")
    for key, path in report["outputs"].items():
        print(f"  {key}: {path}")
    print(f"  report: {report['report_path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
