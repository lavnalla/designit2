# Fashion Segmentation PoC (isolated)

Isolated proof-of-concept for [`sayeed99/segformer-b3-fashion`](https://huggingface.co/sayeed99/segformer-b3-fashion).

This directory does **not** modify the Next.js application (`src/`, `app/`, `package.json`, etc.).

## Label mapping (47 classes)

From the model card / `config.json` `id2label`:

| ID | Label |
|----|-------|
| 0 | Unlabelled |
| 1 | shirt, blouse |
| 2 | top, t-shirt, sweatshirt |
| 3 | sweater |
| 4 | cardigan |
| 5 | jacket |
| 6 | vest |
| 7 | pants |
| 8 | shorts |
| 9 | skirt |
| 10 | coat |
| 11 | dress |
| 12 | jumpsuit |
| 13 | cape |
| 14 | glasses |
| 15 | hat |
| 16 | headband, head covering, hair accessory |
| 17 | tie |
| 18 | glove |
| 19 | watch |
| 20 | belt |
| 21 | leg warmer |
| 22 | tights, stockings |
| 23 | sock |
| 24 | shoe |
| 25 | bag, wallet |
| 26 | scarf |
| 27 | umbrella |
| 28 | hood |
| 29 | collar |
| 30 | lapel |
| 31 | epaulette |
| 32 | sleeve |
| 33 | pocket |
| 34 | neckline |
| 35 | buckle |
| 36 | zipper |
| 37 | applique |
| 38 | bead |
| 39 | bow |
| 40 | flower |
| 41 | fringe |
| 42 | ribbon |
| 43 | rivet |
| 44 | ruffle |
| 45 | sequin |
| 46 | tassel |

## Setup

```bash
cd fashion-segmentation-test
# Prefer Python 3.12 (PyTorch wheels on Intel macOS top out around 2.2.x)
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Place a local fashion photo at `inputs/test.jpg` (or pass `--image`).

If no image is provided, the script creates a synthetic stand-in.

## Run

```bash
cd fashion-segmentation-test
source .venv/bin/activate
python run_segmentation.py
# or:
python run_segmentation.py --image inputs/test.jpg --output-dir outputs --device cpu
```

On this machine, **CPU is recommended**. MPS produced noisy/incorrect masks during testing; override with `--device mps` only for experiments.

## Outputs

Written under `outputs/`:

- `segmentation_mask.png` — colorized class mask
- `segmentation_overlay.png` — mask blended onto the input
- `segmentation_panel.png` — side-by-side panel + legend
- `pred_class_ids.npy` — integer class map (H×W)
- `report.json` — timings, detections, memory estimates
