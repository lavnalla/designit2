import { describe, it, expect, vi, afterEach } from "vitest";
import { runFabricCopy, FabricPipelineError } from "./fabricPipeline";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fabric pipeline client timeout", () => {
  it("rejects with a FabricPipelineError when the service never answers", async () => {
    vi.useFakeTimers();
    // A fetch that only settles when its signal aborts, like a hung server.
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    ));

    const pending = runFabricCopy("data:image/png;base64,", null);
    const assertion = expect(pending).rejects.toMatchObject({
      name: "FabricPipelineError",
      hint: expect.stringContaining("not responding"),
    });
    await vi.advanceTimersByTimeAsync(120_001);
    await assertion;
  });

  it("passes a normal response through untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ swatchDataUrl: "x" }), { status: 200 })));
    const res = await runFabricCopy("data:image/png;base64,", null);
    expect(res.swatchDataUrl).toBe("x");
  });

  it("surfaces the service's hint on an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "down", hint: "start it" }), { status: 503 })));
    await expect(runFabricCopy("data:image/png;base64,", null)).rejects.toBeInstanceOf(FabricPipelineError);
    await expect(runFabricCopy("data:image/png;base64,", null)).rejects.toMatchObject({ hint: "start it" });
  });
});
