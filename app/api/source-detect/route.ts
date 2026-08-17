import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DetectPayload = {
  imageDataUrl: string;
};

type DetectResult = {
  articles: Array<Record<string, unknown>>;
};

const SCRIPT_PATH = path.join(process.cwd(), "tools", "fashion_article_detect.py");
const REQUEST_TIMEOUT_MS = 120000;

type PendingRequest = {
  resolve: (value: DetectResult) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

type WorkerState = {
  proc: ReturnType<typeof spawn>;
  buffer: string;
  pending: PendingRequest[];
};

let sourceDetectWorker: WorkerState | null = null;

function settlePendingRequests(worker: WorkerState, error: Error) {
  while (worker.pending.length > 0) {
    const pending = worker.pending.shift();
    if (!pending) continue;
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
}

function handleWorkerOutput(worker: WorkerState, chunk: Buffer) {
  worker.buffer += chunk.toString();

  while (true) {
    const newlineIndex = worker.buffer.indexOf("\n");
    if (newlineIndex === -1) {
      return;
    }

    const line = worker.buffer.slice(0, newlineIndex).trim();
    worker.buffer = worker.buffer.slice(newlineIndex + 1);

    if (!line) {
      continue;
    }

    const pending = worker.pending.shift();
    if (!pending) {
      continue;
    }

    clearTimeout(pending.timeout);

    try {
      const parsed = JSON.parse(line) as DetectResult & { error?: string };
      if (parsed.error) {
        pending.reject(new Error(parsed.error));
        continue;
      }

      pending.resolve({ articles: Array.isArray(parsed.articles) ? parsed.articles : [] });
    } catch (error) {
      pending.reject(new Error(`Failed to parse Python output: ${String(error)}`));
    }
  }
}

function createPersistentWorker(cmd: string, baseArgs: string[]) {
  const args = [...baseArgs, SCRIPT_PATH, "--worker"];
  const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
  const worker: WorkerState = { proc, buffer: "", pending: [] };

  proc.stdout.on("data", (chunk: Buffer) => handleWorkerOutput(worker, chunk));

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      console.error("source-detect worker stderr", text);
    }
  });

  proc.on("error", (error) => {
    if (sourceDetectWorker === worker) {
      sourceDetectWorker = null;
    }
    settlePendingRequests(worker, error);
  });

  proc.on("close", (code) => {
    if (sourceDetectWorker === worker) {
      sourceDetectWorker = null;
    }
    settlePendingRequests(worker, new Error(`Python worker exited with code ${code}`));
  });

  return worker;
}

async function getWorker(): Promise<WorkerState> {
  if (sourceDetectWorker) {
    return sourceDetectWorker;
  }

  const candidates: Array<{ cmd: string; args: string[] }> = [];
  if (process.env.PYTHON_BIN) {
    candidates.push({ cmd: process.env.PYTHON_BIN, args: [] });
  }
  candidates.push({ cmd: "python", args: [] });
  candidates.push({ cmd: "py", args: ["-3"] });

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const worker = createPersistentWorker(candidate.cmd, candidate.args);
      sourceDetectWorker = worker;
      return worker;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to run Python detection pipeline. ${String(lastError || "No Python interpreter found")}`);
}

async function runPythonDetection(payload: DetectPayload) {
  const worker = await getWorker();

  return new Promise<DetectResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = worker.pending.findIndex((item) => item.resolve === resolve);
      if (index !== -1) {
        worker.pending.splice(index, 1);
      }
      reject(new Error("Source detection timed out while waiting for the Python worker."));
    }, REQUEST_TIMEOUT_MS);

    worker.pending.push({ resolve, reject, timeout });
    worker.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<DetectPayload>;
    const imageDataUrl = body.imageDataUrl;

    if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageDataUrl" }, { status: 400 });
    }

    const result = await runPythonDetection({ imageDataUrl });
    return NextResponse.json(result);
  } catch (error) {
    console.error("source-detect API error", error);
    return NextResponse.json(
      {
        error: "Source detection failed",
        details: String(error),
      },
      { status: 500 },
    );
  }
}
