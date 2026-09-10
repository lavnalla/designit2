"""Runtime profile: which device, how many threads, and which quality tier.

The service was written against an RTX 3070 and then asked to run on ordinary
laptops. Measured on an 8-core Ryzen 7 5700X (a fast desktop CPU, so treat a
laptop as roughly 2x slower), one UNet step of the rectifier costs about 0.9 s
at batch 1 and 1.9 s with classifier-free guidance on (batch 3). Neither
channels-last nor bf16 autocast helped on that CPU (bf16 was 3x slower --
Zen 3 has no native bf16), so the only levers are fewer steps, no guidance,
or no diffusion at all. That is what the tiers below encode:

  full     20 steps, guidance on. The reference configuration. ~1.3 s on the
           3070, ~33 s on the 5700X.
  fast     10 steps, guidance off. The text prompt is always empty here, so
           the text half of the guidance was a no-op anyway; dropping it
           shrinks the batch from 3 to 1. ~11 s on the 5700X, roughly 20-25 s
           on a laptop. Output is softer than `full` but keeps colour, motif
           and tileability.
  classic  No diffusion. The crop is delighted and made seamless by an
           offset-and-blend (delight.seamless_tile). ~60 ms anywhere, no
           model to load, ~0 RAM. Folds are not undone, only their shading,
           so it suits flat product shots and fine prints better than heavily
           draped photos.

`auto` (the default) picks `full` on CUDA and `fast` on CPU, and drops to
`classic` when there is not enough free RAM to hold the fp32 diffusion
weights (about 4.2 GB, ~6.8 GB peak) -- loading them on an 8 GB laptop would
swap the machine to a standstill rather than fail cleanly.

Everything is overridable from the environment; see README.md.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import torch

QUALITY_TIERS = ("full", "fast", "classic")

# (inference steps, text guidance, image guidance). `classic` has none.
TIER_PARAMS = {
    "full": (20, 7.0, 1.5),
    "fast": (10, 1.0, 1.0),
}

# Free RAM below which the diffusion model is not loaded on CPU. The weights
# are ~4.2 GB in fp32 and the process peaks near 6.8 GB during a flatten.
DEFAULT_MIN_FREE_GB = 5.0


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def available_ram_gb() -> float | None:
    """MemAvailable from /proc/meminfo; None where that does not exist."""
    try:
        with open("/proc/meminfo", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / (1024 * 1024)
    except (OSError, ValueError):
        pass
    try:
        pages = os.sysconf("SC_AVPHYS_PAGES")
        page = os.sysconf("SC_PAGE_SIZE")
        return pages * page / (1024 ** 3)
    except (AttributeError, ValueError, OSError):
        return None


@dataclass
class Profile:
    device: str
    quality: str            # resolved tier: full | fast | classic
    requested: str          # what the environment asked for (auto | tier)
    reason: str             # why the resolved tier was chosen
    steps: int
    guidance_scale: float
    image_guidance_scale: float
    threads: int
    min_free_gb: float
    ram_available_gb: float | None

    @property
    def uses_diffusion(self) -> bool:
        return self.quality != "classic"

    def as_dict(self) -> dict:
        return {
            "device": self.device,
            "quality": self.quality,
            "requested": self.requested,
            "reason": self.reason,
            "steps": self.steps if self.uses_diffusion else 0,
            "guidance_scale": self.guidance_scale if self.uses_diffusion else None,
            "image_guidance_scale": self.image_guidance_scale if self.uses_diffusion else None,
            "threads": self.threads,
            "min_free_gb": self.min_free_gb,
            "ram_available_gb": None if self.ram_available_gb is None else round(self.ram_available_gb, 2),
        }


def pick_device() -> str:
    forced = _env("FABRIC_DEVICE", "")
    if forced:
        return forced
    return "cuda" if torch.cuda.is_available() else "cpu"


def apply_threads() -> int:
    """Honour FABRIC_THREADS; otherwise leave torch's own choice alone.

    torch defaults to the physical core count, which measured as good as any
    other setting on the 5700X (8 threads 872 ms/step, 16 threads 877 ms).
    """
    requested = _env("FABRIC_THREADS", "")
    if requested:
        try:
            n = max(1, int(requested))
            torch.set_num_threads(n)
        except ValueError:
            pass
    return torch.get_num_threads()


def resolve(quality_override: str | None = None) -> Profile:
    device = pick_device()
    threads = apply_threads()
    min_free = float(_env("FABRIC_MIN_FREE_GB", str(DEFAULT_MIN_FREE_GB)))
    ram = available_ram_gb()

    requested = (quality_override or _env("FABRIC_QUALITY", "auto")).lower()
    if requested not in QUALITY_TIERS + ("auto",):
        requested = "auto"

    if requested == "auto":
        if device.startswith("cuda"):
            quality, reason = "full", "auto: CUDA device"
        else:
            quality, reason = "fast", "auto: CPU device"
    else:
        quality, reason = requested, "set by FABRIC_QUALITY" if quality_override is None else "requested"

    # RAM guard only matters when the weights live in system memory.
    if quality != "classic" and not device.startswith("cuda") and ram is not None and ram < min_free:
        quality = "classic"
        reason = f"only {ram:.1f} GB RAM free, below FABRIC_MIN_FREE_GB={min_free:g}; diffusion skipped"

    steps, guidance, image_guidance = TIER_PARAMS.get(quality, (0, 0.0, 0.0))
    return Profile(
        device=device,
        quality=quality,
        requested=requested,
        reason=reason,
        steps=steps,
        guidance_scale=guidance,
        image_guidance_scale=image_guidance,
        threads=threads,
        min_free_gb=min_free,
        ram_available_gb=ram,
    )
