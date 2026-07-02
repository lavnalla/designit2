import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResizePayload = {
  imageDataUrl: string;
  width: number;
  height: number;
  mode?: "stretch";
};

type PythonResult = {
  imageDataUrl: string;
  width: number;
  height: number;
  engine: string;
};

const SCRIPT_PATH = path.join(process.cwd(), "tools", "python_resize.py");

function runPythonCandidate(cmd: string, baseArgs: string[], payload: ResizePayload): Promise<PythonResult> {
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
        const parsed = JSON.parse(stdout) as PythonResult;
        if (!parsed?.imageDataUrl) {
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

async function runPythonResize(payload: ResizePayload): Promise<PythonResult> {
  const candidates: Array<{ cmd: string; args: string[] }> = [];
  if (process.env.PYTHON_BIN) {
    candidates.push({ cmd: process.env.PYTHON_BIN, args: [] });
  }
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

  throw new Error(`Unable to run Python resize pipeline. ${String(lastError || "No Python interpreter found")}`);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ResizePayload>;

    const imageDataUrl = body.imageDataUrl;
    const width = Number(body.width);
    const height = Number(body.height);

    if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageDataUrl" }, { status: 400 });
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return NextResponse.json({ error: "Invalid width/height" }, { status: 400 });
    }

    const payload: ResizePayload = {
      imageDataUrl,
      width: Math.min(4096, Math.max(32, Math.round(width))),
      height: Math.min(4096, Math.max(32, Math.round(height))),
      mode: "stretch"
    };

    const result = await runPythonResize(payload);
    return NextResponse.json(result);
  } catch (error) {
    console.error("python-resize API error", error);
    return NextResponse.json(
      {
        error: "Python resize failed",
        details: String(error)
      },
      { status: 500 }
    );
  }
}
