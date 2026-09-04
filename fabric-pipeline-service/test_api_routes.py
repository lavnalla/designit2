"""Exercise the Next.js proxy routes, not just the Python service.

  .venv/bin/python test_api_routes.py

Confirms /api/fabric/copy and /api/fabric/paste compile, forward correctly,
and return the shape the client expects.
"""

from __future__ import annotations

import base64
import io
import json
import urllib.error
import urllib.request

from PIL import Image

NEXT = "http://127.0.0.1:3000"


def post(path: str, payload: dict, timeout: int = 300) -> tuple[int, dict | str]:
    req = urllib.request.Request(
        NEXT + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw


def to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    ok = True

    # --- validation: a bad payload must be rejected by the route itself ---
    status, body = post("/api/fabric/copy", {"imageDataUrl": "not-an-image"})
    good = status == 400
    print(f"   [{'PASS' if good else 'FAIL'}] copy rejects bad imageDataUrl: {status} {body}")
    ok &= good

    status, body = post("/api/fabric/paste", {"swatchDataUrl": "x", "destImageDataUrl": "y"})
    good = status == 400
    print(f"   [{'PASS' if good else 'FAIL'}] paste rejects bad swatchDataUrl: {status} {body}")
    ok &= good

    # --- real round trip through Next -> FastAPI ---
    source = Image.open("../public/designFrom.png").convert("RGB")
    w, h = source.size
    status, body = post("/api/fabric/copy", {
        "imageDataUrl": to_data_url(source),
        "rect": {"x": w * 0.40, "y": h * 0.40, "width": w * 0.20, "height": h * 0.20},
        "seed": 0,
    })
    good = status == 200 and isinstance(body, dict) and "swatchDataUrl" in body
    print(f"   [{'PASS' if good else 'FAIL'}] copy round trip: {status}")
    ok &= good
    if not good:
        print(f"      body: {body}")
        return 1

    print(f"      garment={body['sourceGarment']} srcPxPerCm={body['srcPxPerCm']:.2f} "
          f"crop={body['cropWidth']}x{body['cropHeight']} cached={body['fromCache']}")

    dest = Image.open("../public/designTo1.png").convert("RGB")
    # Ask for an odd, non-matching target size to prove the service returns
    # exactly what the caller asked for -- that 1:1 guarantee is what stops the
    # SVG renderer stretching the result.
    target_w, target_h = 640, 900
    status, paste = post("/api/fabric/paste", {
        "swatchDataUrl": body["swatchDataUrl"],
        "destImageDataUrl": to_data_url(dest),
        "cropWidth": body["cropWidth"],
        "cropHeight": body["cropHeight"],
        "srcPxPerCm": body["srcPxPerCm"],
        "multiplier": 1.0,
        "shadingStrength": 1.0,
        "targetWidth": target_w,
        "targetHeight": target_h,
    })
    good = status == 200 and isinstance(paste, dict) and "imageDataUrl" in paste
    print(f"   [{'PASS' if good else 'FAIL'}] paste round trip: {status}")
    ok &= good
    if not good:
        print(f"      body: {paste}")
        return 1

    raw = base64.b64decode(paste["imageDataUrl"].split(",", 1)[1])
    out = Image.open(io.BytesIO(raw))
    exact = out.size == (target_w, target_h) and paste["width"] == target_w and paste["height"] == target_h
    print(f"   [{'PASS' if exact else 'FAIL'}] output is exactly the requested size: "
          f"{out.size} vs ({target_w}, {target_h})")
    ok &= exact

    rgba = out.mode == "RGBA"
    print(f"   [{'PASS' if rgba else 'FAIL'}] output is RGBA (masked to the garment): {out.mode}")
    ok &= rgba

    print(f"      tile={paste['tileWidth']}x{paste['tileHeight']} "
          f"repeats={paste['repeatsX']}x{paste['repeatsY']} garment={paste['destGarment']}")

    print(f"\n{'all checks passed' if ok else 'FAILURES above'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
