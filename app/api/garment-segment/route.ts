import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SegmentPayload = {
  imageDataUrl: string;
};

type SegmentResult = {
  maskDataUrl: string;
  width: number;
  height: number;
  detectedParts: string[];
  rawLabelsFound: string[];
};

const SCRIPT_PATH = path.join(process.cwd(), "tools", "garment_segment.py");
const VENV_PYTHON = path.join(
  process.cwd(),
  "tools",
  "venv",
  process.platform === "win32" ? "Scripts\\python.exe" : "bin/python",
);

function runPythonCandidate(cmd: string, baseArgs: string[], payload: SegmentPayload): Promise<SegmentResult> {
  return new Promise((resolve, reject) => {
    const args = [...baseArgs, SCRIPT_PATH];
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(err);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python process exited with code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as SegmentResult;
        if (!parsed?.maskDataUrl) {
          reject(new Error("Python returned invalid payload"));
          return;
        }
        resolve(parsed);
      } catch (parseError) {
        reject(new Error(`Failed to parse Python output: ${String(parseError)}`));
      }
    });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

async function runGarmentSegment(payload: SegmentPayload): Promise<SegmentResult> {
  const candidates: Array<{ cmd: string; args: string[] }> = [];

  // Prefer the project-local venv (tools/venv) since this needs heavy ML
  // dependencies (torch/transformers) that aren't installed system-wide.
  if (existsSync(VENV_PYTHON)) {
    candidates.push({ cmd: VENV_PYTHON, args: [] });
  }
  if (process.env.PYTHON_BIN) {
    candidates.push({ cmd: process.env.PYTHON_BIN, args: [] });
  }
  candidates.push({ cmd: "python3", args: [] });
  candidates.push({ cmd: "python", args: [] });
  candidates.push({ cmd: "py", args: ["-3"] });

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await runPythonCandidate(candidate.cmd, candidate.args, payload);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Unable to run garment segmentation. Run "pip install -r tools/requirements-garment-segment.txt" inside tools/venv first. ${String(lastError || "No Python interpreter found")}`,
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<SegmentPayload>;

    const imageDataUrl = body.imageDataUrl;
    if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageDataUrl" }, { status: 400 });
    }

    const result = await runGarmentSegment({ imageDataUrl });
    return NextResponse.json(result);
  } catch (error) {
    console.error("garment-segment API error", error);
    return NextResponse.json(
      {
        error: "Garment segmentation failed",
        details: String(error),
      },
      { status: 500 },
    );
  }
}
