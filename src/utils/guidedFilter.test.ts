import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refineMaskEdges } from "./guidedFilter";

const WIDTH = 200;
const HEIGHT = 64;
const MID_ROW = 32;
/** Where the guide frame's real edge sits. */
const GUIDE_EDGE = 100;
/** Where the segmentation mask wrongly puts the boundary. */
const MASK_EDGE = 88;
/** Width of the mask's soft transition, as MediaPipe actually delivers it. */
const MASK_RAMP = 10;

function makeImage(width = WIDTH, height = HEIGHT): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: "srgb",
  } as ImageData;
}

function setPixel(image: ImageData, x: number, y: number, value: number): void {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = value;
  image.data[offset + 1] = value;
  image.data[offset + 2] = value;
  image.data[offset + 3] = value;
}

function readAlpha(image: ImageData, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] / 255;
}

/** Dark subject on a bright background, with a hard vertical edge. */
function makeSteppedGuide(): ImageData {
  const guide = makeImage();
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      setPixel(guide, x, y, x < GUIDE_EDGE ? 50 : 230);
    }
  }
  return guide;
}

function makeFlatGuide(level: number): ImageData {
  const guide = makeImage();
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) setPixel(guide, x, y, level);
  }
  return guide;
}

/**
 * Mask covering x < center, with a soft smoothstep transition — the shape
 * selfie segmentation really produces — misaligned with the guide by design.
 */
function makeOffsetMask(center = MASK_EDGE, ramp = MASK_RAMP): ImageData {
  const mask = makeImage();
  const start = center - ramp / 2;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const t = Math.max(0, Math.min(1, (x - start) / ramp));
      const eased = t * t * (3 - 2 * t);
      setPixel(mask, x, y, Math.round((1 - eased) * 255));
    }
  }
  return mask;
}

/** Sub-pixel x where the mask crosses 0.5, scanning left to right. */
function boundaryCrossing(mask: ImageData, row = MID_ROW): number {
  for (let x = 1; x < mask.width; x += 1) {
    const previous = readAlpha(mask, x - 1, row);
    const current = readAlpha(mask, x, row);
    if (previous >= 0.5 && current < 0.5) {
      return x - 1 + (previous - 0.5) / Math.max(1e-6, previous - current);
    }
  }
  return mask.width;
}

describe("refineMaskEdges", () => {
  it("pulls a 12px misalignment to within a pixel of the true edge", () => {
    const mask = makeOffsetMask();
    const before = boundaryCrossing(mask);
    assert.ok(Math.abs(before - MASK_EDGE) < 1, `fixture should start at ${MASK_EDGE}`);

    refineMaskEdges(mask, makeSteppedGuide(), WIDTH, HEIGHT);

    const after = boundaryCrossing(mask);
    assert.ok(
      Math.abs(after - GUIDE_EDGE) <= 1.5,
      `boundary ${after.toFixed(1)} should land within 1.5px of ${GUIDE_EDGE}`,
    );
  });

  it("corrects more of the error as the radius grows", () => {
    const errorFor = (radius: number) => {
      const mask = makeOffsetMask();
      refineMaskEdges(mask, makeSteppedGuide(), WIDTH, HEIGHT, { radius });
      return Math.abs(boundaryCrossing(mask) - GUIDE_EDGE);
    };

    const tight = errorFor(8);
    const wide = errorFor(32);
    assert.ok(wide < tight, `radius 32 (${wide}) should beat radius 8 (${tight})`);
    // A radius too small to span the misalignment cannot fix it.
    assert.ok(tight > 8, `radius 8 should leave most of the 12px error, got ${tight}`);
  });

  it("does not drag the boundary off an already-correct edge", () => {
    const mask = makeOffsetMask(GUIDE_EDGE);
    refineMaskEdges(mask, makeSteppedGuide(), WIDTH, HEIGHT);

    const after = boundaryCrossing(mask);
    assert.ok(Math.abs(after - GUIDE_EDGE) <= 1.5, `boundary drifted to ${after}`);
  });

  it("keeps the interior and the far background intact", () => {
    const mask = makeOffsetMask();
    refineMaskEdges(mask, makeSteppedGuide(), WIDTH, HEIGHT);

    assert.ok(readAlpha(mask, 8, MID_ROW) > 0.9, "deep interior should stay opaque");
    assert.ok(readAlpha(mask, 190, MID_ROW) < 0.1, "far background should stay clear");
  });

  it("leaves the boundary put when the guide has no edges to follow", () => {
    const mask = makeOffsetMask();
    refineMaskEdges(mask, makeFlatGuide(128), WIDTH, HEIGHT);

    // With no gradient the local model degenerates to the local mean, so the
    // boundary should not wander off looking for one.
    const after = boundaryCrossing(mask);
    assert.ok(Math.abs(after - MASK_EDGE) <= 2, `boundary drifted to ${after}`);
    assert.ok(readAlpha(mask, 8, MID_ROW) > 0.9);
    assert.ok(readAlpha(mask, 190, MID_ROW) < 0.1);
  });

  it("produces the same boundary at full and subsampled resolution", () => {
    const full = makeOffsetMask();
    const fast = makeOffsetMask();

    refineMaskEdges(full, makeSteppedGuide(), WIDTH, HEIGHT, { subsample: 1 });
    refineMaskEdges(fast, makeSteppedGuide(), WIDTH, HEIGHT, { subsample: 4 });

    const difference = Math.abs(boundaryCrossing(full) - boundaryCrossing(fast));
    assert.ok(difference <= 1.5, `subsampling shifted the boundary by ${difference}px`);
  });

  it("only writes inside the requested region", () => {
    const mask = makeOffsetMask();
    const untouched = makeOffsetMask();
    const region = { minX: 60, minY: 20, maxX: 140, maxY: 44 };

    refineMaskEdges(mask, makeSteppedGuide(), WIDTH, HEIGHT, { region });

    // Inside the region the boundary is corrected.
    assert.ok(Math.abs(boundaryCrossing(mask) - GUIDE_EDGE) <= 1.5);
    // Rows outside it keep their original bytes.
    for (let x = 0; x < WIDTH; x += 1) {
      assert.equal(readAlpha(mask, x, 5), readAlpha(untouched, x, 5));
    }
    // So do columns outside it.
    for (let x = 0; x < region.minX; x += 1) {
      assert.equal(readAlpha(mask, x, MID_ROW), readAlpha(untouched, x, MID_ROW));
    }
  });

  it("keeps every channel finite and in range", () => {
    const mask = makeOffsetMask();
    refineMaskEdges(mask, makeSteppedGuide(), WIDTH, HEIGHT);

    for (let index = 0; index < mask.data.length; index += 1) {
      const value = mask.data[index];
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 255);
    }
  });

  it("recovers confidence from an alpha-only mask encoding", () => {
    const mask = makeImage();
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const offset = (y * mask.width + x) * 4;
        mask.data[offset + 3] = x < MASK_EDGE ? 255 : 0;
      }
    }

    refineMaskEdges(mask, makeSteppedGuide(), WIDTH, HEIGHT);

    assert.ok(readAlpha(mask, 8, MID_ROW) > 0.9, "interior should survive the fallback");
    assert.ok(readAlpha(mask, 190, MID_ROW) < 0.1);
  });

  it("leaves degenerate frames alone", () => {
    const mask = makeImage(1, 1);
    setPixel(mask, 0, 0, 200);
    refineMaskEdges(mask, makeImage(1, 1), 1, 1);
    assert.equal(mask.data[3], 200);
  });
});
