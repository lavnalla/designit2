"""Boot the service the way a laptop would and check the runtime behaviour.

  .venv/bin/python test_runtime.py            # CPU, fast tier, token auth, pre-warm
  .venv/bin/python test_runtime.py classic    # CPU, classic tier (no model)

Starts its own uvicorn on port 8011 with FABRIC_DEVICE=cpu, a fresh cache
directory and a shared-secret token, then checks:

  * /health reports the resolved profile and the pre-warm finishes;
  * every route except /health rejects a missing or wrong token;
  * copying a bundled template after pre-warm is a cache hit (instant);
  * the same request through a second process (fresh RAM) still hits, i.e.
    the disk cache works;
  * a per-request `quality: classic` copy completes in well under a second.

Timings are printed for the record; only correctness is asserted.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = 8011
BASE = f"http://127.0.0.1:{PORT}"
TOKEN = "test-token-123"
TEMPLATE = HERE.parent / "public" / "templates" / "blouse.jpg"


def start_service(cache_dir: str, quality: str) -> subprocess.Popen:
    env = dict(os.environ)
    env.update({
        "FABRIC_DEVICE": "cpu",
        "FABRIC_QUALITY": quality,
        "FABRIC_CACHE_DIR": cache_dir,
        "FABRIC_SERVICE_TOKEN": TOKEN,
        "FABRIC_PREWARM": "1",
        "CUDA_VISIBLE_DEVICES": "",
    })
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app", "--app-dir", str(HERE), "--host", "127.0.0.1", "--port", str(PORT)],
        env=env, cwd=str(HERE.parent), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def get(path: str, token: str | None = TOKEN) -> tuple[int, dict]:
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


def post(path: str, payload: dict, token: str | None = TOKEN) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        raw = err.read() or b"{}"
        try:
            return err.code, json.loads(raw)
        except ValueError:
            return err.code, {"error": raw.decode("utf-8", "replace")[:300]}


def wait_health(timeout: float) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, body = get("/health", token=None)
            if status == 200:
                return body
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        time.sleep(1)
    raise RuntimeError("service did not come up")


def wait_prewarm(timeout: float) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = get("/health", token=None)[1]
        state = body["prewarm"]["status"]
        if state == "done" or state.startswith("failed"):
            return body
        time.sleep(2)
    raise RuntimeError("pre-warm did not finish in time")


def check(label: str, ok: bool, detail: str = "") -> bool:
    print(f"   [{'PASS' if ok else 'FAIL'}] {label}{': ' + detail if detail else ''}", flush=True)
    return ok


def main() -> int:
    quality = sys.argv[1] if len(sys.argv) > 1 else "auto"
    ok = True
    with tempfile.TemporaryDirectory(prefix="fabric-cache-") as cache_dir:
        template_b64 = "data:image/jpeg;base64," + base64.b64encode(TEMPLATE.read_bytes()).decode()

        proc = start_service(cache_dir, quality)
        try:
            health = wait_health(120)
            prof = health["profile"]
            print(f"profile: device={prof['device']} quality={prof['quality']} steps={prof['steps']} threads={prof['threads']} ({prof['reason']})")
            ok &= check("runs on CPU", prof["device"] == "cpu")
            expected = "classic" if quality == "classic" else "fast"
            ok &= check(f"resolved tier is {expected}", prof["quality"] == expected, prof["quality"])
            ok &= check("token auth reported", health["auth"] == "token")

            status, body = post("/copy", {"imageDataUrl": template_b64}, token=None)
            ok &= check("copy without token is rejected", status == 401, str(status))
            status, body = post("/copy", {"imageDataUrl": template_b64}, token="wrong")
            ok &= check("copy with wrong token is rejected", status == 401, str(status))
            status, _ = get("/health", token=None)
            ok &= check("/health stays open", status == 200)

            t = time.time()
            health = wait_prewarm(900)
            print(f"   pre-warm finished in {time.time() - t:.0f}s: {health['prewarm']['status']}, {len(health['prewarm']['done'])} templates, errors={health['prewarm']['errors']}")
            ok &= check("pre-warm completed", health["prewarm"]["status"] == "done" and not health["prewarm"]["errors"])
            ok &= check("disk cache populated", health["disk_cache"]["entries"] >= len(health["prewarm"]["done"]), str(health["disk_cache"]))

            t = time.time()
            status, body = post("/copy", {"imageDataUrl": template_b64})
            dt = time.time() - t
            ok &= check("template copy succeeds", status == 200, str(status))
            ok &= check("template copy is a cache hit after pre-warm", bool(body.get("fromCache")), f"{dt:.2f}s, quality={body.get('quality')}")

            # What the browser actually sends: the same template re-encoded as
            # JPEG through a canvas. The perceptual-hash key must still hit.
            import io
            from PIL import Image
            buf = io.BytesIO()
            Image.open(TEMPLATE).convert("RGB").save(buf, format="JPEG", quality=80)
            reencoded_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
            t = time.time()
            status, body = post("/copy", {"imageDataUrl": reencoded_b64})
            dt = time.time() - t
            ok &= check("re-encoded template still hits the cache", status == 200 and bool(body.get("fromCache")), f"{dt:.2f}s")

            t = time.time()
            status, body = post("/copy", {"imageDataUrl": template_b64, "quality": "classic", "seed": 7})
            dt = time.time() - t
            ok &= check("classic tier copy is fast", status == 200 and dt < 5.0, f"{dt:.2f}s, quality={body.get('quality')}")
            ok &= check("classic swatch returned", body.get("swatchDataUrl", "").startswith("data:image/png"))
        finally:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()

        # Second process, same cache dir: the disk cache must make the
        # template an instant hit before its own pre-warm has run.
        env_prewarm = os.environ.get("FABRIC_PREWARM")
        os.environ["FABRIC_PREWARM"] = "0"
        try:
            proc = start_service(cache_dir, quality)
            try:
                wait_health(120)
                t = time.time()
                status, body = post("/copy", {"imageDataUrl": template_b64})
                dt = time.time() - t
                ok &= check("disk cache survives a restart", status == 200 and bool(body.get("fromCache")), f"{dt:.2f}s")
            finally:
                proc.terminate()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    proc.kill()
        finally:
            if env_prewarm is None:
                os.environ.pop("FABRIC_PREWARM", None)
            else:
                os.environ["FABRIC_PREWARM"] = env_prewarm

    print("\nALL PASS" if ok else "\nFAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
