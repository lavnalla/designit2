#!/usr/bin/env python3
import base64
import io
import json
import sys

from PIL import Image, ImageEnhance, ImageFilter


def decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("Invalid data URL")
    header, encoded = data_url.split(",", 1)
    if "base64" not in header:
        raise ValueError("Only base64 data URLs are supported")
    return base64.b64decode(encoded)


def encode_png_data_url(image: Image.Image) -> str:
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=False)
    encoded = base64.b64encode(out.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def resize_with_pillow(image: Image.Image, width: int, height: int) -> Image.Image:
    src_w, src_h = image.size
    scale = max(width / max(1, src_w), height / max(1, src_h))

    # Two-pass strategy: work at larger internal size, then downsample for cleaner edges.
    work_mult = 1.8 if scale > 1.0 else 1.2
    work_w = max(width, int(round(width * work_mult)))
    work_h = max(height, int(round(height * work_mult)))

    working = image.resize((work_w, work_h), Image.Resampling.LANCZOS)
    if scale > 1.0:
        working = working.filter(ImageFilter.UnsharpMask(radius=1.8, percent=170, threshold=2))
        working = ImageEnhance.Contrast(working).enhance(1.04)

    final = working.resize((width, height), Image.Resampling.LANCZOS)
    final = final.filter(ImageFilter.UnsharpMask(radius=0.9, percent=120, threshold=1))
    return final


def resize_with_opencv(image: Image.Image, width: int, height: int):
    try:
        import cv2
        import numpy as np
    except Exception:
        return None

    rgba = np.array(image.convert("RGBA"))
    src_h, src_w = rgba.shape[:2]
    scale = max(width / max(1, src_w), height / max(1, src_h))

    # Work at higher internal resolution, then downsample to target.
    work_mult = 1.8 if scale > 1.0 else 1.15
    work_w = max(width, int(round(width * work_mult)))
    work_h = max(height, int(round(height * work_mult)))

    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]

    up_interp = cv2.INTER_LANCZOS4 if scale > 1.0 else cv2.INTER_AREA
    rgb_work = cv2.resize(rgb, (work_w, work_h), interpolation=up_interp)
    alpha_work = cv2.resize(alpha, (work_w, work_h), interpolation=cv2.INTER_LINEAR)

    if scale > 1.0:
        # Edge-aware cleanup and detail boost for enlarged textures.
        rgb_work = cv2.bilateralFilter(rgb_work, d=0, sigmaColor=24, sigmaSpace=7)
        blur = cv2.GaussianBlur(rgb_work, (0, 0), sigmaX=1.2)
        detail = cv2.subtract(rgb_work, blur)
        rgb_work = cv2.addWeighted(rgb_work, 1.0, detail, 0.42, 0)

    # Final precise downsample to target and a gentle final sharpen.
    rgb_final = cv2.resize(rgb_work, (width, height), interpolation=cv2.INTER_LANCZOS4)
    alpha_final = cv2.resize(alpha_work, (width, height), interpolation=cv2.INTER_LINEAR)
    final_blur = cv2.GaussianBlur(rgb_final, (0, 0), sigmaX=0.9)
    rgb_final = cv2.addWeighted(rgb_final, 1.16, final_blur, -0.16, 0)

    out = np.dstack((
        np.clip(rgb_final[:, :, 0], 0, 255),
        np.clip(rgb_final[:, :, 1], 0, 255),
        np.clip(rgb_final[:, :, 2], 0, 255),
        np.clip(alpha_final, 0, 255),
    )).astype("uint8")

    return Image.fromarray(out, mode="RGBA")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        data_url = payload.get("imageDataUrl")
        width = int(payload.get("width", 0))
        height = int(payload.get("height", 0))

        if not data_url or width <= 0 or height <= 0:
            raise ValueError("Missing required fields")

        raw = decode_data_url(data_url)
        image = Image.open(io.BytesIO(raw)).convert("RGBA")

        out_img = resize_with_opencv(image, width, height)
        engine = "opencv" if out_img is not None else "pillow"
        if out_img is None:
            out_img = resize_with_pillow(image, width, height)

        result = {
            "imageDataUrl": encode_png_data_url(out_img),
            "width": width,
            "height": height,
            "engine": engine,
        }
        sys.stdout.write(json.dumps(result))
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
