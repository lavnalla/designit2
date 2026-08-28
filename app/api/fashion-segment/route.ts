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

/**
 * The client renders `image_size.width` and the two data URLs unconditionally, so a
 * 2xx body missing them crashes the page. Anything that fails this check is reported
 * as a bad-gateway error instead of being passed through as a success.
 */
function isSegmentPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const size = data.image_size as Record<string, unknown> | undefined;
  return (
    !!size &&
    typeof size === "object" &&
    typeof size.width === "number" &&
    typeof size.height === "number" &&
    typeof data.mask_data_url === "string" &&
    typeof data.overlay_data_url === "string" &&
    Array.isArray(data.detections)
  );
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    const incoming = await req.formData();
    // FormData entries are `File | string`; File extends Blob, so one check covers uploads.
    const file: unknown = incoming.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }
    form = new FormData();
    form.append("file", file, file instanceof File ? file.name : "upload.jpg");
  } catch {
    // A malformed multipart body is the caller's problem, not an unreachable service.
    return NextResponse.json({ error: "Could not read the uploaded form data" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${SERVICE_URL}/segment`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return NextResponse.json(
        { error: "Segmentation timed out after 120s. Try a smaller image." },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Cannot reach fashion segmentation service. Run: npm run segment:server" },
      { status: 503 },
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json(
      {
        error: "Segmentation service returned a non-JSON response",
        detail: `HTTP ${res.status}`,
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    return NextResponse.json(
      {
        error: "Segmentation failed",
        detail: typeof detail === "string" ? detail : JSON.stringify(data),
      },
      { status: res.status },
    );
  }

  if (!isSegmentPayload(data)) {
    return NextResponse.json(
      { error: "Segmentation service returned an unexpected payload" },
      { status: 502 },
    );
  }

  return NextResponse.json(data);
}
