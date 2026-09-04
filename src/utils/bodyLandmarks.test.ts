import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedBodyLandmark } from "./bodyLandmarks";
import { extractUpperBodyPoints, smoothUpperBodyPoints } from "./bodyLandmarks";

const POSE = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

const VISIBLE = 0.95;
const HIDDEN = 0.1;

function pose(
  overrides: Partial<Record<number, NormalizedBodyLandmark>>,
): NormalizedBodyLandmark[] {
  const landmarks: NormalizedBodyLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
  }));
  for (const [index, landmark] of Object.entries(overrides)) {
    if (landmark) landmarks[Number(index)] = landmark;
  }
  return landmarks;
}

/** Shoulders and nose visible; hips supplied by the caller. */
function upperBodyOnly(
  overrides: Partial<Record<number, NormalizedBodyLandmark>> = {},
  shoulderY = 0.5,
): NormalizedBodyLandmark[] {
  return pose({
    [POSE.nose]: { x: 0.5, y: shoulderY - 0.2, visibility: VISIBLE },
    [POSE.leftShoulder]: { x: 0.3, y: shoulderY, visibility: VISIBLE },
    [POSE.rightShoulder]: { x: 0.7, y: shoulderY, visibility: VISIBLE },
    ...overrides,
  });
}

describe("extractUpperBodyPoints", () => {
  it("marks hips as estimated when MediaPipe cannot see them", () => {
    const points = extractUpperBodyPoints(upperBodyOnly());

    assert.ok(points.leftHip && points.rightHip, "hips should still be projected");
    assert.equal(points.leftHip.estimated, true);
    assert.equal(points.rightHip.estimated, true);
    assert.equal(points.torsoCenter?.estimated, true);
  });

  it("does not mark hips as estimated when they are actually measured", () => {
    const points = extractUpperBodyPoints(
      upperBodyOnly({
        [POSE.leftHip]: { x: 0.36, y: 0.85, visibility: VISIBLE },
        [POSE.rightHip]: { x: 0.64, y: 0.85, visibility: VISIBLE },
      }),
    );

    assert.equal(points.leftHip?.estimated, false);
    assert.equal(points.rightHip?.estimated, false);
    assert.equal(points.torsoCenter?.estimated, false);
  });

  it("keeps projected hips inside the frame for a close-up subject", () => {
    // Shoulders low and wide, so the default torso projection would land well
    // below the bottom edge and drag the skeleton off screen.
    const points = extractUpperBodyPoints(upperBodyOnly({}, 0.6));

    assert.ok(points.leftHip && points.rightHip);
    for (const hip of [points.leftHip, points.rightHip]) {
      assert.ok(hip.y <= 1, `hip y ${hip.y} should stay in frame`);
      assert.ok(hip.y > 0.6, "hip should still sit below the shoulders");
    }
    assert.ok((points.torsoCenter?.y ?? 0) <= 1);
  });

  it("does not clamp hips that were genuinely measured off frame", () => {
    const points = extractUpperBodyPoints(
      upperBodyOnly(
        {
          [POSE.leftHip]: { x: 0.34, y: 1.18, visibility: VISIBLE },
          [POSE.rightHip]: { x: 0.66, y: 1.18, visibility: VISIBLE },
        },
        0.6,
      ),
    );

    assert.ok((points.leftHip?.y ?? 0) > 1, "a real measurement is left alone");
    assert.equal(points.leftHip?.estimated, false);
  });

  it("omits joints below the visibility threshold", () => {
    const points = extractUpperBodyPoints(
      upperBodyOnly({
        [POSE.leftElbow]: { x: 0.2, y: 0.2, visibility: HIDDEN },
        [POSE.rightElbow]: { x: 0.8, y: 0.6, visibility: VISIBLE },
      }),
    );

    assert.equal(points.leftElbow, undefined);
    assert.ok(points.rightElbow, "a visible elbow is kept");
  });

  it("returns nothing without shoulders to build from", () => {
    const points = extractUpperBodyPoints(pose({}));
    assert.deepEqual(points, {});
  });
});

describe("smoothUpperBodyPoints", () => {
  it("carries the estimated flag through smoothing", () => {
    const previous = extractUpperBodyPoints(upperBodyOnly());
    const current = extractUpperBodyPoints(upperBodyOnly());
    const smoothed = smoothUpperBodyPoints(previous, current);

    assert.equal(smoothed.leftHip?.estimated, true);
    assert.equal(smoothed.torsoCenter?.estimated, true);
  });

  it("updates the flag when hips become measured", () => {
    const previous = extractUpperBodyPoints(upperBodyOnly());
    const current = extractUpperBodyPoints(
      upperBodyOnly({
        [POSE.leftHip]: { x: 0.36, y: 0.85, visibility: VISIBLE },
        [POSE.rightHip]: { x: 0.64, y: 0.85, visibility: VISIBLE },
      }),
    );
    const smoothed = smoothUpperBodyPoints(previous, current);

    assert.equal(smoothed.leftHip?.estimated, false);
  });

  it("still interpolates position", () => {
    const smoothed = smoothUpperBodyPoints(
      { leftShoulder: { x: 0, y: 0 } },
      { leftShoulder: { x: 1, y: 1 } },
      0.5,
    );
    assert.equal(smoothed.leftShoulder?.x, 0.5);
  });
});
