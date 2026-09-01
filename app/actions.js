// app/actions.js
'use server';

const STABLE_DIFFUSION_BASE_URL = process.env.STABLE_DIFFUSION_API_URL || 'https://composite-suction-earthy.ngrok-free.dev';

export async function generateImg2Img(base64Image, positivePrompt, negativePrompt) {
  try {
    const response = await fetch(`${STABLE_DIFFUSION_BASE_URL}/sdapi/v1/img2img`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        init_images: [base64Image], // Expects base64-encoded image string
        prompt: positivePrompt,
        negative_prompt: negativePrompt,
        steps: 20, // Adjust parameters as needed for your model
        cfg_scale: 7,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Automatic1111 returns an array of base64 images in 'images'
    const outputImageBase64 = data.images[0];
    return { success: true, image: `data:image/png;base64,${outputImageBase64}` };
    
  } catch (error) {
    console.error('Error connecting to ngrok endpoint:', error);
    return { success: false, error: error.message };
  }
}