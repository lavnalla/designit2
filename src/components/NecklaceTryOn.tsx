"use client";

import React, { useEffect, useRef, useState } from "react";
import Script from "next/script";

interface MetricData {
  shoulderCenterNorm: number;
  shoulderYNorm: number;
  leftShoulderNorm: { x: number; y: number };
  rightShoulderNorm: { x: number; y: number };
  backNeckNorm: { x: number; y: number };
}

interface NecklaceTryOnProps {
  selectedImageSrc: string;
  mode?: "garment" | "necklace" | "earrings";
  inputSource?: "webcam" | "photo";
  // Same-size mask from GarmentPartPainter: arm red, body green, neck blue, shoulders yellow
  partMaskSrc?: string | null;
  onClose?: () => void;
}

interface OverlayBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

interface NecklaceAnchorPoints {
  leftNeckX: number;
  rightNeckX: number;
  neckY: number;
  centerX: number;
}

interface EarringAssetSet {
  left: HTMLCanvasElement;
  right: HTMLCanvasElement;
}

const FACE_LANDMARKS = {
  leftTemple: 234,
  rightTemple: 454,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  mouthLeft: 61,
  mouthRight: 291,
} as const;

function getNecklacePlacement(
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  chin?: { x: number; y: number },
) {
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  if (!leftShoulder || !rightShoulder) return null;

  const leftShoulderX = leftShoulder.x * width;
  const rightShoulderX = rightShoulder.x * width;
  const leftShoulderY = leftShoulder.y * height;
  const rightShoulderY = rightShoulder.y * height;
  const shoulderSpan = Math.max(1, Math.abs(rightShoulderX - leftShoulderX));
  const shoulderMidX = (leftShoulderX + rightShoulderX) / 2;
  const shoulderMidY = (leftShoulderY + rightShoulderY) / 2;

  if (chin) {
    const chinX = chin.x * width;
    const chinY = chin.y * height;

    return {
      chainStartX: leftShoulderX + (chinX - leftShoulderX) * 0.4,
      chainStartY: leftShoulderY + (chinY - leftShoulderY) * 0.3,
      chainEndX: rightShoulderX - (rightShoulderX - chinX) * 0.4,
      chainEndY: rightShoulderY + (chinY - rightShoulderY) * 0.3,
      controlX: chinX,
    };
  }

  const fallbackNeckY = shoulderMidY - shoulderSpan * 0.18;

  return {
    chainStartX: leftShoulderX + shoulderSpan * 0.18,
    chainStartY: fallbackNeckY,
    chainEndX: rightShoulderX - shoulderSpan * 0.18,
    chainEndY: fallbackNeckY,
    controlX: shoulderMidX,
  };
}

function getNecklaceFallbackAnchors(bounds: OverlayBounds) {
  const upperBandHeight = Math.max(6, Math.floor(bounds.height * 0.22));
  const neckY = bounds.minY + upperBandHeight;
  const inset = bounds.width * 0.18;

  return {
    leftNeckX: bounds.minX + inset,
    rightNeckX: bounds.maxX - inset,
    neckY,
    centerX: (bounds.minX + bounds.maxX) / 2,
  };
}

function hasVisiblePixels(canvas: HTMLCanvasElement, minOpaquePixels: number) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let opaquePixels = 0;

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 20) {
      opaquePixels += 1;
      if (opaquePixels >= minOpaquePixels) {
        return true;
      }
    }
  }

  return false;
}

type PieceBox = { minX: number; minY: number; maxX: number; maxY: number };

// Per-row left/right extent of a region (a row is empty when maxX < minX)
type RowExtents = { minX: Int32Array; maxX: Int32Array };

function rowExtents(w: number, h: number, isSet: (p: number) => boolean): RowExtents {
  const minX = new Int32Array(h).fill(w);
  const maxX = new Int32Array(h).fill(-1);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!isSet(y * w + x)) continue;
      if (x < minX[y]) minX[y] = x;
      maxX[y] = x; // x only increases, so the last hit is the rightmost
    }
  }
  return { minX, maxX };
}

// First and last non-empty rows, and the median width across the top quarter (a torso's chest, the top of
// a sleeve or arm). Null when the region is empty.
function rowSpan(rows: RowExtents): { top: number; bottom: number; topWidth: number } | null {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < rows.minX.length; y += 1) {
    if (rows.maxX[y] < rows.minX[y]) continue;
    if (top < 0) top = y;
    bottom = y;
  }
  if (top < 0) return null;
  const end = top + Math.max(1, Math.round((bottom - top) * 0.25));
  const widths: number[] = [];
  for (let y = top; y <= end; y += 1) {
    if (rows.maxX[y] >= rows.minX[y]) widths.push(rows.maxX[y] - rows.minX[y] + 1);
  }
  widths.sort((a, b) => a - b);
  return { top, bottom, topWidth: widths[Math.floor(widths.length / 2)] };
}

// The garment split by the part mask, in garment-image pixel coordinates.
// Torso = body + neck + shoulders (+ unlabelled garment pixels), which move together;
// sleeves are rotated separately to follow the arms.
type GarmentPieces = {
  torso: HTMLCanvasElement;
  bodyBox: PieceBox;
  shoulderLineY: number;
  // The whole garment, and its two shoulder points (where each shoulder meets its sleeve, in garment-image
  // pixels), which photo mode places on the model's shoulders
  whole: HTMLCanvasElement;
  shoulders: { left: { x: number; y: number }; right: { x: number; y: number } };
  sleeves: Array<{ canvas: HTMLCanvasElement; box: PieceBox; side: "left" | "right" }>;
};

type PoseLandmark = { x: number; y: number; visibility?: number };

// Garment body panel width relative to the distance between the shoulder joints
const TORSO_WIDTH_RATIO = 1.2;
const MIN_PIECE_PIXELS = 50;

function emptyBox(): PieceBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function growBox(box: PieceBox, x: number, y: number) {
  if (x < box.minX) box.minX = x;
  if (x > box.maxX) box.maxX = x;
  if (y < box.minY) box.minY = y;
  if (y > box.maxY) box.maxY = y;
}

// Used when there's no usable part mask (none saved, or no body marked): the whole garment, with its
// shoulder points taken as its outline's left and right edges just below its top edge (a T-shirt's top
// edge runs from shoulder to shoulder).
function buildWholeGarmentPieces(garment: HTMLImageElement): GarmentPieces | null {
  const w = garment.naturalWidth;
  const h = garment.naturalHeight;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(garment, 0, 0);
  const alpha = ctx.getImageData(0, 0, w, h).data;

  const box = emptyBox();
  for (let p = 0; p < w * h; p += 1) {
    if (alpha[p * 4 + 3] >= 16) growBox(box, p % w, Math.floor(p / w));
  }
  if (box.maxX < box.minX) return null;

  const shoulderY = Math.round(box.minY + (box.maxY - box.minY) * 0.03);
  let edgeLeft = box.minX;
  let edgeRight = box.maxX;
  for (let x = box.minX; x <= box.maxX; x += 1) {
    if (alpha[(shoulderY * w + x) * 4 + 3] >= 16) {
      edgeLeft = x;
      break;
    }
  }
  for (let x = box.maxX; x >= box.minX; x -= 1) {
    if (alpha[(shoulderY * w + x) * 4 + 3] >= 16) {
      edgeRight = x;
      break;
    }
  }

  return {
    torso: canvas,
    whole: canvas,
    shoulders: { left: { x: edgeLeft, y: shoulderY }, right: { x: edgeRight, y: shoulderY } },
    bodyBox: box,
    shoulderLineY: box.minY + (box.maxY - box.minY) * 0.05,
    sleeves: [],
  };
}

function buildGarmentPieces(garment: HTMLImageElement, mask: HTMLImageElement): GarmentPieces | null {
  const w = garment.naturalWidth;
  const h = garment.naturalHeight;
  if (!w || !h) return null;

  const garmentCanvas = document.createElement("canvas");
  garmentCanvas.width = w;
  garmentCanvas.height = h;
  const garmentCtx = garmentCanvas.getContext("2d", { willReadFrequently: true });
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!garmentCtx || !maskCtx) return null;
  garmentCtx.drawImage(garment, 0, 0);
  maskCtx.drawImage(mask, 0, 0, w, h);
  const g = garmentCtx.getImageData(0, 0, w, h).data;
  const m = maskCtx.getImageData(0, 0, w, h).data;

  // 0 none, 1 torso, 2 arm
  const labels = new Uint8Array(w * h);
  const bodyBox = emptyBox();
  const shoulderBox = emptyBox();
  let bodyPixels = 0;
  let shoulderPixels = 0;
  // Outer ends of the painter's shoulder (yellow) marks
  const shoulderLeft = { x: Infinity, y: 0 };
  const shoulderRight = { x: -Infinity, y: 0 };

  for (let i = 0, p = 0; p < labels.length; i += 4, p += 1) {
    if (g[i + 3] < 16) continue;
    const x = p % w;
    const y = (p - x) / w;
    const labelled = m[i + 3] > 40;
    const r = m[i] > 127;
    const gr = m[i + 1] > 127;
    const b = m[i + 2] > 127;

    if (labelled && r && gr) {
      labels[p] = 1;
      growBox(shoulderBox, x, y);
      shoulderPixels += 1;
      if (x < shoulderLeft.x) {
        shoulderLeft.x = x;
        shoulderLeft.y = y;
      }
      if (x > shoulderRight.x) {
        shoulderRight.x = x;
        shoulderRight.y = y;
      }
    } else if (labelled && r) {
      labels[p] = 2;
    } else if (labelled && gr) {
      labels[p] = 1;
      growBox(bodyBox, x, y);
      bodyPixels += 1;
    } else {
      // The neck (blue) rides with the torso. Unmarked pixels are the photo's background, not garment —
      // the workspace export is often a solid rectangle when the garment photo kept its background.
      labels[p] = labelled && b ? 1 : 0;
    }
  }

  if (bodyPixels < MIN_PIECE_PIXELS) return null;
  const centerX = (bodyBox.minX + bodyBox.maxX) / 2;

  const torso = new ImageData(w, h);
  const wholeData = new ImageData(w, h); // every marked garment pixel: the garment cut out of its background
  const left = new ImageData(w, h);
  const right = new ImageData(w, h);
  const leftBox = emptyBox();
  const rightBox = emptyBox();
  let leftPixels = 0;
  let rightPixels = 0;

  for (let i = 0, p = 0; p < labels.length; i += 4, p += 1) {
    const label = labels[p];
    if (!label) continue;
    const x = p % w;
    const y = (p - x) / w;
    let target = torso;
    if (label === 2) {
      if (x < centerX) {
        target = left;
        growBox(leftBox, x, y);
        leftPixels += 1;
      } else {
        target = right;
        growBox(rightBox, x, y);
        rightPixels += 1;
      }
    }
    target.data[i] = g[i];
    target.data[i + 1] = g[i + 1];
    target.data[i + 2] = g[i + 2];
    target.data[i + 3] = g[i + 3];
    wholeData.data[i] = g[i];
    wholeData.data[i + 1] = g[i + 1];
    wholeData.data[i + 2] = g[i + 2];
    wholeData.data[i + 3] = g[i + 3];
  }

  const toCanvas = (data: ImageData) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")?.putImageData(data, 0, 0);
    return c;
  };

  const sleeves: GarmentPieces["sleeves"] = [];
  if (leftPixels >= MIN_PIECE_PIXELS) sleeves.push({ canvas: toCanvas(left), box: leftBox, side: "left" });
  if (rightPixels >= MIN_PIECE_PIXELS) sleeves.push({ canvas: toCanvas(right), box: rightBox, side: "right" });

  // A sleeve's shoulder point: the top of its seam, i.e. its highest pixel touching the body
  // (else its inner top corner)
  const sleeveShoulder = (side: "left" | "right", box: PieceBox) => {
    const onThisSide = (x: number) => (side === "left" ? x < centerX : x >= centerX);
    for (let y = box.minY; y <= box.maxY; y += 1) {
      for (let x = box.minX; x <= box.maxX; x += 1) {
        const p = y * w + x;
        if (labels[p] !== 2 || !onThisSide(x)) continue;
        const touchesTorso =
          (x > 0 && labels[p - 1] === 1) ||
          (x < w - 1 && labels[p + 1] === 1) ||
          (y > 0 && labels[p - w] === 1) ||
          (y < h - 1 && labels[p + w] === 1);
        if (touchesTorso) return { x, y };
      }
    }
    return side === "left" ? { x: box.maxX, y: box.minY } : { x: box.minX, y: box.minY };
  };

  // The garment's shoulder points: the outer ends of the painter's shoulder marks if drawn, else the top
  // of each sleeve's seam, else the body's top corners
  const shoulders =
    shoulderPixels >= MIN_PIECE_PIXELS
      ? { left: { ...shoulderLeft }, right: { ...shoulderRight } }
      : {
          left: leftPixels >= MIN_PIECE_PIXELS ? sleeveShoulder("left", leftBox) : { x: bodyBox.minX, y: bodyBox.minY },
          right:
            rightPixels >= MIN_PIECE_PIXELS ? sleeveShoulder("right", rightBox) : { x: bodyBox.maxX, y: bodyBox.minY },
        };

  return {
    torso: toCanvas(torso),
    bodyBox,
    shoulderLineY:
      shoulderPixels >= MIN_PIECE_PIXELS ? (shoulderBox.minY + shoulderBox.maxY) / 2 : bodyBox.minY,
    whole: toCanvas(wholeData),
    shoulders,
    sleeves,
  };
}

// Draws the garment pieces onto ctx (w x h, same space as the pose landmarks):
// the torso aligned to the shoulder line, each sleeve rotated about its seam to follow that arm.
function drawGarmentPieces(
  ctx: CanvasRenderingContext2D,
  pieces: GarmentPieces,
  lm: PoseLandmark[],
  w: number,
  h: number,
  manualScale: number,
  offsetX: number,
  offsetY: number,
) {
  const a = lm[11];
  const b = lm[12];
  if (!a || !b) return;

  // The photo isn't mirrored, so match garment image-left to whichever shoulder is image-left
  const leftIsPoseLeft = a.x <= b.x;
  const armIndices = (side: "left" | "right") =>
    (side === "left") === leftIsPoseLeft ? { shoulder: 11, elbow: 13, wrist: 15 } : { shoulder: 12, elbow: 14, wrist: 16 };
  const point = (index: number) => ({ x: lm[index].x * w + offsetX, y: lm[index].y * h + offsetY });

  const leftShoulder = point(armIndices("left").shoulder);
  const rightShoulder = point(armIndices("right").shoulder);
  const shoulderDist = Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);
  if (shoulderDist < 1) return;

  // U runs along the shoulders, V points down the torso
  const ux = (rightShoulder.x - leftShoulder.x) / shoulderDist;
  const uy = (rightShoulder.y - leftShoulder.y) / shoulderDist;
  const vx = -uy;
  const vy = ux;

  const srcWidth = Math.max(1, pieces.bodyBox.maxX - pieces.bodyBox.minX);
  const dstWidth = shoulderDist * TORSO_WIDTH_RATIO * manualScale;
  const s = dstWidth / srcWidth;
  const overhang = (dstWidth - shoulderDist) / 2;
  const originX = leftShoulder.x - ux * overhang;
  const originY = leftShoulder.y - uy * overhang;

  const ta = s * ux;
  const tb = s * uy;
  const tc = s * vx;
  const td = s * vy;
  const te = originX - ta * pieces.bodyBox.minX - tc * pieces.shoulderLineY;
  const tf = originY - tb * pieces.bodyBox.minX - td * pieces.shoulderLineY;
  const toPhoto = (x: number, y: number) => ({ x: ta * x + tc * y + te, y: tb * x + td * y + tf });

  ctx.save();
  ctx.transform(ta, tb, tc, td, te, tf);
  ctx.drawImage(pieces.torso, 0, 0);
  ctx.restore();

  for (const sleeve of pieces.sleeves) {
    const box = sleeve.box;
    // Seam = the sleeve corner nearest the body's top; cuff = the opposite corner
    const seam = sleeve.side === "left" ? { x: box.maxX, y: box.minY } : { x: box.minX, y: box.minY };
    const cuff = sleeve.side === "left" ? { x: box.minX, y: box.maxY } : { x: box.maxX, y: box.maxY };
    const seamPhoto = toPhoto(seam.x, seam.y);
    const cuffPhoto = toPhoto(cuff.x, cuff.y);
    const sleeveLength = Math.hypot(cuffPhoto.x - seamPhoto.x, cuffPhoto.y - seamPhoto.y);

    let angle = 0;
    const indices = armIndices(sleeve.side);
    const elbowLm = lm[indices.elbow];
    const wristLm = lm[indices.wrist];
    if (elbowLm && (elbowLm.visibility ?? 1) > 0.3 && sleeveLength > 1) {
      const elbow = point(indices.elbow);
      let target = elbow;
      const toElbow = Math.hypot(elbow.x - seamPhoto.x, elbow.y - seamPhoto.y);
      // Long sleeves continue past the elbow toward the wrist
      if (sleeveLength > toElbow && wristLm && (wristLm.visibility ?? 1) > 0.3) {
        const wrist = point(indices.wrist);
        const forearm = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
        const t = forearm > 0 ? Math.min(1, (sleeveLength - toElbow) / forearm) : 0;
        target = { x: elbow.x + (wrist.x - elbow.x) * t, y: elbow.y + (wrist.y - elbow.y) * t };
      }
      angle =
        Math.atan2(target.y - seamPhoto.y, target.x - seamPhoto.x) -
        Math.atan2(cuffPhoto.y - seamPhoto.y, cuffPhoto.x - seamPhoto.x);
    }

    ctx.save();
    ctx.translate(seamPhoto.x, seamPhoto.y);
    ctx.rotate(angle);
    ctx.translate(-seamPhoto.x, -seamPhoto.y);
    ctx.transform(ta, tb, tc, td, te, tf);
    ctx.drawImage(sleeve.canvas, 0, 0);
    ctx.restore();
  }
}

// The model's shoulder points in the photo, sorted so left is the image-left shoulder. From the shoulder
// lines found on the silhouette: horizontally the shoulder tips; vertically the top of the shoulder a
// quarter of the way out from the neck. Shoulders slope down to the tips, so putting the garment's (nearly
// flat) shoulder line at the tips' height left a gap above it; at this height the garment's shoulders
// rest on the model's and cover the slope out to the tips. Without shoulder lines, the pose's shoulder
// joints, raised by a tenth of the shoulder width (the joints sit below the top of the shoulder).
function modelShoulderPoints(
  body: BodyAnalysis | null,
  lm: PoseLandmark[] | null | undefined,
  w: number,
  h: number,
): { left: { x: number; y: number }; right: { x: number; y: number }; source: string } | null {
  if (body && body.shoulderLines.length >= 2) {
    const [leftLine, rightLine] = [...body.shoulderLines].sort((a, b) => a[0].x - b[0].x);
    const point = (line: Array<{ x: number; y: number }>) => ({
      x: line[line.length - 1].x,
      y: line[Math.round((line.length - 1) * 0.25)].y,
    });
    return { left: point(leftLine), right: point(rightLine), source: "shoulder lines" };
  }
  if (lm?.[11] && lm?.[12]) {
    const lift = Math.hypot((lm[12].x - lm[11].x) * w, (lm[12].y - lm[11].y) * h) * 0.1;
    const a = { x: lm[11].x * w, y: lm[11].y * h - lift };
    const b = { x: lm[12].x * w, y: lm[12].y * h - lift };
    const source = "pose shoulder joints";
    return a.x <= b.x ? { left: a, right: b, source } : { left: b, right: a, source };
  }
  return null;
}

// Photo mode: places the whole garment in one piece, upright, so its shoulders span the model's shoulder
// points and are centred on them — one move and scale, nothing stretched or turned. The garment's image-left shoulder goes on
// the model's image-left shoulder. Returns false when the garment has no shoulder points (data from older
// code that survived a hot reload).
function drawGarmentWhole(
  ctx: CanvasRenderingContext2D,
  pieces: GarmentPieces,
  modelLeft: { x: number; y: number },
  modelRight: { x: number; y: number },
  manualScale: number,
  offsetX: number,
  offsetY: number,
): boolean {
  const shoulders = pieces.shoulders as GarmentPieces["shoulders"] | undefined;
  if (!pieces.whole || !shoulders) return false;
  // Kept upright: garment photos are upright and people stand roughly level, so turning the garment to
  // match the two pairs of shoulder points only turned a small error in any one point into a visible
  // tilt. It's scaled so its shoulders span the model's from side to side (horizontal distances only).
  const garmentSpan = Math.abs(shoulders.right.x - shoulders.left.x);
  const modelSpan = Math.abs(modelRight.x - modelLeft.x);
  if (garmentSpan < 1 || modelSpan < 1) return false;

  const scale = (modelSpan / garmentSpan) * manualScale;
  // Scale about the middle of the shoulders, so the manual size buttons keep it centred there
  const garmentMidX = (shoulders.left.x + shoulders.right.x) / 2;
  const garmentMidY = (shoulders.left.y + shoulders.right.y) / 2;
  const modelMidX = (modelLeft.x + modelRight.x) / 2 + offsetX;
  const modelMidY = (modelLeft.y + modelRight.y) / 2 + offsetY;

  ctx.save();
  ctx.translate(modelMidX, modelMidY);
  ctx.scale(scale, scale);
  ctx.translate(-garmentMidX, -garmentMidY);
  ctx.drawImage(pieces.whole, 0, 0);
  ctx.restore();
  return true;
}

// Traces each shoulder along the top of the silhouette: from the side of the neck outward until the
// outline turns down the arm. The pose gives rough chin/shoulder positions; the silhouette gives the edge.
function traceShoulderLines(
  inside: Uint8Array,
  lm: PoseLandmark[] | null | undefined,
  face: PoseLandmark[] | null | undefined,
  w: number,
  h: number,
): Array<Array<{ x: number; y: number }>> {
  if (!lm?.[11] || !lm?.[12]) return [];
  const a = { x: lm[11].x * w, y: lm[11].y * h };
  const b = { x: lm[12].x * w, y: lm[12].y * h };
  const left = a.x <= b.x ? a : b;
  const right = a.x <= b.x ? b : a;
  const shoulderDist = Math.hypot(right.x - left.x, right.y - left.y);
  if (shoulderDist < 10) return [];

  const isInside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x] === 1;
  const shoulderY = (left.y + right.y) / 2;
  const chin = face?.[152];
  const chinY = chin ? chin.y * h : shoulderY - shoulderDist * 0.45;

  // A row partway down the neck, and the neck's left/right edges on it
  const neckRow = Math.round(chinY + (shoulderY - chinY) * 0.4);
  const centerX = Math.round(chin ? chin.x * w : (left.x + right.x) / 2);
  if (!isInside(centerX, neckRow)) return [];
  let neckLeft = centerX;
  while (isInside(neckLeft - 1, neckRow)) neckLeft -= 1;
  let neckRight = centerX;
  while (isInside(neckRight + 1, neckRow)) neckRight += 1;
  const neckWidth = neckRight - neckLeft + 1;
  // Wider than the shoulders means that row hit hair or the body, not the neck
  if (neckWidth > shoulderDist * 0.8) return [];

  const maxY = Math.min(h - 1, Math.round(shoulderY + shoulderDist * 0.5));
  const reach = shoulderDist * 0.35; // how far past the shoulder joint the outer edge can be

  const trace = (startX: number, step: number, limitX: number) => {
    const points: Array<{ x: number; y: number }> = [];
    let previousTop = -1;
    for (let x = startX; step < 0 ? x >= limitX : x <= limitX; x += step) {
      let top = -1;
      for (let y = neckRow; y <= maxY; y += 1) {
        if (isInside(x, y)) {
          top = y;
          break;
        }
      }
      if (top < 0) break;
      // Past the curve at the base of the neck, a steep drop means the outline turned down the arm
      if (previousTop >= 0 && points.length > neckWidth * 0.25 && top - previousTop > 4) break;
      previousTop = top;
      points.push({ x, y: top });
    }
    // Smooth the jagged mask edge
    return points.map((point, i) => {
      const nearby = points.slice(Math.max(0, i - 3), i + 4);
      return { x: point.x, y: nearby.reduce((sum, q) => sum + q.y, 0) / nearby.length };
    });
  };

  return [
    trace(neckLeft - 1, -1, Math.max(0, Math.floor(left.x - reach))),
    trace(neckRight + 1, 1, Math.min(w - 1, Math.ceil(right.x + reach))),
  ].filter((line) => line.length > 3);
}

// BodyPix labels every pixel with a body part, which gives the arms' exact shape.
// Arm part ids: 2,3,6,7,10 = the person's left upper arm, forearm and hand; 4,5,8,9,11 = right.
type BodyPixPartSegmentation = { width: number; height: number; data: Int32Array };
type BodyPixNet = {
  segmentPersonParts: (input: HTMLCanvasElement, config: Record<string, unknown>) => Promise<BodyPixPartSegmentation>;
};
const LEFT_ARM_PART_IDS = new Set([2, 3, 6, 7, 10]);
const RIGHT_ARM_PART_IDS = new Set([4, 5, 8, 9, 11]);

let bodyPixNetPromise: Promise<BodyPixNet> | null = null;

function loadBodyPix(): Promise<BodyPixNet> {
  if (!window.bodyPix) return Promise.reject(new Error("BodyPix script is not loaded"));
  if (!bodyPixNetPromise) {
    // Same model settings as BodySilhouette
    bodyPixNetPromise = window.bodyPix
      .load({ architecture: "MobileNetV1", outputStride: 16, multiplier: 0.75, quantBytes: 2 })
      .catch((err) => {
        bodyPixNetPromise = null; // allow a retry
        throw err;
      });
  }
  return bodyPixNetPromise;
}

// Rejects if the promise hasn't settled in time, so a hung download or GPU call becomes an error
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`timed out ${what} after ${ms / 1000}s`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Runs BodyPix on the GPU first. If WebGL errors ("Failed to link vertex and fragment shaders") or doesn't
// answer in time, switches TensorFlow.js to the CPU and retries at a lower resolution (the CPU is slower).
async function segmentWithBodyPix(canvas: HTMLCanvasElement): Promise<BodyPixPartSegmentation> {
  const gpuConfig = { flipHorizontal: false, internalResolution: "high", segmentationThreshold: 0.7 };
  const cpuConfig = { ...gpuConfig, internalResolution: "medium" };
  const onCpu = () => window.tf?.getBackend() === "cpu";
  const run = async (config: Record<string, unknown>, ms: number) => {
    const net = await withTimeout(loadBodyPix(), 60000, "loading the BodyPix model");
    return withTimeout(net.segmentPersonParts(canvas, config), ms, onCpu() ? "on the CPU" : "on the GPU");
  };

  if (onCpu()) return run(cpuConfig, 60000);
  try {
    return await run(gpuConfig, 15000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/shader|webgl|context|on the GPU/i.test(message) || !window.tf) throw err;
    console.warn(`[BodyPix] GPU problem (${message}); retrying on the CPU`);
    await window.tf.setBackend("cpu");
    await window.tf.ready();
    bodyPixNetPromise = null; // reload the model on the new backend
    return run(cpuConfig, 60000);
  }
}

// Arm labels from BodyPix, kept inside MediaPipe's silhouette so they line up with the outline.
// 1 / 2 = the arm on the image-left / right, matching labelArms.
function bodyPixArmLabels(parts: BodyPixPartSegmentation, inside: Uint8Array, w: number, h: number): Uint8Array {
  const labels = new Uint8Array(w * h);
  const scaleX = parts.width / w;
  const scaleY = parts.height / h;
  const sumX = [0, 0, 0];
  const count = [0, 0, 0];
  let bodySumX = 0;
  let bodyCount = 0;
  for (let y = 0; y < h; y += 1) {
    const partRow = Math.min(parts.height - 1, Math.floor(y * scaleY)) * parts.width;
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!inside[p]) continue;
      bodySumX += x;
      bodyCount += 1;
      const partId = parts.data[partRow + Math.min(parts.width - 1, Math.floor(x * scaleX))];
      const label = LEFT_ARM_PART_IDS.has(partId) ? 1 : RIGHT_ARM_PART_IDS.has(partId) ? 2 : 0;
      if (!label) continue;
      labels[p] = label;
      sumX[label] += x;
      count[label] += 1;
    }
  }

  // BodyPix's left/right is the person's; swap so 1 is whichever arm is on the image-left
  const meanX = (label: number) => sumX[label] / count[label];
  const bodyMeanX = bodySumX / Math.max(1, bodyCount);
  const shouldSwap =
    count[1] && count[2] ? meanX(1) > meanX(2) : count[1] ? meanX(1) > bodyMeanX : count[2] ? meanX(2) < bodyMeanX : false;
  if (shouldSwap) {
    for (let p = 0; p < labels.length; p += 1) labels[p] = labels[p] === 1 ? 2 : labels[p] === 2 ? 1 : 0;
  }
  return labels;
}

type ArmPolyline = {
  label: 1 | 2; // 1 = arm on the image-left, 2 = image-right
  segments: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; r: number }>;
};

// Each arm's shoulder -> elbow -> wrist -> hand line from the pose, as segments carrying the arm's
// half-thickness there (upper arm, forearm, hand). Stops at the first joint that isn't visible.
function armPolylines(lm: PoseLandmark[] | null | undefined, w: number, h: number): ArmPolyline[] {
  if (!lm?.[11] || !lm?.[12]) return [];
  const point = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const visible = (i: number) => Boolean(lm[i]) && (lm[i].visibility ?? 1) > 0.3;
  const shoulderDist = Math.hypot((lm[12].x - lm[11].x) * w, (lm[12].y - lm[11].y) * h);
  if (shoulderDist < 10) return [];

  // Pose joints per arm: shoulder, elbow, wrist, index finger. The photo isn't mirrored.
  const pose11IsImageLeft = lm[11].x <= lm[12].x;
  const arms: Array<{ label: 1 | 2; joints: number[] }> = [
    { label: 1, joints: pose11IsImageLeft ? [11, 13, 15, 19] : [12, 14, 16, 20] },
    { label: 2, joints: pose11IsImageLeft ? [12, 14, 16, 20] : [11, 13, 15, 19] },
  ];
  const radii = [0.14, 0.11, 0.1].map((r) => r * shoulderDist);

  const polylines: ArmPolyline[] = [];
  for (const arm of arms) {
    const points = [point(arm.joints[0])];
    for (const joint of arm.joints.slice(1)) {
      if (!visible(joint)) break;
      points.push(point(joint));
    }
    if (points.length < 2) continue;
    if (points.length === 3) {
      // No finger landmark: extend a hand's length past the wrist
      const [, elbow, wrist] = points;
      points.push({ x: wrist.x + (wrist.x - elbow.x) * 0.35, y: wrist.y + (wrist.y - elbow.y) * 0.35 });
    }
    polylines.push({
      label: arm.label,
      segments: points.slice(1).map((end, i) => ({ a: points[i], b: end, r: radii[Math.min(i, 2)] })),
    });
  }
  return polylines;
}

// Distance from (x, y) to an arm's line in units of the arm's half-thickness: <= 1 means on the arm.
// Nothing above the shoulder joint counts as arm, so arms don't spill over the shoulder line.
function armDistance(arm: ArmPolyline, x: number, y: number): number {
  let best = Infinity;
  arm.segments.forEach(({ a, b, r }, s) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1);
    if (s === 0 && t < 0) return;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) / r);
  });
  return best;
}

// Arms from the pose alone: silhouette pixels within an arm's half-thickness of its line.
// Returns 0 = not arm, 1 = arm on the image-left, 2 = arm on the image-right.
function labelArms(inside: Uint8Array, lm: PoseLandmark[] | null | undefined, w: number, h: number): Uint8Array {
  const labels = new Uint8Array(w * h);
  for (const arm of armPolylines(lm, w, h)) {
    const points = arm.segments.flatMap((segment) => [segment.a, segment.b]);
    const pad = Math.max(...arm.segments.map((segment) => segment.r));
    const minX = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x)) - pad));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(...points.map((p) => p.x)) + pad));
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)) - pad));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(...points.map((p) => p.y)) + pad));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const p = y * w + x;
        if (inside[p] && !labels[p] && armDistance(arm, x, y) <= 1) labels[p] = arm.label;
      }
    }
  }
  return labels;
}

// Arms start where the shoulders end: BodyPix's arm label often begins partway down the upper arm, so
// extend each arm up to the outer end of its shoulder line, filling the silhouette between the body's
// outer edge and the arm's inner edge.
function extendArmsToShoulders(
  labels: Uint8Array,
  inside: Uint8Array,
  shoulderLines: Array<Array<{ x: number; y: number }>>,
  w: number,
  h: number,
) {
  for (const label of [1, 2]) {
    // Topmost row of this arm (first hit in row-major order)
    let top = h;
    for (let p = 0; p < labels.length; p += 1) {
      if (labels[p] === label) {
        top = Math.floor(p / w);
        break;
      }
    }
    if (top >= h) continue;

    // The arm's left/right extent over its first few rows
    let armMinX = w;
    let armMaxX = -1;
    for (let y = top; y < Math.min(h, top + 6); y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (labels[y * w + x] !== label) continue;
        if (x < armMinX) armMinX = x;
        if (x > armMaxX) armMaxX = x;
      }
    }
    const armCenterX = (armMinX + armMaxX) / 2;

    // The shoulder line whose outer end (its last point) is nearest this arm
    let line: Array<{ x: number; y: number }> | null = null;
    let bestDistance = Infinity;
    for (const candidate of shoulderLines) {
      const end = candidate[candidate.length - 1];
      const distance = Math.hypot(end.x - armCenterX, end.y - top);
      if (distance < bestDistance) {
        bestDistance = distance;
        line = candidate;
      }
    }
    if (!line) continue;
    const shoulderEnd = line[line.length - 1];
    if (shoulderEnd.y >= top) continue; // the arm already reaches the shoulder
    const outerIsLeft = shoulderEnd.x < line[0].x;

    for (let y = Math.max(0, Math.round(shoulderEnd.y)); y < top; y += 1) {
      const row = y * w;
      if (outerIsLeft) {
        let x = 0;
        while (x < w && !inside[row + x]) x += 1;
        for (; x <= armMaxX; x += 1) if (inside[row + x] && !labels[row + x]) labels[row + x] = label;
      } else {
        let x = w - 1;
        while (x >= 0 && !inside[row + x]) x -= 1;
        for (; x >= armMinX; x -= 1) if (inside[row + x] && !labels[row + x]) labels[row + x] = label;
      }
    }
  }
}

// Torso: the body below the shoulder lines (and below the neck base between them), between the shoulder
// tips, down to the hips, excluding the arms. Inside that region it uses BodyPix's torso pixels when it
// found enough of them, otherwise the silhouette itself. Returns 1 = torso.
function labelTorso(
  inside: Uint8Array,
  armLabels: Uint8Array,
  shoulderLines: Array<Array<{ x: number; y: number }>>,
  lm: PoseLandmark[] | null | undefined,
  bodyPixParts: BodyPixPartSegmentation | null,
  w: number,
  h: number,
): Uint8Array {
  const labels = new Uint8Array(w * h);
  if (!lm?.[11] || !lm?.[12] || shoulderLines.length < 2) return labels;

  // Each shoulder line runs outward from the neck one pixel per step, so point 0 is its neck end
  const [leftLine, rightLine] = [...shoulderLines].sort((a, b) => a[0].x - b[0].x);
  const leftTipX = Math.max(0, Math.round(leftLine[leftLine.length - 1].x));
  const rightTipX = Math.min(w - 1, Math.round(rightLine[rightLine.length - 1].x));
  // Base of the neck. The shoulder lines start partway up the neck (where it begins to widen), so it's also
  // kept no higher than just above the shoulder joints; the torso, and the garment's collar, start there.
  const shoulderY = ((lm[11].y + lm[12].y) / 2) * h;
  const shoulderDist = Math.hypot((lm[12].x - lm[11].x) * w, (lm[12].y - lm[11].y) * h);
  const neckBaseY = Math.max(leftLine[0].y, rightLine[0].y, shoulderY - shoulderDist * 0.15);
  const lineYAt = (line: Array<{ x: number; y: number }>, x: number) => {
    const i = Math.abs(Math.round(x - line[0].x));
    return i < line.length ? line[i].y : neckBaseY;
  };
  const topAt = (x: number) =>
    x <= leftLine[0].x ? lineYAt(leftLine, x) : x >= rightLine[0].x ? lineYAt(rightLine, x) : neckBaseY;

  // Bottom: the hip line, or an estimate when the hips aren't visible
  const visible = (i: number) => Boolean(lm[i]) && (lm[i].visibility ?? 1) > 0.3;
  const hipY = visible(23) && visible(24) ? ((lm[23].y + lm[24].y) / 2) * h : shoulderY + shoulderDist * 1.3;

  // The torso's middle line (shoulders to hips) and the arms' lines, for deciding which one a pixel
  // belongs to where BodyPix left part of an arm unlabelled
  const shoulderMid = { x: ((lm[11].x + lm[12].x) / 2) * w, y: shoulderY };
  const hipMid = visible(23) && visible(24) ? { x: ((lm[23].x + lm[24].x) / 2) * w, y: hipY } : { x: shoulderMid.x, y: hipY };
  const torsoHalfWidth = shoulderDist * 0.42;
  const arms = armPolylines(lm, w, h);
  const torsoDistance = (x: number, y: number) => {
    const dx = hipMid.x - shoulderMid.x;
    const dy = hipMid.y - shoulderMid.y;
    const t = Math.max(0, Math.min(1, ((x - shoulderMid.x) * dx + (y - shoulderMid.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (shoulderMid.x + t * dx), y - (shoulderMid.y + t * dy)) / torsoHalfWidth;
  };

  const top = Math.max(0, Math.floor(Math.min(...leftLine.map((p) => p.y), ...rightLine.map((p) => p.y))));
  const bottom = Math.min(h - 1, Math.round(hipY));
  const region: number[] = [];
  let bodyPixTorsoCount = 0;
  const bodyPixIsTorso = (x: number, y: number) => {
    if (!bodyPixParts) return false;
    const px = Math.min(bodyPixParts.width - 1, Math.floor((x * bodyPixParts.width) / w));
    const py = Math.min(bodyPixParts.height - 1, Math.floor((y * bodyPixParts.height) / h));
    const id = bodyPixParts.data[py * bodyPixParts.width + px];
    return id === 12 || id === 13;
  };

  for (let y = top; y <= bottom; y += 1) {
    for (let x = leftTipX; x <= rightTipX; x += 1) {
      const p = y * w + x;
      if (!inside[p] || armLabels[p] || y <= topAt(x)) continue;

      // Relatively nearer an arm's line than the torso's middle: it's part of that arm (e.g. where
      // BodyPix labelled only the top of an arm), so mark it red instead of torso
      let nearestArm: ArmPolyline | null = null;
      let nearestArmDistance = Infinity;
      for (const arm of arms) {
        const distance = armDistance(arm, x, y);
        if (distance < nearestArmDistance) {
          nearestArmDistance = distance;
          nearestArm = arm;
        }
      }
      if (nearestArm && nearestArmDistance < torsoDistance(x, y)) {
        armLabels[p] = nearestArm.label;
        continue;
      }

      region.push(p);
      if (bodyPixIsTorso(x, y)) bodyPixTorsoCount += 1;
    }
  }

  const useBodyPix = bodyPixTorsoCount >= 200;
  for (const p of region) {
    if (!useBodyPix || bodyPixIsTorso(p % w, Math.floor(p / w))) labels[p] = 1;
  }
  return labels;
}

type BodyAnalysis = {
  width: number;
  height: number;
  inside: Uint8Array; // 1 = person, from MediaPipe's segmentation mask
  armLabels: Uint8Array; // 1 / 2 = arm on the image-left / right
  torsoLabels: Uint8Array; // 1 = torso
  shoulderLines: Array<Array<{ x: number; y: number }>>; // each from the neck outward to the shoulder tip
};

// Photo mode: finds the body in the photo from MediaPipe's segmentation mask (alpha = person) and the
// pose — silhouette, shoulder lines, arms (BodyPix's exact shapes when available) and torso. Used both
// to fit the garment and to draw the debug overlay.
function analyzeBody(
  mask: CanvasImageSource,
  lm: PoseLandmark[] | null | undefined,
  face: PoseLandmark[] | null | undefined,
  bodyPixParts: BodyPixPartSegmentation | null,
  w: number,
  h: number,
): BodyAnalysis | null {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return null;
  maskCtx.drawImage(mask, 0, 0, w, h);
  const m = maskCtx.getImageData(0, 0, w, h).data;

  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i += 1) inside[i] = m[i * 4 + 3] > 128 ? 1 : 0;

  // Exact arm shapes from BodyPix once it has run; the pose-based estimate until then, if BodyPix
  // failed, or if it found (almost) no arm pixels inside the silhouette
  const MIN_BODYPIX_ARM_PIXELS = 200;
  let armLabels = bodyPixParts ? bodyPixArmLabels(bodyPixParts, inside, w, h) : null;
  if (armLabels && armLabels.reduce((count, label) => count + (label ? 1 : 0), 0) < MIN_BODYPIX_ARM_PIXELS) {
    armLabels = null;
  }
  if (!armLabels) armLabels = labelArms(inside, lm, w, h);
  const shoulderLines = traceShoulderLines(inside, lm, face, w, h);
  extendArmsToShoulders(armLabels, inside, shoulderLines, w, h);
  const torsoLabels = labelTorso(inside, armLabels, shoulderLines, lm, bodyPixParts, w, h);

  const arms = armLabels;

  // The torso, row by row: from the base of the neck to the hips, the run of body pixels (not arm) through
  // the middle of the torso, out to the arms on each side. (BodyPix's torso is narrower than that.) Its top
  // follows the slope of the shoulders from the neckline out to the arms.
  const torsoRows = rowExtents(w, h, (p) => torsoLabels[p] === 1);
  const torsoSpan = rowSpan(torsoRows);
  const torsoFillRows: RowExtents = { minX: new Int32Array(h).fill(w), maxX: new Int32Array(h).fill(-1) };
  if (torsoSpan) {
    const isBody = (p: number) => inside[p] === 1 && !arms[p];
    let center = -1;
    for (let y = torsoSpan.top; y <= torsoSpan.bottom; y += 1) {
      if (torsoRows.maxX[y] >= torsoRows.minX[y]) center = Math.round((torsoRows.minX[y] + torsoRows.maxX[y]) / 2);
      if (center < 0 || !isBody(y * w + center)) continue;
      let left = center;
      while (left > 0 && isBody(y * w + left - 1)) left -= 1;
      let right = center;
      while (right < w - 1 && isBody(y * w + right + 1)) right += 1;
      torsoFillRows.minX[y] = left;
      torsoFillRows.maxX[y] = right;
    }
  }
  // The same area as labels, for the debug overlay
  const torsoFillLabels = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = torsoFillRows.minX[y]; x <= torsoFillRows.maxX[y]; x += 1) torsoFillLabels[y * w + x] = 1;
  }

  return {
    width: w,
    height: h,
    inside,
    armLabels,
    torsoLabels: torsoFillLabels,
    shoulderLines,
  };
}

// Debug overlay of the body analysis: the silhouette as a 2px green outline with a light fill, plus a
// yellow line along each shoulder, the arms in red and the torso in sky blue
function buildSilhouetteOverlay(body: BodyAnalysis, w: number, h: number): HTMLCanvasElement {
  const { inside, armLabels, torsoLabels, shoulderLines } = body;
  const overlay = document.createElement("canvas");
  overlay.width = w;
  overlay.height = h;
  const outside = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || !inside[y * w + x];
  const image = new ImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!inside[p]) continue;
      const o = p * 4;

      const arm = armLabels[p];
      if (arm) {
        // Red outline around each arm, light red inside
        const notThisArm = (xx: number, yy: number) =>
          xx < 0 || yy < 0 || xx >= w || yy >= h || armLabels[yy * w + xx] !== arm;
        const isArmEdge =
          notThisArm(x - 1, y) || notThisArm(x + 1, y) || notThisArm(x, y - 1) || notThisArm(x, y + 1) ||
          notThisArm(x - 2, y) || notThisArm(x + 2, y) || notThisArm(x, y - 2) || notThisArm(x, y + 2);
        image.data[o] = 255;
        image.data[o + 3] = isArmEdge ? 255 : 60;
        continue;
      }

      if (torsoLabels[p]) {
        // Sky-blue outline around the torso, light blue inside
        const notTorso = (xx: number, yy: number) =>
          xx < 0 || yy < 0 || xx >= w || yy >= h || !torsoLabels[yy * w + xx];
        const isTorsoEdge =
          notTorso(x - 1, y) || notTorso(x + 1, y) || notTorso(x, y - 1) || notTorso(x, y + 1) ||
          notTorso(x - 2, y) || notTorso(x + 2, y) || notTorso(x, y - 2) || notTorso(x, y + 2);
        image.data[o + 1] = 191;
        image.data[o + 2] = 255;
        image.data[o + 3] = isTorsoEdge ? 255 : 60;
        continue;
      }

      const isEdge =
        outside(x - 1, y) || outside(x + 1, y) || outside(x, y - 1) || outside(x, y + 1) ||
        outside(x - 2, y) || outside(x + 2, y) || outside(x, y - 2) || outside(x, y + 2);
      image.data[o + 1] = 255;
      image.data[o + 3] = isEdge ? 255 : 50;
    }
  }
  const ctx = overlay.getContext("2d");
  if (ctx) {
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = "#ffff00";
    ctx.lineWidth = Math.max(4, Math.round(w * 0.012));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const line of shoulderLines) {
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      line.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
    }
  }
  return overlay;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

declare global {
  interface Window {
    Camera: any;
    Holistic: any;
    SelfieSegmentation: any;
    // Loaded globally from the CDN scripts in app/layout.tsx
    bodyPix: { load: (config: Record<string, unknown>) => Promise<BodyPixNet> };
    tf: { getBackend: () => string; setBackend: (name: string) => Promise<boolean>; ready: () => Promise<void> };
  }
}

export default function NecklaceTryOn({ selectedImageSrc, mode = "garment", inputSource = "webcam", partMaskSrc = null, onClose }: NecklaceTryOnProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  // In photo mode the uploaded photo, letterboxed to targetWidth x targetHeight, stands in for the webcam feed
  const [photoCanvas, setPhotoCanvas] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // References to hold the tracking metrics and image states across loops
  const latestSegmentationRef = useRef<any>(null);
  const latestPoseLandmarksRef = useRef<any>(null);
  const latestFaceLandmarksRef = useRef<any>(null);
  const garmentImageRef = useRef<HTMLImageElement | null>(null);
  const overlayBoundsRef = useRef<OverlayBounds | null>(null);
  const necklaceAnchorsRef = useRef<NecklaceAnchorPoints | null>(null);
  const earringAssetsRef = useRef<EarringAssetSet | null>(null);
  const garmentPiecesRef = useRef<GarmentPieces | null>(null);
  // Debug checkbox; mirrored into a ref so the render loop sees changes without restarting
  const [showBodyOutlines, setShowBodyOutlines] = useState(false);
  const showBodyOutlinesRef = useRef(false);
  // Exact arm shapes from BodyPix for the uploaded photo (the pose-based estimate shows until then)
  const bodyPixPartsRef = useRef<{ source: HTMLCanvasElement; parts: BodyPixPartSegmentation } | null>(null);
  const [armDetectionStatus, setArmDetectionStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  // Engines stored as refs so they can be explicitly destroyed on close
  const activeCameraRef = useRef<any>(null);
  const selfieSegmentationRef = useRef<any>(null);
  const holisticRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef(0);
  const frameProcessingRef = useRef(false);

  // Manual Adjustments placeholders
  const manualOffsetXRef = useRef<number>(0);
  const manualOffsetYRef = useRef<number>(0);
  const manualScaleRef = useRef<number>(1.0);

  // Track script load and full-screen minimized states
  const [scriptsLoaded, setScriptsLoaded] = useState(() => ({
    camera: typeof window !== "undefined" && Boolean(window.Camera),
    selfie: typeof window !== "undefined" && Boolean(window.SelfieSegmentation),
    holistic: typeof window !== "undefined" && Boolean(window.Holistic),
  }));
  const [isMinimized, setIsMinimized] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [scaleVersion, setScaleVersion] = useState(0);
  const [showMobileControlsMenu, setShowMobileControlsMenu] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );

  const targetWidth = 640;
  const targetHeight = 480;
  const BODY_MASK_THRESHOLD = 50;
  const NECKLACE_STARTUP_SCALE = 0.8;
  const NECKLACE_STARTUP_Y_OFFSET = -targetHeight * 0.02;
  const EARRING_STARTUP_SCALE = 0.72;
  const isLoaded = scriptsLoaded.camera && scriptsLoaded.selfie && scriptsLoaded.holistic;
  const isMobile = viewportWidth <= 768;

  useEffect(() => {
    if (mode === "necklace") {
      manualScaleRef.current = NECKLACE_STARTUP_SCALE;
      manualOffsetYRef.current = NECKLACE_STARTUP_Y_OFFSET;
    } else if (mode === "earrings") {
      manualScaleRef.current = EARRING_STARTUP_SCALE;
      manualOffsetYRef.current = 0;
    } else {
      manualScaleRef.current = 1;
      manualOffsetYRef.current = 0;
    }
    manualOffsetXRef.current = 0;
    setScaleVersion((prev) => prev + 1);
  }, [mode, EARRING_STARTUP_SCALE, NECKLACE_STARTUP_SCALE, NECKLACE_STARTUP_Y_OFFSET]);

  useEffect(() => {
    earringAssetsRef.current = null;
    if (mode !== "earrings" || !selectedImageSrc) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const full = document.createElement("canvas");
      full.width = img.width;
      full.height = img.height;
      const fullCtx = full.getContext("2d");
      if (!fullCtx) return;
      fullCtx.drawImage(img, 0, 0);

      const splitX = Math.max(1, Math.round(full.width / 2));
      const left = document.createElement("canvas");
      left.width = splitX;
      left.height = full.height;
      left.getContext("2d")?.drawImage(full, 0, 0, splitX, full.height, 0, 0, splitX, full.height);

      const rightWidth = Math.max(1, full.width - splitX);
      const right = document.createElement("canvas");
      right.width = rightWidth;
      right.height = full.height;
      right.getContext("2d")?.drawImage(full, splitX, 0, rightWidth, full.height, 0, 0, rightWidth, full.height);

      const mirroredLeft = document.createElement("canvas");
      mirroredLeft.width = left.width;
      mirroredLeft.height = left.height;
      const mirroredCtx = mirroredLeft.getContext("2d");
      if (mirroredCtx) {
        mirroredCtx.translate(mirroredLeft.width, 0);
        mirroredCtx.scale(-1, 1);
        mirroredCtx.drawImage(left, 0, 0);
      }

      const minOpaquePixels = Math.max(40, Math.round((full.width * full.height) * 0.0025));
      const hasDistinctRightEarring = rightWidth > 4 && hasVisiblePixels(right, minOpaquePixels);

      earringAssetsRef.current = {
        left,
        right: hasDistinctRightEarring ? right : mirroredLeft,
      };
    };
    img.src = selectedImageSrc;
  }, [mode, selectedImageSrc]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const metrics: MetricData = {
    shoulderCenterNorm: 0.5,
    shoulderYNorm: 0.25,
    leftShoulderNorm: { x: 0.35, y: 0.25 },
    rightShoulderNorm: { x: 0.65, y: 0.25 },
    backNeckNorm: { x: 0.5, y: 0.23 },
  };

  // Run BodyPix once per photo while the debug overlay is on, for the arms' exact outline
  useEffect(() => {
    if (inputSource !== "photo" || !photoCanvas || !showBodyOutlines) return;
    if (bodyPixPartsRef.current?.source === photoCanvas) return;

    let cancelled = false;
    setArmDetectionStatus("loading");
    segmentWithBodyPix(photoCanvas)
      .then((parts) => {
        if (cancelled) return;
        let armPixels = 0;
        for (let i = 0; i < parts.data.length; i += 1) {
          if (parts.data[i] >= 2 && parts.data[i] <= 11) armPixels += 1;
        }
        console.info(
          `[BodyPix] ${parts.width}x${parts.height} part map on the ${window.tf?.getBackend()} backend, ${armPixels} arm pixels`,
        );
        bodyPixPartsRef.current = { source: photoCanvas, parts };
        setArmDetectionStatus("ready");
      })
      .catch((err) => {
        console.warn("[BodyPix] arm detection failed; keeping the pose-based arms", err);
        if (!cancelled) setArmDetectionStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [inputSource, photoCanvas, showBodyOutlines]);

  // Split the garment into torso and sleeve pieces using the painter's part mask
  useEffect(() => {
    garmentPiecesRef.current = null;
    if (!selectedImageSrc) return;

    let cancelled = false;
    Promise.all([loadImage(selectedImageSrc), partMaskSrc ? loadImage(partMaskSrc) : Promise.resolve(null)])
      .then(([garment, mask]) => {
        if (cancelled) return;
        // Without a usable part mask (none saved, or no body marked) the whole garment is fitted as one piece
        const splitPieces = mask ? buildGarmentPieces(garment, mask) : null;
        const pieces = splitPieces ?? buildWholeGarmentPieces(garment);
        if (splitPieces) {
          const { left: shoulderL, right: shoulderR } = splitPieces.shoulders;
          console.info(
            `[Try-on] garment shoulder points from the part marks: (${Math.round(shoulderL.x)}, ${Math.round(shoulderL.y)}) ` +
              `and (${Math.round(shoulderR.x)}, ${Math.round(shoulderR.y)}) in a ${garment.naturalWidth}x${garment.naturalHeight} image`,
          );
        } else if (mask) {
          console.warn(
            `[Try-on] a part outline arrived (${mask.naturalWidth}x${mask.naturalHeight}) but it has no usable Body ` +
              `area over the ${garment.naturalWidth}x${garment.naturalHeight} garment — using the garment as one piece`,
          );
        } else {
          console.warn("[Try-on] no part outline was passed to the try-on — using the garment as one piece");
        }
        garmentPiecesRef.current = pieces;
      })
      .catch((err) => console.warn("Could not split garment into parts; using whole garment.", err));

    return () => {
      cancelled = true;
    };
  }, [selectedImageSrc, partMaskSrc]);

  // Automated Background Pre-Cropper Watcher
  useEffect(() => {
    if (!selectedImageSrc) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function() {
      const localCropC = document.createElement("canvas");
      localCropC.width = img.width;
      localCropC.height = img.height;
      const localCropCtx = localCropC.getContext("2d");

      if (localCropCtx) {
        const isNecklaceMode = mode === "necklace";
        const topCutoffY = img.height * (isNecklaceMode ? 0.04 : 0.2);
        const sourceHeightToKeep = img.height - topCutoffY;
        const sideCutoffX = img.width * (isNecklaceMode ? 0.03 : 0.1);
        const sourceWidthToKeep = img.width - sideCutoffX * 2;

        localCropCtx.drawImage(
          img,
          sideCutoffX, topCutoffY, sourceWidthToKeep, sourceHeightToKeep,
          0, 0, img.width, img.height
        );

        const processedImg = new Image();
        processedImg.onload = () => {
          garmentImageRef.current = processedImg;

          const boundsCtx = localCropC.getContext("2d", { willReadFrequently: true });
          if (!boundsCtx) {
            overlayBoundsRef.current = null;
            return;
          }

          const imageData = boundsCtx.getImageData(0, 0, localCropC.width, localCropC.height).data;
          let minX = localCropC.width;
          let maxX = 0;
          let minY = localCropC.height;
          let maxY = 0;

          for (let y = 0; y < localCropC.height; y += 1) {
            for (let x = 0; x < localCropC.width; x += 1) {
              const alpha = imageData[(y * localCropC.width + x) * 4 + 3];
              if (alpha < 16) continue;
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
          }

          if (minX <= maxX && minY <= maxY) {
            const bounds = {
              minX,
              maxX,
              minY,
              maxY,
              width: Math.max(1, maxX - minX),
              height: Math.max(1, maxY - minY),
            };
            overlayBoundsRef.current = bounds;

            const scanTop = bounds.minY;
            const scanBottom = Math.min(localCropC.height - 1, bounds.minY + Math.max(8, Math.floor(bounds.height * 0.35)));
            let bestRow = -1;
            let widestSpan = 0;
            let bestLeft = bounds.minX;
            let bestRight = bounds.maxX;

            for (let y = scanTop; y <= scanBottom; y += 1) {
              let rowLeft = -1;
              let rowRight = -1;

              for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
                const alpha = imageData[(y * localCropC.width + x) * 4 + 3];
                if (alpha < 16) continue;
                if (rowLeft === -1) rowLeft = x;
                rowRight = x;
              }

              if (rowLeft === -1 || rowRight === -1) continue;

              const span = rowRight - rowLeft;
              if (span > widestSpan) {
                widestSpan = span;
                bestRow = y;
                bestLeft = rowLeft;
                bestRight = rowRight;
              }
            }

            necklaceAnchorsRef.current = bestRow === -1
              ? getNecklaceFallbackAnchors(bounds)
              : {
                  leftNeckX: bestLeft,
                  rightNeckX: bestRight,
                  neckY: bestRow,
                  centerX: (bestLeft + bestRight) / 2,
                };
          } else {
            overlayBoundsRef.current = null;
            necklaceAnchorsRef.current = null;
          }
        };
        processedImg.src = localCropC.toDataURL();
      }
    };
    img.src = selectedImageSrc;
  }, [mode, selectedImageSrc]);

  useEffect(() => {
    if (isClosed || isMinimized) return;
    if (!scriptsLoaded.selfie || !scriptsLoaded.holistic) return;
    if (!videoRef.current || !canvasRef.current || !window.SelfieSegmentation || !window.Holistic) return;
    const isPhoto = inputSource === "photo";
    if (isPhoto && !photoCanvas) return;

    sessionIdRef.current += 1;
    const sessionId = sessionIdRef.current;
    let requestFrameId: number;
    let cancelled = false;

    const video = videoRef.current;
    const source: HTMLVideoElement | HTMLCanvasElement = isPhoto && photoCanvas ? photoCanvas : video;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext("2d", { willReadFrequently: true });
    if (!canvasCtx) return;

    const camMaskCanvas = document.createElement("canvas");
    camMaskCanvas.width = targetWidth;
    camMaskCanvas.height = targetHeight;
    const camMaskCtx = camMaskCanvas.getContext("2d");

    // Garment pieces are composed here first: the mask canvas uses "source-in",
    // so drawing each piece straight onto it would erase the previous one.
    const piecesCanvas = document.createElement("canvas");
    piecesCanvas.width = targetWidth;
    piecesCanvas.height = targetHeight;
    const piecesCtx = piecesCanvas.getContext("2d");

    // Photo mode: body analysis (silhouette, shoulder lines, arms, torso), rebuilt when MediaPipe's mask
    // changes (at most every 250ms); the debug overlay is drawn from it on demand
    let lastFitPath = ""; // logged when it changes, to show which garment placement is in use
    let bodyCache: {
      mask: unknown;
      builtAt: number;
      analysis: BodyAnalysis | null;
      overlay: HTMLCanvasElement | null;
    } | null = null;

    // Initialize your segmentation engine locally out of the public folder mapping
    selfieSegmentationRef.current = new window.SelfieSegmentation({
      locateFile: (file: string) => window.location.origin + `/static-libs/${file}`,
    });
    selfieSegmentationRef.current.setOptions({ modelSelection: 1 });
    selfieSegmentationRef.current.onResults((results: any) => {
      latestSegmentationRef.current = results.segmentationMask;
    });

    // Initialize your Holistic pipeline safely out of the local static folder mapping
    holisticRef.current = new window.Holistic({
      locateFile: (file: string) => window.location.origin + `/static-libs/${file}`,
    });
    holisticRef.current.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    holisticRef.current.onResults((results: any) => {
      latestPoseLandmarksRef.current = results.poseLandmarks;
      latestFaceLandmarksRef.current = results.faceLandmarks;
    });

    function renderLoop() {
      // FIXED: Added an implicit guard check to instantly kill the animation loop if the session closes
      if (isClosed || isMinimized || !videoRef.current) return;

      if ((isPhoto || video.readyState === video.HAVE_ENOUGH_DATA) && canvasCtx && camMaskCtx) {
        canvasCtx.clearRect(0, 0, targetWidth, targetHeight);
        canvasCtx.drawImage(source, 0, 0, targetWidth, targetHeight);

        const currentCamMask = latestSegmentationRef.current;
        const lm = latestPoseLandmarksRef.current;
        const faceLandmarks = latestFaceLandmarksRef.current;

        let bodyAnalysis: BodyAnalysis | null = null;
        if (isPhoto && currentCamMask) {
          const now = performance.now();
          if (!bodyCache || bodyCache.mask !== currentCamMask || now - bodyCache.builtAt > 250) {
            bodyCache = {
              mask: currentCamMask,
              builtAt: now,
              analysis: analyzeBody(
                currentCamMask,
                lm,
                faceLandmarks,
                bodyPixPartsRef.current?.source === source ? bodyPixPartsRef.current.parts : null,
                targetWidth,
                targetHeight,
              ),
              overlay: null,
            };
          }
          bodyAnalysis = bodyCache.analysis;
        }

        if (currentCamMask && lm) {
          const w = targetWidth;
          const h = targetHeight;

          const croppedImageElement = garmentImageRef.current;
          // Set when photo mode drew the garment straight on top, skipping the webcam's masked layering below
          let garmentDrawnOnTop = false;

          if (croppedImageElement) {
            const xCoords = [lm[11].x, lm[12].x, lm[13].x, lm[14].x, lm[23].x, lm[24].x].map((x) => x * w);
            const yCoords = [lm[11].y, lm[12].y, lm[13].y, lm[14].y, lm[23].y, lm[24].y].map((y) => y * h);

            const minX = Math.min(...xCoords);
            const maxX = Math.max(...xCoords);
            const minY = Math.min(...yCoords);
            const maxY = Math.max(...yCoords);

            const torsoWidth = maxX - minX;
            const torsoHeight = maxY - minY;

            if (mode === "earrings") {
              const faceLm = latestFaceLandmarksRef.current;
              const earringAssets = earringAssetsRef.current;

              if (faceLm) {
                const leftTemple = faceLm[FACE_LANDMARKS.leftTemple];
                const rightTemple = faceLm[FACE_LANDMARKS.rightTemple];
                const leftEye = faceLm[FACE_LANDMARKS.leftEyeOuter];
                const rightEye = faceLm[FACE_LANDMARKS.rightEyeOuter];
                const leftMouth = faceLm[FACE_LANDMARKS.mouthLeft];
                const rightMouth = faceLm[FACE_LANDMARKS.mouthRight];

                if (leftTemple && rightTemple && leftEye && rightEye && leftMouth && rightMouth) {
                  const leftTempleX = leftTemple.x * w;
                  const rightTempleX = rightTemple.x * w;
                  const leftTempleY = leftTemple.y * h;
                  const rightTempleY = rightTemple.y * h;
                  const faceWidth = Math.max(1, Math.hypot(rightTempleX - leftTempleX, rightTempleY - leftTempleY));
                  const leftEarY = (leftEye.y * h) + ((leftMouth.y - leftEye.y) * h * 0.62) - faceWidth * 0.035 + manualOffsetYRef.current;
                  const rightEarY = (rightEye.y * h) + ((rightMouth.y - rightEye.y) * h * 0.62) - faceWidth * 0.035 + manualOffsetYRef.current;
                    const leftEarX = leftTempleX - faceWidth * 0.05 + manualOffsetXRef.current;
                    const rightEarX = rightTempleX + faceWidth * 0.06 + manualOffsetXRef.current;
                  const earringWidth = faceWidth * 0.22 * manualScaleRef.current;
                  const tilt = Math.atan2((rightEye.y - leftEye.y) * h, (rightEye.x - leftEye.x) * w);

                  const drawSingleEarring = (assetCanvas: HTMLCanvasElement, x: number, y: number) => {
                    const drawW = earringWidth;
                    const drawH = drawW * (assetCanvas.height / Math.max(1, assetCanvas.width));
                    canvasCtx.save();
                    canvasCtx.translate(x, y);
                    canvasCtx.rotate(tilt);
                    canvasCtx.shadowColor = "rgba(0,0,0,0.4)";
                    canvasCtx.shadowBlur = drawW * 0.15;
                    canvasCtx.shadowOffsetY = drawW * 0.06;
                    canvasCtx.drawImage(assetCanvas, -drawW / 2, -drawH * 0.08, drawW, drawH);
                    canvasCtx.restore();
                  };

                  if (earringAssets) {
                    drawSingleEarring(earringAssets.left, leftEarX, leftEarY);
                    drawSingleEarring(earringAssets.right, rightEarX, rightEarY);
                  }
                }
              }
            } else if (mode === "necklace" && necklaceAnchorsRef.current) {
              const chin = faceLandmarks?.[152];
              const placement = getNecklacePlacement(lm, w, h, chin);

              if (placement) {
                const { chainStartX, chainStartY, chainEndX, chainEndY, controlX } = placement;
                const liveNeckWidth = Math.max(1, Math.abs(chainEndX - chainStartX));
                const sourceAnchors = necklaceAnchorsRef.current;
                const sourceNeckWidth = Math.max(1, sourceAnchors.rightNeckX - sourceAnchors.leftNeckX);
                const androidScaleBoost = /Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "") ? 1.12 : 1;
                const scale = (liveNeckWidth / sourceNeckWidth) * manualScaleRef.current * androidScaleBoost;
                const drawW = croppedImageElement.width * scale;
                const drawH = croppedImageElement.height * scale;
                const drawX = controlX - sourceAnchors.centerX * scale + manualOffsetXRef.current;
                const shoulderLineY = Math.min(chainStartY, chainEndY);
                const drawY = shoulderLineY - sourceAnchors.neckY * scale + manualOffsetYRef.current - h * 0.015;

                canvasCtx.drawImage(croppedImageElement, drawX, drawY, drawW, drawH);
              }
            } else if (isPhoto && garmentPiecesRef.current && piecesCtx) {
              // Photo mode: the whole garment drawn straight on top of the photo in one piece — not trimmed
              // to the model's outline and without the webcam's face/hand cut-outs, so its full shape
              // (sleeves included) stays visible. Its shoulders go on the model's shoulders.
              const garmentPieces = garmentPiecesRef.current;
              piecesCtx.clearRect(0, 0, w, h);
              const modelShoulders = modelShoulderPoints(bodyAnalysis, lm, w, h);
              const placed =
                modelShoulders !== null &&
                drawGarmentWhole(
                  piecesCtx,
                  garmentPieces,
                  modelShoulders.left,
                  modelShoulders.right,
                  manualScaleRef.current,
                  manualOffsetXRef.current,
                  manualOffsetYRef.current,
                );
              const fitPath = placed
                ? `whole garment on top, shoulders aligned to the model's ${modelShoulders?.source}`
                : "pose-only fallback (no shoulder points)";
              if (fitPath !== lastFitPath) {
                console.info(`[Try-on] garment placement: ${fitPath}`);
                lastFitPath = fitPath;
              }
              if (!placed) {
                drawGarmentPieces(
                  piecesCtx,
                  garmentPieces,
                  lm,
                  w,
                  h,
                  manualScaleRef.current,
                  manualOffsetXRef.current,
                  manualOffsetYRef.current,
                );
              }
              canvasCtx.drawImage(piecesCanvas, 0, 0);
              garmentDrawnOnTop = true;
            } else {
              camMaskCtx.clearRect(0, 0, w, h);
              camMaskCtx.save();
              camMaskCtx.drawImage(currentCamMask, 0, 0, w, h);
              camMaskCtx.globalCompositeOperation = "source-in";

              let customTopAnchor = minY;
              if (faceLandmarks && faceLandmarks[152]) {
                const chinY = faceLandmarks[152].y * h;
                customTopAnchor = chinY + torsoHeight * 0.05;
              } else {
                customTopAnchor = minY - torsoHeight * 0.22;
              }

              const drawX = minX - torsoWidth * 0.25 + manualOffsetXRef.current;
              const drawY = customTopAnchor - h * 0.05 + manualOffsetYRef.current - (h * 0.05);
              const drawW = torsoWidth * 1.5 * manualScaleRef.current;
              const drawH = (maxY - customTopAnchor + torsoHeight * 0.4);

              camMaskCtx.drawImage(croppedImageElement, drawX, drawY, drawW, drawH);
              camMaskCtx.restore();
            }
          } else {
            camMaskCtx.fillStyle = "rgba(0, 50, 255, 0.4)";
            camMaskCtx.fillRect(0, 0, w, h);
          }

          if (mode !== "necklace" && !garmentDrawnOnTop) {
            camMaskCtx.save();
            camMaskCtx.globalCompositeOperation = "destination-out";
            if (faceLandmarks) {
              const nose = faceLandmarks[1];
              const forehead = faceLandmarks[10];
              const chin = faceLandmarks[152];

              if (nose && forehead && chin) {
                const headCenterX = nose.x * w;
                const headCenterY = nose.y * h;
                const headRadius = Math.abs(chin.y - forehead.y) * h * 0.65;

                camMaskCtx.beginPath();
                camMaskCtx.arc(headCenterX, headCenterY, headRadius, 0, 2 * Math.PI);
                camMaskCtx.fillStyle = "black";
                camMaskCtx.fill();
              }
            }
            camMaskCtx.restore();

            camMaskCtx.save();
            camMaskCtx.globalCompositeOperation = "source-over";
            const pattern = camMaskCtx.createPattern(source, "no-repeat");
            if (pattern) {
              camMaskCtx.strokeStyle = pattern;
              camMaskCtx.lineWidth = 45;

              if (lm[15]) {
                camMaskCtx.beginPath();
                camMaskCtx.arc(lm[15].x * w, lm[15].y * h, 25, 0, 2 * Math.PI);
                camMaskCtx.fillStyle = pattern;
                camMaskCtx.fill();
              }
              if (lm[16]) {
                camMaskCtx.beginPath();
                camMaskCtx.arc(lm[16].x * w, lm[16].y * h, 25, 0, 2 * Math.PI);
                camMaskCtx.fillStyle = pattern;
                camMaskCtx.fill();
              }
            }
            camMaskCtx.restore();

            canvasCtx.drawImage(camMaskCanvas, 0, 0, w, h);
          }
        }

        // Debug: the body analysis drawn over the photo (outside the pose check, so the silhouette
        // shows even if no pose was found)
        if (isPhoto && showBodyOutlinesRef.current && bodyCache?.analysis) {
          if (!bodyCache.overlay) {
            bodyCache.overlay = buildSilhouetteOverlay(bodyCache.analysis, targetWidth, targetHeight);
          }
          canvasCtx.drawImage(bodyCache.overlay, 0, 0, targetWidth, targetHeight);
        }
      }
      requestFrameId = requestAnimationFrame(renderLoop);
    }

    const processFrame = async () => {
        if (sessionIdRef.current !== sessionId || frameProcessingRef.current) {
          return;
        }

        frameProcessingRef.current = true;

        try {
          if (sessionIdRef.current !== sessionId) {
            return;
          }

          if (selfieSegmentationRef.current) {
            await selfieSegmentationRef.current.send({ image: source });
          }

          if (sessionIdRef.current !== sessionId) {
            return;
          }

          if (holisticRef.current) {
            await holisticRef.current.send({ image: source });
          }
        } catch {
          if (sessionIdRef.current === sessionId) {
            setIsClosed(true);
            onClose?.();
          }
        } finally {
          frameProcessingRef.current = false;
        }
      };

    // A still photo only needs a few passes for the pose/segmentation to settle; re-analysing it every
    // frame just keeps the CPU/GPU busy for nothing
    const PHOTO_FRAMES_TO_PROCESS = 15;
    let photoFramesProcessed = 0;

    const tick = async () => {
      if (cancelled || sessionIdRef.current !== sessionId) {
        return;
      }

      await processFrame();

      if (isPhoto) {
        photoFramesProcessed += 1;
        if (photoFramesProcessed >= PHOTO_FRAMES_TO_PROCESS) return;
      }

      if (!cancelled && sessionIdRef.current === sessionId) {
        requestFrameId = requestAnimationFrame(() => {
          void tick();
        });
      }
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: targetWidth },
            height: { ideal: targetHeight },
            facingMode: "user",
          },
          audio: false,
        });

        if (cancelled || sessionIdRef.current !== sessionId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();

        if (cancelled || sessionIdRef.current !== sessionId) {
          return;
        }

        activeCameraRef.current = {
          stop: () => {
            stream.getTracks().forEach((track) => track.stop());
          },
        };

        renderLoop();
        void tick();
      } catch {
        if (!cancelled && sessionIdRef.current === sessionId) {
          setIsClosed(true);
          onClose?.();
        }
      }
    };

    if (isPhoto) {
      renderLoop();
      void tick();
    } else {
      void startCamera();
    }

    // CLEANUP LIFECYCLE: This forces everything running in memory to stop completely on close
    return () => {
      cancelled = true;
      sessionIdRef.current += 1;
      cancelAnimationFrame(requestFrameId);
      
      if (activeCameraRef.current) {
        try { activeCameraRef.current.stop(); } catch {}
        activeCameraRef.current = null;
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
          track.enabled = false;
        });
        streamRef.current = null;
      }

      if (video) {
        video.srcObject = null;
        video.load();
      }

      if (selfieSegmentationRef.current) {
        try { selfieSegmentationRef.current.close(); } catch {}
        selfieSegmentationRef.current = null;
      }

      if (holisticRef.current) {
        try { holisticRef.current.close(); } catch {}
        holisticRef.current = null;
      }

      latestSegmentationRef.current = null;
      latestPoseLandmarksRef.current = null;
      latestFaceLandmarksRef.current = null;
      frameProcessingRef.current = false;
    };
  }, [scriptsLoaded, isMinimized, isClosed, mode, onClose, inputSource, photoCanvas]);

  const handlePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const letterboxed = document.createElement("canvas");
      letterboxed.width = targetWidth;
      letterboxed.height = targetHeight;
      const ctx = letterboxed.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#222";
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        const fit = Math.min(targetWidth / img.width, targetHeight / img.height);
        const drawW = img.width * fit;
        const drawH = img.height * fit;
        ctx.drawImage(img, (targetWidth - drawW) / 2, (targetHeight - drawH) / 2, drawW, drawH);
      }
      URL.revokeObjectURL(url);
      setPhotoCanvas(letterboxed);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const handleCloseFittingRoom = () => {
    setIsMinimized(false);
    setIsClosed(true);
    onClose?.();
  };

  const adjustScale = (delta: number) => {
    const nextScale = Math.min(2.5, Math.max(0.4, manualScaleRef.current + delta));
    manualScaleRef.current = Number(nextScale.toFixed(2));
    setScaleVersion((prev) => prev + 1);
  };

  const adjustVerticalOffset = (delta: number) => {
    manualOffsetYRef.current += delta;
    setScaleVersion((prev) => prev + 1);
  };

  const adjustHorizontalOffset = (delta: number) => {
    manualOffsetXRef.current += delta;
    setScaleVersion((prev) => prev + 1);
  };

  const mobileControlButtonStyle: React.CSSProperties = {
    background: "#1f2937",
    color: "#fff",
    border: "1px solid #4b5563",
    borderRadius: "6px",
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "bold",
  };

  const mobileControlActionButtonStyle: React.CSSProperties = {
    background: "#222",
    color: "#fff",
    border: "1px solid #444",
    borderRadius: "6px",
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "bold",
  };

  const mobileControlDangerButtonStyle: React.CSSProperties = {
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "bold",
  };

  if (isClosed) return null;

  return (
    <>
      <Script
        src="/static-libs/camera_utils.js"
        strategy="afterInteractive"
        onLoad={() => setScriptsLoaded((prev) => ({ ...prev, camera: true }))}
      />
      <Script
        src="/static-libs/selfie_segmentation.js"
        strategy="afterInteractive"
        onLoad={() => setScriptsLoaded((prev) => ({ ...prev, selfie: true }))}
      />
      <Script
        src="/static-libs/holistic.js"
        strategy="afterInteractive"
        onLoad={() => setScriptsLoaded((prev) => ({ ...prev, holistic: true }))}
      />

      {/* MINIMIZED FLOAT WINDOW OVERLAY BUTTON */}
      {isMinimized && (
        <button
          onClick={() => setIsMinimized(false)}
          style={{
            position: "fixed",
            bottom: isMobile ? "14px" : "20px",
            right: isMobile ? "14px" : "20px",
            background: "#3b82f6",
            color: "#fff",
            padding: isMobile ? "10px 16px" : "12px 24px",
            borderRadius: "50px",
            border: "none",
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: isMobile ? "13px" : "14px",
            zIndex: 99999
          }}
        >
          {"🔲 Restore Fitting Room"}
        </button>
      )}

      {/* FULL-SCREEN LAYOUT INTERFACE */}
      {!isMinimized && (
        <div 
          style={{ 
            position: "fixed", 
            top: 0, 
            left: 0, 
            width: "100vw", 
            height: "100vh", 
            background: "#111", 
            display: "flex", 
            flexDirection: "column", 
            justifyContent: "flex-start", 
            alignItems: "center", 
            zIndex: 9999
          }}
        >
          {/* WINDOW CONTROL NAVIGATION HEADER */}
          <div 
            style={{ 
              position: "absolute", 
              top: 0, 
              left: 0, 
              width: "100%", 
              display: "flex", 
              flexDirection: isMobile ? "column" : "row",
              justifyContent: "space-between", 
              alignItems: isMobile ? "stretch" : "center", 
              gap: isMobile ? "10px" : "0",
              padding: isMobile ? "10px 12px" : "15px 30px", 
              background: "rgba(0,0,0,0.6)",
              boxSizing: "border-box"
            }}
          >
            <div style={{ color: "#fff", fontWeight: "bold", fontSize: isMobile ? "13px" : "16px", lineHeight: 1.25 }}>
              {"Virtual Fitting Room - Live Studio Preview"}
              {!isLoaded && <span style={{ marginLeft: isMobile ? "8px" : "15px", color: "#a3a3a3", fontSize: isMobile ? "11px" : "13px" }}>{"Loading Textures..."}</span>}
            </div>
            
            {/* MINIMIZE AND CLOSE CONTROLS */}
            {isMobile ? (
              <div style={{ position: "relative", display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => setShowMobileControlsMenu((prev) => !prev)}
                  title="Open Controls"
                  style={{
                    background: "#111827",
                    color: "#fff",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: "bold"
                  }}
                >
                  {showMobileControlsMenu ? "▴ Controls" : "☰ Controls"}
                </button>

                {showMobileControlsMenu && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      right: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      background: "#111827",
                      border: "1px solid #374151",
                      borderRadius: "10px",
                      padding: "8px",
                      minWidth: "180px",
                      maxWidth: "calc(100vw - 24px)",
                      maxHeight: "calc(100vh - 140px)",
                      overflowY: "auto",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                      zIndex: 10000
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ color: "#fff", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", opacity: 0.8 }}>
                        Size
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={() => { setShowMobileControlsMenu(false); adjustScale(-0.1); }}
                          title="Decrease Image Size"
                          style={{ ...mobileControlButtonStyle, flex: 1 }}
                        >
                          −
                        </button>
                        <span style={{ color: "#fff", fontSize: "12px", minWidth: "42px", textAlign: "center", alignSelf: "center" }}>
                          {Math.round(manualScaleRef.current * 100)}%
                        </span>
                        <button
                          onClick={() => { setShowMobileControlsMenu(false); adjustScale(0.1); }}
                          title="Increase Image Size"
                          style={{ ...mobileControlButtonStyle, flex: 1 }}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ color: "#fff", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", opacity: 0.8 }}>
                        Vertical
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={() => { setShowMobileControlsMenu(false); adjustVerticalOffset(-5); }}
                          title="Move Image Up"
                          style={{ ...mobileControlButtonStyle, flex: 1 }}
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => { setShowMobileControlsMenu(false); adjustVerticalOffset(5); }}
                          title="Move Image Down"
                          style={{ ...mobileControlButtonStyle, flex: 1 }}
                        >
                          ↓
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ color: "#fff", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", opacity: 0.8 }}>
                        Horizontal
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={() => { setShowMobileControlsMenu(false); adjustHorizontalOffset(-5); }}
                          title="Move Image Left"
                          style={{ ...mobileControlButtonStyle, flex: 1 }}
                        >
                          ←
                        </button>
                        <button
                          onClick={() => { setShowMobileControlsMenu(false); adjustHorizontalOffset(5); }}
                          title="Move Image Right"
                          style={{ ...mobileControlButtonStyle, flex: 1 }}
                        >
                          →
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => { setShowMobileControlsMenu(false); setIsMinimized(true); }}
                      title="Minimize Window"
                      style={{ ...mobileControlActionButtonStyle, width: "100%" }}
                    >
                      {"➖ Minimize"}
                    </button>
                    <button
                      onClick={() => { setShowMobileControlsMenu(false); handleCloseFittingRoom(); }}
                      title="Close Fitting Room"
                      style={{ ...mobileControlDangerButtonStyle, width: "100%" }}
                    >
                      {"❌ Close"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "flex-start" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    padding: "4px 8px"
                  }}
                >
                  <button
                    onClick={() => adjustScale(-0.1)}
                    title="Decrease Image Size"
                    style={{
                      background: "#1f2937",
                      color: "#fff",
                      border: "1px solid #4b5563",
                      borderRadius: "6px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold"
                    }}
                  >
                    -
                  </button>
                  <span style={{ color: "#fff", fontSize: "12px", minWidth: "42px", textAlign: "center" }}>
                    {Math.round(manualScaleRef.current * 100)}%
                  </span>
                  <button
                    onClick={() => adjustScale(0.1)}
                    title="Increase Image Size"
                    style={{
                      background: "#1f2937",
                      color: "#fff",
                      border: "1px solid #4b5563",
                      borderRadius: "6px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold"
                    }}
                  >
                    +
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    padding: "4px 8px"
                  }}
                >
                  <button
                    onClick={() => adjustVerticalOffset(-5)}
                    title="Move Image Up"
                    style={{
                      background: "#1f2937",
                      color: "#fff",
                      border: "1px solid #4b5563",
                      borderRadius: "6px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold"
                    }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => adjustVerticalOffset(5)}
                    title="Move Image Down"
                    style={{
                      background: "#1f2937",
                      color: "#fff",
                      border: "1px solid #4b5563",
                      borderRadius: "6px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold"
                    }}
                  >
                    ↓
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    padding: "4px 8px"
                  }}
                >
                  <button
                    onClick={() => adjustHorizontalOffset(-5)}
                    title="Move Image Left"
                    style={{
                      background: "#1f2937",
                      color: "#fff",
                      border: "1px solid #4b5563",
                      borderRadius: "6px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold"
                    }}
                  >
                    ←
                  </button>
                  <button
                    onClick={() => adjustHorizontalOffset(5)}
                    title="Move Image Right"
                    style={{
                      background: "#1f2937",
                      color: "#fff",
                      border: "1px solid #4b5563",
                      borderRadius: "6px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold"
                    }}
                  >
                    →
                  </button>
                </div>

                <button
                  onClick={() => setIsMinimized(true)}
                  title="Minimize Window"
                  style={{
                    background: "#222",
                    color: "#fff",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    padding: "6px 14px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "bold"
                  }}
                >
                  {"➖ Minimize"}
                </button>
                <button
                  onClick={handleCloseFittingRoom}
                  title="Close Fitting Room"
                  style={{
                    background: "#ef4444",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "6px 14px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "bold"
                  }}
                >
                  {"❌ Close"}
                </button>
              </div>
            )}
          </div>

          {/* DYNAMIC SCALING VIEWPORT CANVAS BOUNDS */}
          <div 
            style={{ 
              position: "relative", 
              width: "100%", 
              height: isMobile ? "calc(100% - 130px)" : "calc(100% - 60px)", 
              marginTop: isMobile ? "130px" : "60px",
              padding: isMobile ? "8px" : "0",
              boxSizing: "border-box",
              display: "flex",
              justifyContent: "center",
              alignItems: "center"
            }}
          >
            <video ref={videoRef} autoPlay playsInline style={{ display: "none" }} />
            {inputSource === "photo" && (
              <>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelected}
                  style={{ display: "none" }}
                />
                {photoCanvas ? (
                  <div
                    style={{
                      position: "absolute",
                      top: "12px",
                      left: "12px",
                      zIndex: 2,
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "8px"
                    }}
                  >
                    <button
                      onClick={() => photoInputRef.current?.click()}
                      style={mobileControlActionButtonStyle}
                    >
                      {"📷 Change Photo"}
                    </button>
                    <label
                      style={{
                        ...mobileControlActionButtonStyle,
                        display: "flex",
                        alignItems: "center",
                        gap: "6px"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showBodyOutlines}
                        onChange={(e) => {
                          showBodyOutlinesRef.current = e.target.checked;
                          setShowBodyOutlines(e.target.checked);
                        }}
                      />
                      Debug: show body silhouette
                    </label>
                    {showBodyOutlines && (armDetectionStatus === "loading" || armDetectionStatus === "failed") && (
                      <span style={{ ...mobileControlActionButtonStyle, fontWeight: "normal" }}>
                        {armDetectionStatus === "loading"
                          ? "Refining arm outlines with BodyPix…"
                          : "BodyPix unavailable — showing estimated arms"}
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    style={{
                      position: "absolute",
                      zIndex: 2,
                      background: "#facc15",
                      color: "#1c1917",
                      border: "none",
                      borderRadius: "10px",
                      padding: "12px 20px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold"
                    }}
                  >
                    {"📷 Upload a Photo"}
                  </button>
                )}
              </>
            )}
            <canvas
              ref={canvasRef}
              width={targetWidth}
              height={targetHeight}
              style={{ 
                width: isMobile ? "96vw" : "auto",
                height: isMobile ? "auto" : "90%", 
                maxHeight: isMobile ? "calc(100vh - 160px)" : "none",
                aspectRatio: "4/3",
                // Mirror the webcam like a selfie view; a photo is shown as-is
                transform: inputSource === "photo" ? "none" : "rotateY(180deg)", 
                background: "#222",
                borderRadius: isMobile ? "8px" : "12px",
                boxShadow: "0 12px 36px rgba(0,0,0,0.5)"
              }}
            />
            <span style={{ display: "none" }}>{scaleVersion}</span>
          </div>
        </div>
      )}
    </>
  );
}