# Fashion segmentation local API

Serves [`sayeed99/segformer-b3-fashion`](https://huggingface.co/sayeed99/segformer-b3-fashion) for the DesignIt **Try it on** page.

## Setup

Create a venv and install both requirement sets (once, from the repo root):

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r fashion-segmentation-test/requirements.txt \
            -r fashion-segmentation-service/requirements.txt
```

## Start

With that venv **activated**, from the repo root:

```bash
npm run segment:server
```

which is just:

```bash
python -m uvicorn server:app \
  --app-dir fashion-segmentation-service \
  --host 127.0.0.1 \
  --port 8000
```

`npm run segment:server` resolves `python` from the active venv, so activate it first —
otherwise you get the system interpreter and a `ModuleNotFoundError` for `uvicorn`.

Health check: http://127.0.0.1:8000/health

The Next.js app proxies `/api/fashion-segment` → this service.
