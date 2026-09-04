import { NextRequest, NextResponse } from "next/server";

import { FABRIC_SERVICE_URL, fabricServiceUnavailable } from "../service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flattening runs a 20-step diffusion pass, so allow well past the usual
// default before giving up on the service.
const TIMEOUT_MS = 120_000;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { imageDataUrl?: unknown };
  if (typeof payload?.imageDataUrl !== "string" || !payload.imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Invalid imageDataUrl" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FABRIC_SERVICE_URL}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "Fabric copy failed", details: text },
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
