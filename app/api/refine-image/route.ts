import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const image = form.get('image');
    const prompt = form.get('prompt');
    const image_strength = form.get('image_strength') || '0.65';
    const steps = form.get('steps') || '30';
    const cfg_scale = form.get('cfg_scale') || '6';

    if (!image || !(image instanceof Blob)) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const apiUrl = process.env.STABLE_DIFFUSION_API_URL || "http://127.0.0.1:7860";

    const sdFormData = new FormData();
    sdFormData.append("image", image, "upload.png");
    sdFormData.append("prompt", prompt || "realistic studio product photo of this garment design");
    sdFormData.append("source_type", "sketch");
    sdFormData.append("image_strength", image_strength);
    sdFormData.append("steps", steps);
    sdFormData.append("cfg_scale", cfg_scale);

    // Call the specific /api/imgtoimg endpoint on your ngrok interface
    const response = await fetch(`${apiUrl}/api/imgtoimg`, {
      method: "POST",
      headers: {
        "ngrok-skip-browser-warning": "true"
      },
      body: sdFormData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error("SD API error:", response.status, errorText);
      return NextResponse.json({
        error: "Gradio Cloud API failed to process the image.",
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
