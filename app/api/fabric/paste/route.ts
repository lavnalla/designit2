import { NextRequest, NextResponse } from "next/server";

import { FABRIC_SERVICE_URL, fabricServiceUnavailable } from "../service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Paste is segmentation plus array work -- no diffusion -- so it is far
// quicker than copy, but a large canvas still takes a moment.
const TIMEOUT_MS = 60_000;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { swatchDataUrl?: unknown; destImageDataUrl?: unknown };
  if (typeof payload?.swatchDataUrl !== "string" || !payload.swatchDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Invalid swatchDataUrl" }, { status: 400 });
  }
  if (
    typeof payload?.destImageDataUrl !== "string" ||
    !payload.destImageDataUrl.startsWith("data:image/")
  ) {
    return NextResponse.json({ error: "Invalid destImageDataUrl" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FABRIC_SERVICE_URL}/paste`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "Fabric paste failed", details: text },
        { status: res.status },
      );
    }
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return fabricServiceUnavailable(error);
  } finally {
    clearTimeout(timer);
  }
}
