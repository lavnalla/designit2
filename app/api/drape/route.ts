import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { mannequin_image_base64, garment_image_base64, prompt } = await req.json();

    if (!garment_image_base64 || !mannequin_image_base64) {
      return NextResponse.json({ error: "Both mannequin_image_base64 and garment_image_base64 are required" }, { status: 400 });
    }

    const apiUrl = process.env.STABLE_DIFFUSION_API_URL || "http://127.0.0.1:7860";

    // Call the specific drape endpoint on your ngrok interface
    const response = await fetch(`${apiUrl}/api/drape`, {
      method: "POST",
      headers: {
        "ngrok-skip-browser-warning": "true",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mannequin_image_base64: mannequin_image_base64.replace(/^data:image\/\w+;base64,/, ""),
        garment_image_base64: garment_image_base64.replace(/^data:image\/\w+;base64,/, ""),
        prompt: prompt || "Make this mannequin wear this exact garment, keep same color, same pattern, same fabric",
        denoising_strength: 0.55,
        control_strength: 1.2,
        steps: 30,
        cfg_scale: 6,
        aspect_ratio: "4:5"
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error("Drape API error:", response.status, errorText);
      
      return NextResponse.json({ 
        error: "Gradio Cloud API failed to process the image.", 
        details: errorText 
      }, { status: response.status });
    }

    const data = await response.json();
    
    // Check if the response follows the specific response.images[0].base64 format
    if (data.images && data.images.length > 0) {
      const base64Str = typeof data.images[0] === 'string' ? data.images[0] : (data.images[0].base64 || data.images[0]);
      return NextResponse.json({ resultImage: `data:image/png;base64,${base64Str}` });
    } else if (data.image_base64) {
      return NextResponse.json({ resultImage: `data:image/png;base64,${data.image_base64}` });
    }

    return NextResponse.json({ error: "No image generated" }, { status: 500 });
  } catch (error: any) {
    console.error("Drape API error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
