# Fashion segmentation local API

Serves [`sayeed99/segformer-b3-fashion`](https://huggingface.co/sayeed99/segformer-b3-fashion) for the DesignIt **Try it on** page.

## Start

From the repo root (reuse the PoC venv):

```bash
fashion-segmentation-test/.venv/bin/pip install -r fashion-segmentation-service/requirements.txt
fashion-segmentation-test/.venv/bin/uvicorn server:app \
  --app-dir fashion-segmentation-service \
  --host 127.0.0.1 \
  --port 8000
```

Or from the Next.js app:

```bash
npm run segment:server
```

Health check: http://127.0.0.1:8000/health

The Next.js app proxies `/api/fashion-segment` → this service.
