import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const image = form.get('image');
    const positivePrompt = form.get('positivePrompt');
    const negativePrompt = form.get('negativePrompt');
    const fabric = form.get('fabric');
    const controlMode = form.get('controlMode');
    const image_strength = form.get('image_strength') || '0.65';
    const steps = form.get('steps') || '30';
    const cfg_scale = form.get('cfg_scale') || '6';

    if (!image || !(image instanceof Blob)) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const apiUrl = process.env.STABLE_DIFFUSION_API_URL || "https://composite-suction-earthy.ngrok-free.dev";
    const controlNetModel = process.env.CONTROLNET_MODEL;

    const positivePromptText = typeof positivePrompt === 'string' ? positivePrompt.trim() : '';
    const negativePromptText = typeof negativePrompt === 'string' ? negativePrompt.trim() : '';
    const fabricText = typeof fabric === 'string' ? fabric.trim() : '';
    const controlModeText = typeof controlMode === 'string' ? controlMode.trim() : 'My prompt is more important';
    const promptParts = [
      'preserve the original garment sketch structure exactly, keep the neckline, collar, silhouette, seam placement, proportions, and garment shape unchanged',
      controlModeText === 'ControlNet is more important'
        ? 'controlnet guidance takes priority over prompt stylization'
        : controlModeText === 'Balanced'
          ? 'keep prompt styling and controlnet guidance balanced'
          : 'prompt stylization takes priority over controlnet guidance',
      'realistic studio product photo of this garment design',
      fabricText ? `${fabricText} fabric` : '',
      positivePromptText,
    ].filter(Boolean);

    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const imageBase64 = imageBuffer.toString("base64");
    const payload: Record<string, unknown> = {
      init_images: [`data:${image.type || 'image/png'};base64,${imageBase64}`],
      prompt: promptParts.join(', '),
      negative_prompt: negativePromptText,
      steps: Number(steps),
      cfg_scale: Number(cfg_scale),
      denoising_strength: Number(image_strength),
    };

    if (typeof controlNetModel === 'string' && controlNetModel.trim()) {
      payload.alwayson_scripts = {
        controlnet: {
          args: [
            {
              enabled: true,
              input_image: imageBase64,
              module: 'none',
              model: controlNetModel.trim(),
              weight: 1.3,
              guidance_start: 0,
              guidance_end: 0.8,
              control_mode: controlModeText,
              resize_mode: 'Just Resize',
              pixel_perfect: true,
              processor_res: 512,
            },
          ],
        },
      };
    }

    const response = await fetch(`${apiUrl}/sdapi/v1/img2img`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true"
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error("SD API error:", response.status, errorText);
      return NextResponse.json({
        error: `Refine backend error (${response.status})`,
        details: errorText
      }, { status: response.status });
    }

    const data = await response.json();
    if (data.image_base64) {
      return NextResponse.json({ resultImage: `data:image/png;base64,${data.image_base64}` });
    } else if (data.images && data.images.length > 0) {
      // Handle both array of strings and array of objects with base64 property
      const img = typeof data.images[0] === 'string' ? data.images[0] : data.images[0]?.base64;
      if (img) {
        return NextResponse.json({ resultImage: `data:image/png;base64,${img}` });
      }
    }

    return NextResponse.json({ error: "No image generated" }, { status: 500 });
  } catch (error: any) {
    console.error("Refine API error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
