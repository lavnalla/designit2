import { NextResponse } from "next/server";

/**
 * Shared configuration for the local fabric pipeline service.
 *
 * The service holds ~2.5GB of model weights resident, so it runs as its own
 * long-lived process rather than being spawned per request the way
 * tools/garment_segment.py is. Start it with:
 *
 *   fabric-pipeline-service/service.sh start
 */
export const FABRIC_SERVICE_URL =
  process.env.FABRIC_SERVICE_URL || "http://127.0.0.1:8010";

export function fabricServiceUnavailable(error: unknown) {
  const aborted = error instanceof Error && error.name === "AbortError";
  return NextResponse.json(
    {
      error: aborted
        ? "Fabric pipeline service timed out"
        : "Fabric pipeline service is not reachable",
      details: String(error),
      hint: `Start it with "fabric-pipeline-service/service.sh start" (expected at ${FABRIC_SERVICE_URL}).`,
    },
    { status: 503 },
  );
}
