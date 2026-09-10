import { describe, it, expect, vi, afterEach } from "vitest";
import { runFabricCopy, FabricPipelineError, scaleRect, SOURCE_MAX_SIDE } from "./fabricPipeline";

describe("bounded source image", () => {
  it("keeps the selection aligned when the source is downscaled", () => {
    // A 4000px-wide photo is sent at SOURCE_MAX_SIDE; a selection made in
    // natural pixels has to shrink by the same factor or it lands on the
    // wrong garment.
    const scale = SOURCE_MAX_SIDE / 4000;
    const rect = scaleRect({ x: 1000, y: 2000, width: 400, height: 300 }, scale);
    expect(rect.x).toBeCloseTo(320);
    expect(rect.y).toBeCloseTo(640);
    expect(rect.width).toBeCloseTo(128);
    expect(rect.height).toBeCloseTo(96);
  });

  it("is the identity for images already within the bound", () => {
    expect(scaleRect({ x: 10, y: 20, width: 30, height: 40 }, 1)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

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

  it("sends the chosen quality tier, and nothing for auto", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ swatchDataUrl: "x" }), { status: 200 });
    }));
    await runFabricCopy("data:image/png;base64,", null, { quality: "fast" });
    await runFabricCopy("data:image/png;base64,", null, { quality: "auto" });
    await runFabricCopy("data:image/png;base64,", null);
    expect(bodies.map((b) => b.quality)).toEqual(["fast", null, null]);
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
