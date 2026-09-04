import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UpperBodyPoints } from "./bodyLandmarks";
import { refinePersonMask, silhouetteSpanAtY } from "./bodyOutline";

const WIDTH = 160;
const HEIGHT = 120;

/** Minimal stand-in for a browser ImageData. */
function makeMask(width = WIDTH, height = HEIGHT): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: "srgb",
  } as ImageData;
}

function fillRect(
  mask: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = (y * mask.width + x) * 4;
      mask.data[offset] = 255;
      mask.data[offset + 1] = 255;
      mask.data[offset + 2] = 255;
      mask.data[offset + 3] = 255;
    }
  }
}

function isSet(mask: ImageData, x: number, y: number): boolean {
  return mask.data[(y * mask.width + x) * 4 + 3] > 128;
}

function countSet(mask: ImageData): number {
  let total = 0;
  for (let index = 3; index < mask.data.length; index += 4) {
    if (mask.data[index] > 128) total += 1;
  }
  return total;
}

/** Seated person centered in frame, shoulders level, hips visible. */
function seatedPerson(): UpperBodyPoints {
  return {
    leftShoulder: { x: 0.4, y: 0.35 },
    rightShoulder: { x: 0.6, y: 0.35 },
    leftShoulderOuter: { x: 0.36, y: 0.35 },
    rightShoulderOuter: { x: 0.64, y: 0.35 },
    neck: { x: 0.5, y: 0.3 },
    torsoCenter: { x: 0.5, y: 0.55 },
    leftHip: { x: 0.42, y: 0.78 },
    rightHip: { x: 0.58, y: 0.78 },
    leftElbow: { x: 0.34, y: 0.55 },
    rightElbow: { x: 0.66, y: 0.55 },
    leftWrist: { x: 0.32, y: 0.7 },
    rightWrist: { x: 0.68, y: 0.7 },
  };
}

/** Torso column plus head, matching the landmark layout above. */
function drawBody(mask: ImageData): void {
  fillRect(mask, 58, 42, 102, 96);
  fillRect(mask, 70, 22, 90, 44);
}

/** Leaning subject at camera resolution with the left arm raised out of frame. */
function raisedArmPerson(): UpperBodyPoints {
  return {
    leftShoulder: { x: 0.41, y: 0.385 },
    rightShoulder: { x: 0.64, y: 0.385 },
    leftShoulderOuter: { x: 0.37, y: 0.385 },
    rightShoulderOuter: { x: 0.68, y: 0.385 },
    neck: { x: 0.525, y: 0.34 },
    torsoCenter: { x: 0.525, y: 0.6 },
    leftHip: { x: 0.43, y: 0.85 },
    rightHip: { x: 0.62, y: 0.85 },
  };
}

/** 640x480 torso, head, and an arm angled up toward the top-left corner. */
function drawRaisedArmBody(mask: ImageData): void {
  fillRect(mask, 250, 170, 419, 439);
  fillRect(mask, 285, 80, 384, 174);
  for (let step = 0; step <= 500; step += 1) {
    const t = step / 500;
    const centerX = Math.round(260 + (60 - 260) * t);
    const centerY = Math.round(185 + (40 - 185) * t);
    for (let dy = -35; dy <= 35; dy += 1) {
      for (let dx = -35; dx <= 35; dx += 1) {
        if (dx * dx + dy * dy > 35 * 35) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) continue;
        const offset = (y * mask.width + x) * 4;
        mask.data[offset] = 255;
        mask.data[offset + 1] = 255;
        mask.data[offset + 2] = 255;
        mask.data[offset + 3] = 255;
      }
    }
  }
}

describe("refinePersonMask", () => {
  it("removes a detached chair region the model swept in", () => {
    const mask = makeMask();
    drawBody(mask);
    // Chair back and armrest, well outside the body envelope.
    fillRect(mask, 4, 60, 30, 110);
    fillRect(mask, 130, 60, 156, 110);

    const before = countSet(mask);
    refinePersonMask(mask, seatedPerson(), WIDTH, HEIGHT);

    assert.ok(isSet(mask, 80, 60), "torso should survive");
    assert.ok(isSet(mask, 80, 30), "head should survive");
    assert.ok(!isSet(mask, 12, 80), "left chair region should be cleared");
    assert.ok(!isSet(mask, 145, 80), "right chair region should be cleared");
    assert.ok(countSet(mask) < before);
  });

  it("removes furniture even when it touches the person", () => {
    const mask = makeMask();
    drawBody(mask);
    // Armrest bridged to the torso by a thin band of mask pixels.
    fillRect(mask, 103, 70, 156, 78);

    refinePersonMask(mask, seatedPerson(), WIDTH, HEIGHT);

    assert.ok(isSet(mask, 80, 60), "torso should survive");
    assert.ok(!isSet(mask, 150, 74), "far armrest should be cleared");
  });

  it("keeps the arms, which sit outside the torso polygon", () => {
    const mask = makeMask();
    drawBody(mask);
    // Forearm running down toward the wrist landmark at (0.68, 0.70).
    fillRect(mask, 100, 66, 112, 86);

    refinePersonMask(mask, seatedPerson(), WIDTH, HEIGHT);

    assert.ok(isSet(mask, 106, 76), "forearm near the wrist should survive");
  });

  it("keeps a raised arm when MediaPipe drops the elbow", () => {
    const width = 640;
    const height = 480;
    // Same pose, but the arm landmarks are missing — the case that deleted the
    // arm entirely, because chain() produced no capsule to cover it.
    const withElbow: UpperBodyPoints = {
      ...raisedArmPerson(),
      leftElbow: { x: 0.2, y: 0.2 },
      leftWrist: { x: 0.09, y: 0.08 },
    };

    for (const [label, points] of [
      ["elbow detected", withElbow],
      ["elbow dropped", raisedArmPerson()],
    ] as const) {
      const mask = makeMask(width, height);
      drawRaisedArmBody(mask);
      refinePersonMask(mask, points, width, height);

      for (const [x, y] of [
        [240, 175],
        [200, 145],
        [150, 110],
        [100, 75],
      ] as const) {
        assert.ok(isSet(mask, x, y), `${label}: arm at ${x},${y} should survive`);
      }
      assert.ok(isSet(mask, 330, 300), `${label}: torso should survive`);
    }
  });

  it("still removes furniture while covering an arm it cannot trace", () => {
    const width = 640;
    const height = 480;
    const mask = makeMask(width, height);
    drawRaisedArmBody(mask);
    fillRect(mask, 520, 250, 629, 449);

    refinePersonMask(mask, raisedArmPerson(), width, height);

    assert.ok(isSet(mask, 150, 110), "raised arm should survive");
    assert.ok(!isSet(mask, 570, 350), "chair should still be removed");
  });

  it("rejects a bulky object attached where an untraced arm should be", () => {
    const width = 640;
    const height = 480;
    const mask = makeMask(width, height);
    drawRaisedArmBody(mask);
    // Cabinet abutting the torso, within reach of the untraced right arm and
    // connected to the body, so only its bulk rules it out.
    fillRect(mask, 420, 200, 600, 439);

    refinePersonMask(mask, raisedArmPerson(), width, height);

    assert.ok(isSet(mask, 150, 110), "raised arm should survive");
    assert.ok(!isSet(mask, 520, 320), "cabinet interior should be cleared");
  });

  it("does not grow past a fully traced arm onto what it rests on", () => {
    const mask = makeMask();
    drawBody(mask);
    // Thin armrest under the traced forearm: limb-shaped and connected, so the
    // growth pass would take it if a traced arm still opened one.
    fillRect(mask, 103, 70, 156, 78);

    refinePersonMask(mask, seatedPerson(), WIDTH, HEIGHT);

    assert.ok(isSet(mask, 80, 60), "torso should survive");
    assert.ok(!isSet(mask, 150, 74), "armrest beyond the wrist should be cleared");
  });

  it("keeps a thick upper arm, which the untapered capsule clipped", () => {
    const width = 640;
    const height = 480;
    const mask = makeMask(width, height);
    drawRaisedArmBody(mask);
    // Deltoid bulge just outboard of the shoulder, wider than a forearm.
    fillRect(mask, 196, 150, 286, 240);

    refinePersonMask(
      mask,
      { ...raisedArmPerson(), leftElbow: { x: 0.2, y: 0.2 }, leftWrist: { x: 0.09, y: 0.08 } },
      width,
      height,
    );

    assert.ok(isSet(mask, 210, 200), "upper arm near the shoulder should survive");
  });

  it("leaves the mask untouched when landmarks are too sparse", () => {
    const mask = makeMask();
    drawBody(mask);
    fillRect(mask, 4, 60, 30, 110);
    const before = countSet(mask);

    refinePersonMask(mask, { neck: { x: 0.5, y: 0.3 } }, WIDTH, HEIGHT);

    assert.equal(countSet(mask), before);
  });

  it("keeps the original mask when the body region is empty", () => {
    const mask = makeMask();
    // Only furniture, no person pixels near the landmarks.
    fillRect(mask, 4, 60, 30, 110);
    const before = countSet(mask);

    refinePersonMask(mask, seatedPerson(), WIDTH, HEIGHT);

    assert.equal(countSet(mask), before);
  });

  it("removes furniture at camera resolution, where the gate runs on a coarse grid", () => {
    const width = 640;
    const height = 480;
    const mask = makeMask(width, height);
    // Torso, head, and an office chair flanking the person on both sides.
    fillRect(mask, 232, 168, 408, 384);
    fillRect(mask, 280, 88, 360, 176);
    fillRect(mask, 16, 240, 120, 440);
    fillRect(mask, 520, 240, 624, 440);

    refinePersonMask(mask, seatedPerson(), width, height);

    assert.ok(isSet(mask, 320, 240), "torso should survive");
    assert.ok(isSet(mask, 320, 120), "head should survive");
    assert.ok(!isSet(mask, 60, 340), "left chair should be cleared");
    assert.ok(!isSet(mask, 570, 340), "right chair should be cleared");

    const span = silhouetteSpanAtY(mask, 300, width, height);
    assert.ok(span, "a span should remain");
    // Within a grid cell of the torso, not stretched out to the chairs.
    assert.ok(span.left >= 230 && span.right <= 410, `span ${span.left}..${span.right}`);
  });

  it("narrows the measured span once furniture is gone", () => {
    const mask = makeMask();
    drawBody(mask);
    fillRect(mask, 130, 60, 156, 110);

    const dirty = silhouetteSpanAtY(mask, 80, WIDTH, HEIGHT);
    refinePersonMask(mask, seatedPerson(), WIDTH, HEIGHT);
    const clean = silhouetteSpanAtY(mask, 80, WIDTH, HEIGHT);

    assert.ok(dirty && clean);
    assert.ok(dirty.right - dirty.left > clean.right - clean.left);
    assert.ok(clean.right <= 103);
  });
});
