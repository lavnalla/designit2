# Fabric pipeline service, CPU build.
#
#   docker build -t fabric-pipeline -f fabric-pipeline-service/Dockerfile .
#   docker run -p 8010:8010 -e FABRIC_SERVICE_TOKEN=change-me \
#              -v fabric-cache:/app/fabric-pipeline-service/cache \
#              -v hf-cache:/root/.cache/huggingface fabric-pipeline
#
# Build from the repository root so the bundled template garments under
# public/templates are available for the startup pre-warm. The CPU torch
# wheels keep the image around 2 GB instead of 8 GB; on a machine with an
# NVIDIA GPU use the venv from setup.sh instead, which installs CUDA torch.
#
# Model weights (~2.5 GB) are downloaded on first start unless the Hugging
# Face cache volume above already holds them. The swatch cache volume keeps
# pre-warmed templates across container restarts.

FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FABRIC_DEVICE=cpu \
    FABRIC_QUALITY=auto \
    FABRIC_PREWARM=1

WORKDIR /app

COPY fabric-pipeline-service/requirements.txt fabric-pipeline-service/requirements.txt
RUN pip install --upgrade pip \
 && pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.4" "torchvision>=0.19" \
 && pip install -r fabric-pipeline-service/requirements.txt

COPY fabric-pipeline-service/ fabric-pipeline-service/
COPY public/templates/ public/templates/

EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8010/health', timeout=4).status == 200 else 1)"

CMD ["python", "-m", "uvicorn", "server:app", "--app-dir", "fabric-pipeline-service", "--host", "0.0.0.0", "--port", "8010"]
