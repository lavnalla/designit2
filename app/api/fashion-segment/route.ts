import { NextRequest, NextResponse } from "next/server";

const SERVICE_URL =
  process.env.FASHION_SEGMENT_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${SERVICE_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "Segmentation service unhealthy", detail: data },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, service: data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Cannot reach fashion segmentation service on port 8000",
      },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const incoming = await req.formData();
    const file = incoming.get("file");
    if (!(file instanceof File) && !(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }

    const form = new FormData();
    form.append("file", file, file instanceof File ? file.name : "upload.jpg");

    const res = await fetch(`${SERVICE_URL}/segment`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });

    const data = await res.json().catch(() => ({ detail: "Invalid JSON from segmentation service" }));
    if (!res.ok) {
      return NextResponse.json(
        {
          error: "Segmentation failed",
          detail: typeof data?.detail === "string" ? data.detail : JSON.stringify(data),
        },
        { status: res.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Cannot reach fashion segmentation service. Run: npm run segment:server",
      },
      { status: 503 },
    );
  }
}
