"""Stage 2 -- texture rectification.

Turns an arbitrary, wrinkle-distorted garment crop into a flat, tileable
swatch using FabricDiffusion (Yuanhao-Harry-Wang/fabric-diffusion-texture), an
InstructPix2Pix model fine-tuned to strip folds, shadows and perspective skew.

Ported from the reference implementation at
https://github.com/humansensinglab/fabric-diffusion (pipeline.py). Two details
there are load-bearing and easy to lose:

  * every Conv2d in the UNet and VAE is switched to circular padding, which is
    what makes the generated swatch wrap seamlessly; and
  * the initial latents come from inverting the input image and renormalising
    it, rather than from plain noise, which keeps the output faithful to the
    fabric that was actually photographed.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn as nn
from PIL import Image

MODEL_ID = "Yuanhao-Harry-Wang/fabric-diffusion-texture"

# The model was trained at 256x256; feeding it anything else degrades output.
PATCH_SIZE = 256

NUM_INFERENCE_STEPS = 20
IMAGE_GUIDANCE_SCALE = 1.5
GUIDANCE_SCALE = 7.0


@dataclass
class RectifyResult:
    swatch: Image.Image
    seconds: float
    device: str
    steps: int


def _set_circular_padding(module: nn.Module) -> int:
    changed = 0
    for _, child in module.named_modules():
        if isinstance(child, nn.Conv2d):
            child.padding_mode = "circular"
            changed += 1
    return changed


def _seam_blend(image: Image.Image, blend_px: int) -> Image.Image:
    """Optional belt-and-braces cross-fade across the wrap boundary.

    Circular convolution already makes the output tileable, so this defaults to
    off. It exists for the occasional swatch that still shows a faint seam:
    each edge is cross-faded with the opposite edge over a narrow ramp, which
    guarantees continuity at the cost of slight softening in that band.
    """
    if blend_px <= 0:
        return image

    arr = np.asarray(image).astype(np.float32)
    h, w = arr.shape[:2]
    blend_px = int(min(blend_px, w // 4, h // 4))
    if blend_px <= 0:
        return image

    ramp = np.linspace(0.0, 1.0, blend_px, dtype=np.float32)

    # Horizontal wrap: fade the left edge towards what sits past the right edge.
    alpha = ramp[None, :, None]
    left = arr[:, :blend_px, :]
    right = arr[:, w - blend_px :, :]
    merged = left * alpha + right * (1.0 - alpha)
    arr[:, :blend_px, :] = merged
    arr[:, w - blend_px :, :] = merged

    # Vertical wrap.
    alpha = ramp[:, None, None]
    top = arr[:blend_px, :, :]
    bottom = arr[h - blend_px :, :, :]
    merged = top * alpha + bottom * (1.0 - alpha)
    arr[:blend_px, :, :] = merged
    arr[h - blend_px :, :, :] = merged

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


class TextureRectifier:
    def __init__(self, device_name: str | None = None) -> None:
        if device_name:
            self.device = torch.device(device_name)
        elif torch.cuda.is_available():
            self.device = torch.device("cuda")
        else:
            self.device = torch.device("cpu")
        # fp16 is what the reference uses, but it is CUDA-only -- a CPU box has
        # to fall back to fp32 or the UNet throws on half-precision matmuls.
        self.dtype = torch.float16 if self.device.type == "cuda" else torch.float32
        self.pipe = None
        self.ready = False
        self.load_seconds: float | None = None

    def load(self) -> None:
        if self.ready:
            return
        from diffusers import StableDiffusionInstructPix2PixPipeline

        start = time.perf_counter()
        pipe = StableDiffusionInstructPix2PixPipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=self.dtype,
            safety_checker=None,
            requires_safety_checker=False,
        )
        pipe = pipe.to(self.device)
        _set_circular_padding(pipe.unet)
        _set_circular_padding(pipe.vae)
        pipe.set_progress_bar_config(disable=True)

        self.pipe = pipe
        self.load_seconds = time.perf_counter() - start
        self.ready = True

    def flatten(
        self,
        patch: Image.Image,
        n_samples: int = 1,
        seed: int | None = None,
        seam_blend_px: int = 0,
    ) -> RectifyResult:
        """Flatten one garment crop into a tileable material swatch."""
        self.load()
        assert self.pipe is not None
        pipe = self.pipe

        rgb = patch.convert("RGB").resize((PATCH_SIZE, PATCH_SIZE), Image.LANCZOS)

        generator = None
        if seed is not None:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        start = time.perf_counter()
        with torch.inference_mode():
            pipe.scheduler.set_timesteps(NUM_INFERENCE_STEPS)
            timesteps = pipe.scheduler.timesteps

            image = pipe.image_processor.preprocess(rgb)

            # Invert the input into latent space and renormalise, then noise it
            # to the first timestep. This is the reference's `use_inversion`
            # path -- it anchors generation on the real fabric.
            image_latents = pipe.prepare_image_latents(
                image,
                batch_size=1,
                num_images_per_prompt=1,
                device=self.device,
                dtype=self.dtype,
                do_classifier_free_guidance=False,
            )
            image_latents = (image_latents - torch.mean(image_latents)) / torch.std(image_latents)

            noise = torch.randn(
                image_latents.shape, device=self.device, dtype=self.dtype, generator=generator
            )
            noisy = pipe.scheduler.add_noise(image_latents, noise, timesteps[0:1])
            noisy = noisy / pipe.scheduler.init_noise_sigma
            noisy = torch.tile(noisy, (n_samples, 1, 1, 1))

            tiled_image = torch.tile(image, (n_samples, 1, 1, 1))

            outputs = pipe(
                "",
                image=tiled_image,
                num_inference_steps=NUM_INFERENCE_STEPS,
                image_guidance_scale=IMAGE_GUIDANCE_SCALE,
                guidance_scale=GUIDANCE_SCALE,
                latents=noisy,
                num_images_per_prompt=n_samples,
                generator=generator,
            ).images
        seconds = time.perf_counter() - start

        swatch = _seam_blend(outputs[0], seam_blend_px)

        return RectifyResult(
            swatch=swatch,
            seconds=round(seconds, 3),
            device=str(self.device),
            steps=NUM_INFERENCE_STEPS,
        )


rectifier = TextureRectifier()
