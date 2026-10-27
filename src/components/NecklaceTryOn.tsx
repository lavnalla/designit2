"use client";

import React, { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { parsePhoto, toParseCanvas } from "../lib/photoTryOnParsing";
import type { PhotoParse, RGBAImage, TryOnReport } from "../lib/photoTryOn";

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
  // A necklace on a chain: the image without its back chain (the part round the back of the neck, drawn
  // separately so it goes behind the neck), and the chain's look
  front?: HTMLCanvasElement;
  chain?: { colour: string; highlight: string; thickness: number };
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

// Where an earring hangs from: this fraction of the way down from the eye's outer corner to the mouth's corner (the
// earlobe, nearly level with the mouth)
const EARLOBE_DOWN = 0.95;
// ... and this fraction of the face's width out from its edge at the temples
const EARLOBE_OUT = 0.02;

// Where a necklace sits: its sides this fraction of the shoulder span apart (a neck's width, the chain resting
// just out on the shoulders' slope), this fraction of the way up from the shoulder joints' line to the chin
const NECKLACE_NECK_WIDTH = 0.5;
const NECKLACE_NECK_HEIGHT = 0.22;
// From the person's outline: how far out along each shoulder line (from the neck toward the shoulder tip) the
// chain lies
const NECKLACE_ON_SHOULDERS = 0.25;
// ... and for a necklace on a chain, which hangs from close in by the neck, high on the shoulders' slope
const NECKLACE_ON_SHOULDERS_CHAIN = 0.08;
// ... raised from there by this fraction of its width, its ends on the lower sides of the neck
const NECKLACE_LIFT_CHAIN = 0.12;
// ... and up this many canvas pixels more (two presses of the up arrow, 5 each)
const NECKLACE_CHAIN_RAISE = 10;
// ... and raised from there by this fraction of the width between those two points (it sits up against the
// base of the neck, not down on the slope)
const NECKLACE_LIFT = 0.28;
// A necklace without a chain: how far above the pose's estimate of the base of the neck its widest row goes
// (fraction of the picture's height), that row looked for in this top fraction of it
const NECKLACE_POSE_RAISE = 0.015;
const NECKLACE_NECK_SCAN = 0.35;
// ... and with the face in view, its top this fraction of the face's width below the chin (round the neck)
const NECKLACE_BELOW_CHIN = 0.15;
// ... on a photo (taken standing, the head up: more neck showing below the chin)
const NECKLACE_BELOW_CHIN_PHOTO = 0.35;
// A necklace image wraps the neck this fraction of its height down from its top (past the clasp at the back)
const NECKLACE_WRAP_DEPTH = 0.08;

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

  // A necklace wraps the base of the neck: its sides NECKLACE_NECK_WIDTH of the shoulder span apart, centred
  // under the chin, NECKLACE_NECK_HEIGHT of the way up from the shoulder line to the chin
  if (chin) {
    const chinX = chin.x * width;
    const chinY = chin.y * height;
    const half = (shoulderSpan * NECKLACE_NECK_WIDTH) / 2;

    return {
      chainStartX: chinX - half,
      chainStartY: leftShoulderY + (chinY - leftShoulderY) * NECKLACE_NECK_HEIGHT,
      chainEndX: chinX + half,
      chainEndY: rightShoulderY + (chinY - rightShoulderY) * NECKLACE_NECK_HEIGHT,
      controlX: chinX,
    };
  }

  const fallbackNeckY = shoulderMidY - shoulderSpan * 0.1;
  const half = (shoulderSpan * NECKLACE_NECK_WIDTH) / 2;

  return {
    chainStartX: shoulderMidX - half,
    chainStartY: fallbackNeckY,
    chainEndX: shoulderMidX + half,
    chainEndY: fallbackNeckY,
    controlX: shoulderMidX,
  };
}

// A chain is the thin part of a necklace: no thicker than this fraction of its heaviest part (a bib, a pendant)
const CHAIN_THINNESS = 0.3;
// A necklace image's pixels this opaque or more are the necklace itself (0-255); fainter ones, its shadow
const SOLID_ALPHA = 128;
// A necklace wraps the neck where, going down from its top, it first reaches this fraction of its full width
const WRAP_WIDTH = 0.95;
// The back chain drawn round the neck: up this fraction of the neck's width above where the necklace wraps it
// (its curve's pull: the chain's top, behind the neck, is about three quarters of this up), and pulled in
// toward the neck by this fraction of it as it rises
const CHAIN_RISE = 0.9;
const CHAIN_INWARD = 0.1;

// Splits a necklace image on a chain into its front (what hangs down the front when worn: a bib, a pendant on
// its chain) and its back chain (the top, where the chain turns in over the neck: round the back of it when
// worn). Returns the front image, anchors where it wraps the neck on each side (these go at the base of the
// neck), and the chain's colour and thickness; null if the necklace has no back chain.
function splitNecklaceChain(
  imageData: Uint8ClampedArray,
  w: number,
  bounds: OverlayBounds,
  source: CanvasImageSource,
): NecklaceAnchorPoints | null {
  const { minX, minY } = bounds;
  const bw = bounds.width + 1;
  const bh = bounds.height + 1;
  const n = bw * bh;
  const solid = new Uint8Array(n);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      // (Solid metal only: a soft shadow under it, or a faint halo, would make a chain look as thick as its
      // pendant)
      if (imageData[((y + minY) * w + x + minX) * 4 + 3] >= SOLID_ALPHA) solid[y * bw + x] = 1;
    }
  }
  // How far each pixel is from the necklace's edge (a two-pass chamfer), and from that how thick the necklace
  // is around it (the most within a radius)
  const dist = new Float32Array(n);
  for (let q = 0; q < n; q += 1) dist[q] = solid[q] ? bw + bh : 0;
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const q = y * bw + x;
      if (!dist[q]) continue;
      dist[q] = Math.min(dist[q], x > 0 ? dist[q - 1] + 1 : 1, y > 0 ? dist[q - bw] + 1 : 1);
    }
  }
  for (let y = bh - 1; y >= 0; y -= 1) {
    for (let x = bw - 1; x >= 0; x -= 1) {
      const q = y * bw + x;
      if (!dist[q]) continue;
      dist[q] = Math.min(dist[q], x < bw - 1 ? dist[q + 1] + 1 : 1, y < bh - 1 ? dist[q + bw] + 1 : 1);
    }
  }
  let deepest = 0;
  for (let q = 0; q < n; q += 1) deepest = Math.max(deepest, dist[q]);
  if (deepest < 3) return null;
  const chainMost = Math.max(1.5, deepest * CHAIN_THINNESS);
  const radius = Math.max(2, Math.ceil(chainMost * 2));
  const across = new Float32Array(n);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      let most = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(bw - 1, x + radius); k += 1) most = Math.max(most, dist[y * bw + k]);
      across[y * bw + x] = most;
    }
  }
  const thick = new Uint8Array(n);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const q = y * bw + x;
      if (!solid[q]) continue;
      let most = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(bh - 1, y + radius); k += 1) most = Math.max(most, across[k * bw + x]);
      if (most > chainMost) thick[q] = 1;
    }
  }
  // Where it wraps the neck: going down from its top, the first row where it's as wide as it gets (above it,
  // the chain turns in over the top: that part goes round the back of the neck, a heart's lobes and their V
  // included; below it, the necklace hangs down the front: a pendant's chain, a bib)
  const spanLeft = new Int32Array(bh).fill(-1);
  const spanRight = new Int32Array(bh).fill(-1);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      if (!solid[y * bw + x]) continue;
      if (spanLeft[y] < 0) spanLeft[y] = x;
      spanRight[y] = x;
    }
  }
  let widest = 0;
  for (let y = 0; y < Math.round(bh * 0.7); y += 1) if (spanLeft[y] >= 0) widest = Math.max(widest, spanRight[y] - spanLeft[y]);
  let wrapRow = -1;
  for (let y = 0; y < bh && wrapRow < 0; y += 1) {
    if (spanLeft[y] >= 0 && spanRight[y] - spanLeft[y] >= widest * WRAP_WIDTH) wrapRow = y;
  }
  // A back chain: what's above that row is mostly thin (a chain, not the top of a solid collar)
  let above = 0;
  let chainPixels = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const thicknesses: number[] = [];
  for (let y = 0; y < Math.max(0, wrapRow); y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const q = y * bw + x;
      if (!solid[q]) continue;
      above += 1;
      if (thick[q]) continue;
      chainPixels += 1;
      const i = ((y + minY) * w + x + minX) * 4;
      r += imageData[i];
      g += imageData[i + 1];
      b += imageData[i + 2];
      thicknesses.push(dist[q]);
    }
  }
  if (wrapRow <= 0 || chainPixels < Math.max(30, n * 0.005) || chainPixels < above * 0.5) return null;
  // Where it wraps the neck on each side: its outer edges just below that row
  let left = -1;
  let right = -1;
  const band = Math.max(2, Math.round(bh * 0.03));
  for (let y = wrapRow; y < Math.min(bh, wrapRow + band); y += 1) {
    if (spanLeft[y] < 0) continue;
    if (left < 0 || spanLeft[y] < left) left = spanLeft[y];
    if (spanRight[y] > right) right = spanRight[y];
  }
  if (left < 0 || right - left < bw * 0.2) return null;
  // The front: the image without the back chain
  const front = document.createElement("canvas");
  const fullW = (source as HTMLCanvasElement).width;
  const fullH = (source as HTMLCanvasElement).height;
  front.width = fullW;
  front.height = fullH;
  const frontCtx = front.getContext("2d");
  if (!frontCtx) return null;
  frontCtx.drawImage(source, 0, 0);
  const frontData = frontCtx.getImageData(0, 0, fullW, fullH);
  // (Everything above the wrap, and any bit of the back chain dipping below it left cut off from the front, like
  // the tip of a heart's V: pieces much smaller than the front itself)
  const kept = new Uint8Array(n);
  for (let q = wrapRow * bw; q < n; q += 1) kept[q] = solid[q];
  const piece = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < n; start += 1) {
    if (!kept[start] || piece[start] >= 0) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [start];
    piece[start] = id;
    while (stack.length) {
      const q = stack.pop()!;
      count += 1;
      const x = q % bw;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const r2 = q + dy * bw + dx;
          if (x + dx < 0 || x + dx >= bw || r2 < 0 || r2 >= n || !kept[r2] || piece[r2] >= 0) continue;
          piece[r2] = id;
          stack.push(r2);
        }
      }
    }
    sizes.push(count);
  }
  const biggest = Math.max(0, ...sizes);
  for (let q = 0; q < n; q += 1) {
    if (!solid[q]) continue;
    if (kept[q] && sizes[piece[q]] >= biggest * 0.1) continue;
    const x = q % bw;
    const y = (q - x) / bw;
    frontData.data[((y + minY) * fullW + x + minX) * 4 + 3] = 0;
  }
  // (And the back chain's shadow: everything faint above the wrap)
  for (let y = 0; y < wrapRow; y += 1) {
    for (let x = 0; x < bw; x += 1) frontData.data[((y + minY) * fullW + x + minX) * 4 + 3] = 0;
  }
  frontCtx.putImageData(frontData, 0, 0);
  // The chain's look: its average colour, a lighter one for its shine, and its width (twice its middle's
  // distance from its edge)
  thicknesses.sort((a, c) => a - c);
  const half = thicknesses[Math.floor(thicknesses.length * 0.75)] ?? 1;
  const mean = [r, g, b].map((v) => Math.round(v / chainPixels));
  const lighter = mean.map((v) => Math.round(v + (255 - v) * 0.55));
  return {
    leftNeckX: left + minX,
    rightNeckX: right + minX,
    neckY: wrapRow + minY,
    centerX: (left + right) / 2 + minX,
    front,
    chain: {
      colour: `rgb(${mean[0]}, ${mean[1]}, ${mean[2]})`,
      highlight: `rgb(${lighter[0]}, ${lighter[1]}, ${lighter[2]})`,
      thickness: Math.max(1, half * 2),
    },
  };
}

// The back chain of a necklace drawn round the neck: one chain from where the necklace wraps the neck on one
// side, up and round the back of the neck, down to the other side. Where the person is above the necklace (the
// neck, the head) it's behind them, so it's cut out there (from the person mask: opaque where the person is):
// what shows is the chain rising from the necklace to the neck's edge on each side, then going behind it.
let backChainCanvas: HTMLCanvasElement | null = null;
function drawBackChain(
  ctx: CanvasRenderingContext2D,
  leftEnd: { x: number; y: number },
  rightEnd: { x: number; y: number },
  neckWidth: number,
  chain: { colour: string; highlight: string; thickness: number },
  scale: number,
  personMask: CanvasImageSource | null,
) {
  const { width: w, height: h } = ctx.canvas;
  if (!backChainCanvas) backChainCanvas = document.createElement("canvas");
  if (backChainCanvas.width !== w) backChainCanvas.width = w;
  if (backChainCanvas.height !== h) backChainCanvas.height = h;
  const chainCtx = backChainCanvas.getContext("2d");
  if (!chainCtx) return;
  chainCtx.clearRect(0, 0, w, h);

  const width = Math.max(1, chain.thickness * scale);
  const rise = neckWidth * CHAIN_RISE;
  // Up from each end, in a little toward the neck, over the back of it
  const pull = neckWidth * CHAIN_INWARD;
  const trace = (offset: number) => {
    chainCtx.beginPath();
    chainCtx.moveTo(leftEnd.x, leftEnd.y + offset);
    chainCtx.bezierCurveTo(
      leftEnd.x + pull,
      leftEnd.y - rise + offset,
      rightEnd.x - pull,
      rightEnd.y - rise + offset,
      rightEnd.x,
      rightEnd.y + offset,
    );
  };
  chainCtx.lineCap = "round";
  // The chain, its links as short dashes, with a lighter line along it for its shine
  for (const [colour, lineWidth, offset] of [
    [chain.colour, width, 0],
    [chain.highlight, Math.max(0.6, width * 0.4), -width * 0.2],
  ] as Array<[string, number, number]>) {
    chainCtx.strokeStyle = colour;
    chainCtx.lineWidth = lineWidth;
    chainCtx.setLineDash([Math.max(1, width * 1.2), Math.max(0.5, width * 0.45)]);
    trace(offset);
    chainCtx.stroke();
  }
  chainCtx.setLineDash([]);

  // Behind the person above the necklace: cut out where the mask is, above the necklace's ends (a little
  // above, so the chain still shows leaving the necklace)
  if (personMask) {
    const cutBelow = Math.min(leftEnd.y, rightEnd.y) - width;
    chainCtx.save();
    chainCtx.beginPath();
    chainCtx.rect(0, 0, w, Math.max(0, cutBelow));
    chainCtx.clip();
    chainCtx.globalCompositeOperation = "destination-out";
    chainCtx.drawImage(personMask, 0, 0, w, h);
    chainCtx.restore();
  }
  ctx.drawImage(backChainCanvas, 0, 0);
}

// Where on a shoulder line (traced from the neck outward) a necklace's chain rests: a little way out onto the
// shoulders' slope, past the mask's ragged edge at the neck
function wrapIndex(line: Array<{ x: number; y: number }>, along = NECKLACE_ON_SHOULDERS) {
  return Math.min(line.length - 1, Math.max(2, Math.round(line.length * along)));
}

// A necklace's back chain: from each end of the necklace in to the side of the neck (along the top of the
// shoulder, just inside it on the skin, where the end rests on the shoulder; straight across where it's up on
// the neck), where it goes behind the neck and out of sight
function drawShoulderChain(
  ctx: CanvasRenderingContext2D,
  ends: Array<{ x: number; y: number }>,
  shoulderLines: Array<Array<{ x: number; y: number }>>,
  chain: { colour: string; highlight: string; thickness: number },
  scale: number,
) {
  const width = Math.max(1, chain.thickness * scale);
  // (Each end with the shoulder line nearer it)
  const lines = [...shoulderLines].sort((a, b) => a[0].x - b[0].x);
  const sortedEnds = [...ends].sort((a, b) => a.x - b.x);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  lines.forEach((line, side) => {
    const end = sortedEnds[side];
    // From the necklace's end in to the neck: along the shoulder line's points still below the end (on the
    // shoulder), then across to the neck's edge at the end's height
    const path = [end];
    for (let i = wrapIndex(line, NECKLACE_ON_SHOULDERS_CHAIN); i >= 0; i -= 1) {
      const y = line[i].y + width * 0.6;
      if (y >= end.y) path.push({ x: line[i].x, y });
    }
    const neckEdge = { x: line[0].x, y: Math.min(end.y, path[path.length - 1].y) };
    if (path.length === 1 || path[path.length - 1].x !== neckEdge.x) path.push(neckEdge);
    // Darker as it nears the neck, turning to go behind it
    const fade = ctx.createLinearGradient(end.x, end.y, line[0].x, line[0].y);
    for (const [colour, lineWidth, offset] of [
      [chain.colour, width, 0],
      [chain.highlight, Math.max(0.6, width * 0.4), -width * 0.2],
    ] as Array<[string, number, number]>) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = lineWidth;
      // Links: short dashes along it
      ctx.setLineDash([Math.max(1, width * 1.2), Math.max(0.5, width * 0.45)]);
      ctx.beginPath();
      path.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y + offset) : ctx.moveTo(point.x, point.y + offset)));
      ctx.stroke();
    }
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(0.7, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.setLineDash([]);
    ctx.strokeStyle = fade;
    ctx.lineWidth = width;
    ctx.beginPath();
    path.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
    ctx.stroke();
  });
  ctx.restore();
}

// Where a necklace sits, from the person's outline: the shoulder lines traced from each side of the neck
// outward start just outside the neck on the top of the shoulders' slope, where a necklace rests. Null
// without both lines.
// (onChain: a necklace on a chain, resting on the shoulders close in by the neck, not lifted)
function necklaceAtNeckBase(shoulderLines: Array<Array<{ x: number; y: number }>> | null | undefined, onChain = false) {
  if (!shoulderLines || shoulderLines.length !== 2) return null;
  const along = onChain ? NECKLACE_ON_SHOULDERS_CHAIN : NECKLACE_ON_SHOULDERS;
  const pick = (line: Array<{ x: number; y: number }>) => line[wrapIndex(line, along)];
  const a = pick(shoulderLines[0]);
  const b = pick(shoulderLines[1]);
  const left = a.x <= b.x ? a : b;
  const right = a.x <= b.x ? b : a;
  if (right.x - left.x < 4) return null;
  const lift = (right.x - left.x) * (onChain ? NECKLACE_LIFT_CHAIN : NECKLACE_LIFT);
  return {
    chainStartX: left.x,
    chainStartY: left.y - lift,
    chainEndX: right.x,
    chainEndY: right.y - lift,
    controlX: (left.x + right.x) / 2,
  };
}

function getNecklaceFallbackAnchors(bounds: OverlayBounds) {
  const upperBandHeight = Math.max(2, Math.floor(bounds.height * NECKLACE_WRAP_DEPTH));
  const neckY = bounds.minY + upperBandHeight;
  const inset = bounds.width * 0.18;

  return {
    leftNeckX: bounds.minX + inset,
    rightNeckX: bounds.maxX - inset,
    neckY,
    centerX: (bounds.minX + bounds.maxX) / 2,
  };
}

// The canvas cropped to what's drawn on it (its visible pixels, with a pixel's margin); as it is if it's empty
function trimToContent(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return canvas;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] < 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return canvas;
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(canvas.width - 1, maxX + 1);
  maxY = Math.min(canvas.height - 1, maxY + 1);
  const trimmed = document.createElement("canvas");
  trimmed.width = maxX - minX + 1;
  trimmed.height = maxY - minY + 1;
  trimmed.getContext("2d")?.drawImage(canvas, minX, minY, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
  return trimmed;
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
  // Left/right extent of each row of the torso piece, for cutting rows to the model's torso
  torsoRows: RowExtents;
  // centroid: the sleeve's centre (garment-image pixels), for pointing it down the model's arm
  sleeves: Array<{
    canvas: HTMLCanvasElement;
    box: PieceBox;
    side: "left" | "right";
    centroid: { x: number; y: number };
  }>;
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
    torsoRows: rowExtents(w, h, (p) => alpha[p * 4 + 3] >= 16),
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
  let leftSumX = 0;
  let leftSumY = 0;
  let rightSumX = 0;
  let rightSumY = 0;

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
        leftSumX += x;
        leftSumY += y;
      } else {
        target = right;
        growBox(rightBox, x, y);
        rightPixels += 1;
        rightSumX += x;
        rightSumY += y;
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
  if (leftPixels >= MIN_PIECE_PIXELS) {
    const centroid = { x: leftSumX / leftPixels, y: leftSumY / leftPixels };
    sleeves.push({ canvas: toCanvas(left), box: leftBox, side: "left", centroid });
  }
  if (rightPixels >= MIN_PIECE_PIXELS) {
    const centroid = { x: rightSumX / rightPixels, y: rightSumY / rightPixels };
    sleeves.push({ canvas: toCanvas(right), box: rightBox, side: "right", centroid });
  }

  // A sleeve's shoulder point: the top of its seam, i.e. its highest pixel touching the body, taking the
  // outer end when the seam's top row touches along a stretch (else its inner top corner). Each row is
  // scanned from the garment's outer edge inward so both sides pick their outer end.
  const sleeveShoulder = (side: "left" | "right", box: PieceBox) => {
    const onThisSide = (x: number) => (side === "left" ? x < centerX : x >= centerX);
    const step = side === "left" ? 1 : -1;
    for (let y = box.minY; y <= box.maxY; y += 1) {
      for (let x = side === "left" ? box.minX : box.maxX; x >= box.minX && x <= box.maxX; x += step) {
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
  // Vertically a shoulder point sits on the garment's top edge directly above it. A sleeve seam can join the
  // body well below the shoulder line (batwing/dolman sleeves); lining that low point up with the model's
  // shoulder pushed the whole top of the garment up to the chin.
  const onTopEdge = (point: { x: number; y: number }) => {
    const x = Math.min(w - 1, Math.max(0, Math.round(point.x)));
    for (let y = 0; y < h; y += 1) {
      if (wholeData.data[(y * w + x) * 4 + 3] >= 16) return { x: point.x, y: Math.min(point.y, y) };
    }
    return point;
  };
  shoulders.left = onTopEdge(shoulders.left);
  shoulders.right = onTopEdge(shoulders.right);

  return {
    torso: toCanvas(torso),
    torsoRows: rowExtents(w, h, (p) => torso.data[p * 4 + 3] >= 16),
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
// rest on the model's and cover the slope out to the tips. The shoulder lines come from the photo's body
// analysis, or on the webcam from the live person mask each frame. Without them, the pose's shoulder joints,
// moved out toward the tips and up toward the top of the shoulder.
function modelShoulderPoints(
  shoulderLines: Array<Array<{ x: number; y: number }>> | null | undefined,
  lm: PoseLandmark[] | null | undefined,
  w: number,
  h: number,
): { left: { x: number; y: number }; right: { x: number; y: number }; source: string } | null {
  if (shoulderLines && shoulderLines.length >= 2) {
    const [leftLine, rightLine] = [...shoulderLines].sort((a, b) => a[0].x - b[0].x);
    const point = (line: Array<{ x: number; y: number }>) => ({
      x: line[line.length - 1].x,
      y: line[Math.round((line.length - 1) * 0.25)].y,
    });
    return { left: point(leftLine), right: point(rightLine), source: "shoulder lines" };
  }
  if (lm?.[11] && lm?.[12]) {
    const ax = lm[11].x * w;
    const ay = lm[11].y * h;
    const bx = lm[12].x * w;
    const by = lm[12].y * h;
    // The joints sit inside the body, well below the top of the shoulder near the neck: push each out
    // toward its shoulder tip (15% wider in total) and up by a fifth of the shoulder width
    const outward = 0.075;
    const lift = Math.hypot(bx - ax, by - ay) * 0.2;
    const a = { x: ax + (ax - bx) * outward, y: ay + (ay - by) * outward - lift };
    const b = { x: bx + (bx - ax) * outward, y: by + (by - ay) * outward - lift };
    const source = "pose shoulder joints";
    return a.x <= b.x ? { left: a, right: b, source } : { left: b, right: a, source };
  }
  return null;
}

// Webcam: the shoulder lines traced straight from the live person mask each frame, the same way as on a
// photo (the full body analysis only runs on photos, and would lag live video). One canvas is reused for
// reading the mask.
let liveMaskCanvas: HTMLCanvasElement | null = null;

function liveShoulderLines(
  mask: CanvasImageSource,
  lm: PoseLandmark[] | null | undefined,
  face: PoseLandmark[] | null | undefined,
  w: number,
  h: number,
): Array<Array<{ x: number; y: number }>> {
  if (!liveMaskCanvas) liveMaskCanvas = document.createElement("canvas");
  if (liveMaskCanvas.width !== w) liveMaskCanvas.width = w;
  if (liveMaskCanvas.height !== h) liveMaskCanvas.height = h;
  const maskCtx = liveMaskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return [];
  maskCtx.clearRect(0, 0, w, h);
  maskCtx.drawImage(mask, 0, 0, w, h);
  const alpha = maskCtx.getImageData(0, 0, w, h).data;
  const inside = new Uint8Array(w * h);
  for (let p = 0; p < inside.length; p += 1) inside[p] = alpha[p * 4 + 3] > 128 ? 1 : 0;
  return traceShoulderLines(inside, lm, face, w, h);
}

// How far each sleeve is turned and moved from its flat-lay position toward lying along the model's arm:
// 1 = straight down the arm, 0 = exactly as in the garment photo. Partway keeps the sleeves held out from
// the body, so the garment keeps its T-shirt shape.
const SLEEVE_TOWARD_ARM = 0.4;

// How much of one row of the garment's torso was cut off because it was wider than the model's torso there:
// on the left and right, in photo pixels and in garment-image pixels
type TorsoTruncation = {
  photoY: number;
  garmentY: number;
  left: number;
  right: number;
  leftGarment: number;
  rightGarment: number;
};

// The garment placed exactly like drawGarmentWhole (upright, its shoulders spanning the model's), with:
// - its torso drawn row by row; given the model's torso rows (photo mode), each row wider than the model's
//   torso there has the part outside it cut off. Rows above or below the model's torso, rows that fit, and
//   every row when there are no torso rows (webcam), are drawn whole.
// - each sleeve turned about its shoulder point partway (SLEEVE_TOWARD_ARM) toward pointing down that arm
//   (shoulder joint -> elbow), and moved partway toward the arm's centre line: the sleeves go over the
//   model's arms but stay held out from the body like a T-shirt's.
// Returns how much was cut on each cut row, or null (so the whole garment is drawn instead) when the garment
// has no shoulder points or torso rows.
function drawGarmentTruncated(
  ctx: CanvasRenderingContext2D,
  pieces: GarmentPieces,
  modelTorsoRows: RowExtents | null | undefined,
  arms: ArmPolyline[],
  modelLeft: { x: number; y: number },
  modelRight: { x: number; y: number },
  manualScale: number,
  offsetX: number,
  offsetY: number,
): TorsoTruncation[] | null {
  // Also rejects data built by older code that survived a hot reload
  const shoulders = pieces.shoulders as GarmentPieces["shoulders"] | undefined;
  const garmentRows = pieces.torsoRows as RowExtents | undefined;
  if (!shoulders || !garmentRows) return null;
  const garmentSpan = Math.abs(shoulders.right.x - shoulders.left.x);
  const modelSpan = Math.abs(modelRight.x - modelLeft.x);
  if (garmentSpan < 1 || modelSpan < 1) return null;

  // Same placement as drawGarmentWhole
  const scale = (modelSpan / garmentSpan) * manualScale;
  const garmentMidX = (shoulders.left.x + shoulders.right.x) / 2;
  const garmentMidY = (shoulders.left.y + shoulders.right.y) / 2;
  const modelMidX = (modelLeft.x + modelRight.x) / 2 + offsetX;
  const modelMidY = (modelLeft.y + modelRight.y) / 2 + offsetY;
  const toPhotoX = (x: number) => modelMidX + (x - garmentMidX) * scale;
  const toPhotoY = (y: number) => modelMidY + (y - garmentMidY) * scale;

  const cuts: TorsoTruncation[] = [];
  const rowHeight = Math.max(1, scale) + 0.5; // a little overlap so rows leave no hairline gaps
  ctx.save();
  // Off while drawing 1-pixel source rows: with it on each row blends with the empty rows around it (stripes)
  ctx.imageSmoothingEnabled = false;
  for (let gy = 0; gy < garmentRows.minX.length; gy += 1) {
    const gL = garmentRows.minX[gy];
    const gR = garmentRows.maxX[gy];
    if (gR < gL) continue;
    const photoY = toPhotoY(gy + 0.5);
    const rowLeft = toPhotoX(gL);
    const rowRight = toPhotoX(gR + 1);

    // The model's torso on this photo row (it doesn't move with the manual offset; the garment does)
    let cutLeft = 0;
    let cutRight = 0;
    const my = Math.round(photoY);
    if (modelTorsoRows && my >= 0 && my < modelTorsoRows.minX.length && modelTorsoRows.maxX[my] >= modelTorsoRows.minX[my]) {
      cutLeft = Math.max(0, modelTorsoRows.minX[my] - rowLeft);
      cutRight = Math.max(0, rowRight - (modelTorsoRows.maxX[my] + 1));
      if (cutLeft > 0 || cutRight > 0) {
        cuts.push({
          photoY: my,
          garmentY: gy,
          left: cutLeft,
          right: cutRight,
          leftGarment: cutLeft / scale,
          rightGarment: cutRight / scale,
        });
      }
    }

    const drawLeft = rowLeft + cutLeft;
    const drawRight = rowRight - cutRight;
    if (drawRight <= drawLeft) continue; // the whole row was outside the model's torso
    ctx.drawImage(
      pieces.torso,
      gL + cutLeft / scale,
      gy,
      (drawRight - drawLeft) / scale,
      1,
      drawLeft,
      photoY - rowHeight / 2,
      drawRight - drawLeft,
      rowHeight,
    );
  }
  ctx.restore();

  // Sleeves over the arms: each keeps its size and shape, turned about its shoulder point to point down the
  // arm and slid sideways onto the arm's centre line (the shoulder point is at the shoulder tip, a little
  // outside the arm's joint). The arm line moves with the manual offset so sleeves stay with the garment.
  for (const sleeve of pieces.sleeves) {
    const shoulder = sleeve.side === "left" ? shoulders.left : shoulders.right;
    const pivot = { x: toPhotoX(shoulder.x), y: toPhotoY(shoulder.y) };
    let turn = 0;
    let shiftX = 0;
    let shiftY = 0;
    const arm = arms.find((candidate) => candidate.label === (sleeve.side === "left" ? 1 : 2));
    if (arm && sleeve.centroid) {
      const centre = { x: toPhotoX(sleeve.centroid.x), y: toPhotoY(sleeve.centroid.y) };
      const joint = { x: arm.segments[0].a.x + offsetX, y: arm.segments[0].a.y + offsetY };
      const elbow = { x: arm.segments[0].b.x + offsetX, y: arm.segments[0].b.y + offsetY };
      const armAngle = Math.atan2(elbow.y - joint.y, elbow.x - joint.x);
      const sleeveAngle = Math.atan2(centre.y - pivot.y, centre.x - pivot.x);
      turn = SLEEVE_TOWARD_ARM * Math.atan2(Math.sin(armAngle - sleeveAngle), Math.cos(armAngle - sleeveAngle));
      // Where the sleeve's centre lands after turning, then partway toward the nearest point on the arm's line
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const turnedX = pivot.x + (centre.x - pivot.x) * cos - (centre.y - pivot.y) * sin;
      const turnedY = pivot.y + (centre.x - pivot.x) * sin + (centre.y - pivot.y) * cos;
      const alongX = Math.cos(armAngle);
      const alongY = Math.sin(armAngle);
      const t = (turnedX - joint.x) * alongX + (turnedY - joint.y) * alongY;
      shiftX = SLEEVE_TOWARD_ARM * (joint.x + alongX * t - turnedX);
      shiftY = SLEEVE_TOWARD_ARM * (joint.y + alongY * t - turnedY);
    }
    ctx.save();
    ctx.translate(pivot.x + shiftX, pivot.y + shiftY);
    ctx.rotate(turn);
    ctx.scale(scale, scale);
    ctx.translate(-shoulder.x, -shoulder.y);
    ctx.drawImage(sleeve.canvas, 0, 0);
    ctx.restore();
  }
  return cuts;
}

// Photo and webcam: places the whole garment in one piece, upright, so its shoulders span the model's shoulder
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
  torsoFillRows: RowExtents; // the torso's left/right extent on each row, from the base of the neck to the hips
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
      // Where an arm hangs in front of the torso's side, the side continues behind it: extend the edge
      // into the arm by half the arm's width on this row (about to its middle)
      const isArm = (x: number) => x >= 0 && x < w && inside[y * w + x] === 1 && arms[y * w + x] !== 0;
      let armRun = 0;
      while (isArm(left - 1 - armRun)) armRun += 1;
      left -= Math.floor(armRun / 2);
      armRun = 0;
      while (isArm(right + 1 + armRun)) armRun += 1;
      right += Math.floor(armRun / 2);
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
    torsoFillRows,
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

// The design with its white background see-through: the white (or near-white, grey-free) reaching in from the
// image's edges, and the white showing through gaps in it (the space inside a crescent earring or a necklace's
// loop), wherever there's more than a speck of it (a shine on metal stays). The pixels where the design meets
// the background are faded by how white they are, so its edge stays smooth.
const BACKGROUND_WHITE = 235;
const BACKGROUND_GREY = 20;
const DESIGN_EDGE_WHITE = 200;
// White enclosed by the design is background if there's at least this much of it (fraction of the image)
const ENCLOSED_WHITE = 0.0005;
async function withoutWhiteBackground(src: string): Promise<string> {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !w || !h) return src;
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const { data } = image;
  const isBackground = (p: number) => {
    const i = p * 4;
    if (data[i + 3] < 16) return true;
    const lo = Math.min(data[i], data[i + 1], data[i + 2]);
    const hi = Math.max(data[i], data[i + 1], data[i + 2]);
    return lo >= BACKGROUND_WHITE && hi - lo <= BACKGROUND_GREY;
  };
  const background = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let end = 0;
  const visit = (p: number) => {
    if (background[p] || !isBackground(p)) return;
    background[p] = 1;
    queue[end] = p;
    end += 1;
  };
  for (let x = 0; x < w; x += 1) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  for (let at = 0; at < end; at += 1) {
    const p = queue[at];
    const x = p % w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < w * (h - 1)) visit(p + w);
  }
  // White enclosed by the design: each patch of it big enough
  const enclosedMin = Math.max(12, Math.round(w * h * ENCLOSED_WHITE));
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start += 1) {
    if (background[start] || seen[start] || !isBackground(start)) continue;
    const patchStart = end;
    seen[start] = 1;
    queue[end] = start;
    end += 1;
    for (let at = patchStart; at < end; at += 1) {
      const p = queue[at];
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1]) {
        if (q < 0 || seen[q] || background[q] || !isBackground(q)) continue;
        seen[q] = 1;
        queue[end] = q;
        end += 1;
      }
    }
    if (end - patchStart >= enclosedMin) {
      for (let at = patchStart; at < end; at += 1) background[queue[at]] = 1;
    } else {
      end = patchStart;
    }
  }
  if (!end) return src;
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    if (background[p]) {
      data[i + 3] = 0;
      continue;
    }
    // (The design's edge: next to the background, as see-through as it's near white)
    const x = p % w;
    const nextToBackground =
      (x > 0 && background[p - 1]) ||
      (x < w - 1 && background[p + 1]) ||
      (p >= w && background[p - w]) ||
      (p < w * (h - 1) && background[p + w]);
    if (!nextToBackground) continue;
    const lo = Math.min(data[i], data[i + 1], data[i + 2]);
    if (lo > DESIGN_EDGE_WHITE) {
      data[i + 3] = Math.round(data[i + 3] * Math.max(0, (255 - lo) / (255 - DESIGN_EDGE_WHITE)));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
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

// The person photo wearing the garment photo's garment (photoTryOn.ts, run in a worker: it takes a few
// seconds of number crunching)
async function fitGarmentOnPhoto(
  person: HTMLCanvasElement,
  garmentSrc: string,
): Promise<{ canvas: HTMLCanvasElement; report: TryOnReport }> {
  const personParse = await parsePhoto(person);
  const garmentParse = await parsePhoto(toParseCanvas(await loadImage(garmentSrc)));
  const { image, report } = await new Promise<{ image: RGBAImage; report: TryOnReport }>((resolve, reject) => {
    const worker = new Worker(new URL("../lib/photoTryOn.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ image?: RGBAImage; report?: TryOnReport; error?: string }>) => {
      worker.terminate();
      if (e.data.error || !e.data.image || !e.data.report) reject(new Error(e.data.error ?? "Try-on failed"));
      else resolve({ image: e.data.image, report: e.data.report });
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    const message: { person: PhotoParse; garment: PhotoParse } = { person: personParse, garment: garmentParse };
    worker.postMessage(message);
  });
  const out = document.createElement("canvas");
  out.width = image.width;
  out.height = image.height;
  const outCtx = out.getContext("2d");
  if (outCtx) {
    const imageData = outCtx.createImageData(image.width, image.height);
    imageData.data.set(image.data);
    outCtx.putImageData(imageData, 0, 0);
  }
  return { canvas: out, report };
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
  // The design as it's worn: its white background cleared (jewellery and garments alike)
  const [designSrc, setDesignSrc] = useState<string | null>(null);
  useEffect(() => {
    setDesignSrc(null);
    if (!selectedImageSrc) return;
    let cancelled = false;
    withoutWhiteBackground(selectedImageSrc)
      .catch(() => selectedImageSrc)
      .then((src) => {
        if (!cancelled) setDesignSrc(src);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedImageSrc]);
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
  // Photo mode: how much of each row of the garment's torso was cut off to fit the model's torso (last frame)
  const torsoTruncationRef = useRef<TorsoTruncation[]>([]);
  // Debug checkbox; mirrored into a ref so the render loop sees changes without restarting
  const [showBodyOutlines, setShowBodyOutlines] = useState(false);
  const showBodyOutlinesRef = useRef(false);
  // Exact arm shapes from BodyPix for the uploaded photo (the pose-based estimate shows until then)
  const bodyPixPartsRef = useRef<{ source: HTMLCanvasElement; parts: BodyPixPartSegmentation } | null>(null);
  const [armDetectionStatus, setArmDetectionStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  // Garment fitted onto the photo (photo mode): the uploaded photo at parsing size, and the result
  const [photoOriginal, setPhotoOriginal] = useState<HTMLCanvasElement | null>(null);
  const [fittedResultUrl, setFittedResultUrl] = useState<string | null>(null);
  const [fitStatus, setFitStatus] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [fitError, setFitError] = useState<string | null>(null);
  const [showFitted, setShowFitted] = useState(false);
  // Bumped whenever the photo or garment changes, so a drape still running for the old ones is dropped
  const fitRequestRef = useRef(0);

  // A different garment needs a new drape
  useEffect(() => {
    fitRequestRef.current += 1;
    setFittedResultUrl(null);
    setFitStatus("idle");
    setShowFitted(false);
  }, [selectedImageSrc]);

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
  // (The necklace is already placed and sized at the base of the neck; it starts a few presses of the up arrow
  // higher, 5 each: three on the webcam, one on a photo)
  const NECKLACE_STARTUP_SCALE = 1;
  const NECKLACE_STARTUP_Y_OFFSET = -15;
  const NECKLACE_STARTUP_Y_OFFSET_PHOTO = -5;
  const EARRING_STARTUP_SCALE = 0.72;
  const isLoaded = scriptsLoaded.camera && scriptsLoaded.selfie && scriptsLoaded.holistic;
  const isMobile = viewportWidth <= 768;

  useEffect(() => {
    if (mode === "necklace") {
      manualScaleRef.current = NECKLACE_STARTUP_SCALE;
      manualOffsetYRef.current = inputSource === "photo" ? NECKLACE_STARTUP_Y_OFFSET_PHOTO : NECKLACE_STARTUP_Y_OFFSET;
    } else if (mode === "earrings") {
      manualScaleRef.current = EARRING_STARTUP_SCALE;
      manualOffsetYRef.current = 0;
    } else {
      manualScaleRef.current = 1;
      manualOffsetYRef.current = 0;
    }
    manualOffsetXRef.current = 0;
    setScaleVersion((prev) => prev + 1);
  }, [mode, inputSource, EARRING_STARTUP_SCALE, NECKLACE_STARTUP_SCALE, NECKLACE_STARTUP_Y_OFFSET, NECKLACE_STARTUP_Y_OFFSET_PHOTO]);

  useEffect(() => {
    earringAssetsRef.current = null;
    if (mode !== "earrings" || !designSrc) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // The earring as given, whole: worn as it is on one ear and mirrored on the other (trimmed to itself, so
      // the empty space round it in the image isn't sized as part of it)
      const whole = document.createElement("canvas");
      whole.width = img.width;
      whole.height = img.height;
      whole.getContext("2d")?.drawImage(img, 0, 0);
      const earring = trimToContent(whole);
      const mirrored = document.createElement("canvas");
      mirrored.width = earring.width;
      mirrored.height = earring.height;
      const mirroredCtx = mirrored.getContext("2d");
      if (mirroredCtx) {
        mirroredCtx.translate(mirrored.width, 0);
        mirroredCtx.scale(-1, 1);
        mirroredCtx.drawImage(earring, 0, 0);
      }
      earringAssetsRef.current = { left: earring, right: mirrored };
    };
    img.src = designSrc;
  }, [mode, designSrc]);

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
    if (!designSrc) return;

    let cancelled = false;
    Promise.all([loadImage(designSrc), partMaskSrc ? loadImage(partMaskSrc) : Promise.resolve(null)])
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
  }, [designSrc, partMaskSrc]);

  // Automated Background Pre-Cropper Watcher
  useEffect(() => {
    if (!designSrc) return;

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

            // Where a necklace without a chain sits at the base of the neck: its widest row in its top
            // NECKLACE_NECK_SCAN (a collar flares out there)
            const scanBottom = Math.min(bounds.maxY, bounds.minY + Math.max(8, Math.floor(bounds.height * NECKLACE_NECK_SCAN)));
            let wrapRow = -1;
            let wrapLeft = -1;
            let wrapRight = -1;
            for (let y = bounds.minY; y <= scanBottom; y += 1) {
              let rowLeft = -1;
              let rowRight = -1;
              for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
                if (imageData[(y * localCropC.width + x) * 4 + 3] < 16) continue;
                if (rowLeft === -1) rowLeft = x;
                rowRight = x;
              }
              if (rowLeft !== -1 && rowRight - rowLeft > wrapRight - wrapLeft) {
                wrapRow = y;
                wrapLeft = rowLeft;
                wrapRight = rowRight;
              }
            }

            // A necklace on a chain: its front goes at the base of the neck, its chain round the back
            const onChain = splitNecklaceChain(imageData, localCropC.width, bounds, localCropC);
            necklaceAnchorsRef.current = onChain
              ? onChain
              : wrapRow === -1
                ? getNecklaceFallbackAnchors(bounds)
                : {
                    leftNeckX: wrapLeft,
                    rightNeckX: wrapRight,
                    neckY: wrapRow,
                    centerX: (wrapLeft + wrapRight) / 2,
                  };
          } else {
            overlayBoundsRef.current = null;
            necklaceAnchorsRef.current = null;
          }
        };
        processedImg.src = localCropC.toDataURL();
      }
    };
    img.src = designSrc;
  }, [mode, designSrc]);

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
    // The model's shoulder points the garment was last placed on: logged when they move, marked in debug view
    let lastModelShoulders: ReturnType<typeof modelShoulderPoints> = null;
    let lastModelShouldersKey = "";
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
                  // The earlobes: about level with the base of the nose, EARLOBE_DOWN of the way down from the eyes'
                  // outer corners to the mouth's
                  const leftEarY = (leftEye.y * h) + ((leftMouth.y - leftEye.y) * h * EARLOBE_DOWN) + manualOffsetYRef.current;
                  const rightEarY = (rightEye.y * h) + ((rightMouth.y - rightEye.y) * h * EARLOBE_DOWN) + manualOffsetYRef.current;
                  // (Just outside the face's edge at the temples, under the earlobes)
                  const leftEarX = leftTempleX - faceWidth * EARLOBE_OUT + manualOffsetXRef.current;
                  const rightEarX = rightTempleX + faceWidth * EARLOBE_OUT + manualOffsetXRef.current;
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
              // Where the neck meets the shoulders, from the person's outline (else estimated from the pose)
              const chin = faceLandmarks?.[152];
              const shoulderLines =
                bodyAnalysis?.shoulderLines ?? liveShoulderLines(currentCamMask, lm, faceLandmarks, w, h);
              // A necklace on a chain from the person's outline (its ends resting on the shoulders); one without,
              // its widest row at the base of the neck from the pose, NECKLACE_POSE_RAISE above it
              const onChain = !!necklaceAnchorsRef.current.chain;
              const fromPose = getNecklacePlacement(lm, w, h, chin);
              const fromOutline = necklaceAtNeckBase(shoulderLines, onChain);
              const placement = onChain ? fromOutline ?? fromPose : fromPose ?? fromOutline;
              const poseRaise = !onChain && fromPose ? h * NECKLACE_POSE_RAISE : 0;

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
                // (A necklace on a chain rests with its ends on the shoulders, on the skin, its chain going on
                // round the back of the neck: not lifted like a chainless one)
                const onShoulders = !!sourceAnchors.chain && shoulderLines?.length === 2;
                // (and up by NECKLACE_CHAIN_RAISE)
                const chainDrop = onShoulders ? sourceAnchors.chain!.thickness * scale * 0.6 - NECKLACE_CHAIN_RAISE : 0;
                // A necklace without a chain goes round the neck: its top NECKLACE_BELOW_CHIN of the face's width
                // below the chin (the face is tracked steadily; the shoulders, often at the frame's edge, aren't)
                const leftTemple = faceLandmarks?.[FACE_LANDMARKS.leftTemple];
                const rightTemple = faceLandmarks?.[FACE_LANDMARKS.rightTemple];
                const necklaceTop = overlayBoundsRef.current?.minY ?? 0;
                const drawY =
                  !onChain && chin && leftTemple && rightTemple
                    ? chin.y * h +
                      Math.hypot((rightTemple.x - leftTemple.x) * w, (rightTemple.y - leftTemple.y) * h) *
                        (isPhoto ? NECKLACE_BELOW_CHIN_PHOTO : NECKLACE_BELOW_CHIN) -
                      necklaceTop * scale +
                      manualOffsetYRef.current
                    : shoulderLineY - sourceAnchors.neckY * scale + manualOffsetYRef.current + chainDrop - poseRaise;

                canvasCtx.drawImage(sourceAnchors.front ?? croppedImageElement, drawX, drawY, drawW, drawH);
                // Its back chain: on the shoulders, in to the neck and behind it; without the person's outline,
                // round the neck and cut out where the person is
                if (sourceAnchors.chain && onShoulders) {
                  const at = (x: number, y: number) => ({ x: drawX + x * scale, y: drawY + y * scale });
                  drawShoulderChain(
                    canvasCtx,
                    [at(sourceAnchors.leftNeckX, sourceAnchors.neckY), at(sourceAnchors.rightNeckX, sourceAnchors.neckY)],
                    shoulderLines!,
                    sourceAnchors.chain,
                    scale,
                  );
                } else if (sourceAnchors.chain) {
                  const at = (x: number, y: number) => ({ x: drawX + x * scale, y: drawY + y * scale });
                  drawBackChain(
                    canvasCtx,
                    at(sourceAnchors.leftNeckX, sourceAnchors.neckY),
                    at(sourceAnchors.rightNeckX, sourceAnchors.neckY),
                    liveNeckWidth,
                    sourceAnchors.chain,
                    scale,
                    currentCamMask,
                  );
                }
              }
            } else if (garmentPiecesRef.current && piecesCtx) {
              // Photo and webcam: the whole garment drawn straight on top in one piece — not trimmed to the
              // person's outline and without face/hand cut-outs, so its full shape (sleeves included) stays
              // visible. Its shoulders go on the person's shoulders: from the body analysis on a photo, from
              // the pose on the webcam (the analysis only rebuilds every 250ms, which would lag live video).
              const garmentPieces = garmentPiecesRef.current;
              piecesCtx.clearRect(0, 0, w, h);
              // Shoulder lines from the photo's body analysis, or traced from the live person mask on the webcam
              const shoulderLines =
                bodyAnalysis?.shoulderLines ??
                (currentCamMask ? liveShoulderLines(currentCamMask, lm, faceLandmarks, w, h) : null);
              const modelShoulders = modelShoulderPoints(shoulderLines, lm, w, h);
              lastModelShoulders = modelShoulders;
              const shouldersKey = modelShoulders
                ? `(${Math.round(modelShoulders.left.x)}, ${Math.round(modelShoulders.left.y)}) / ` +
                  `(${Math.round(modelShoulders.right.x)}, ${Math.round(modelShoulders.right.y)}) from the ${modelShoulders.source}`
                : "none";
              if (shouldersKey !== lastModelShouldersKey) {
                console.info(`[Try-on] model shoulder points (${w}x${h} canvas): ${shouldersKey}`);
                lastModelShouldersKey = shouldersKey;
              }
              // The garment's sleeves go over the model's arms. On a photo, rows of the garment's torso wider
              // than the model's torso are also cut to it, and how much was cut on each row is kept in
              // torsoTruncationRef; on the webcam (no body analysis) the torso is drawn whole.
              const cuts =
                modelShoulders !== null
                  ? drawGarmentTruncated(
                      piecesCtx,
                      garmentPieces,
                      bodyAnalysis?.torsoFillRows ?? null,
                      armPolylines(lm, w, h),
                      modelShoulders.left,
                      modelShoulders.right,
                      manualScaleRef.current,
                      manualOffsetXRef.current,
                      manualOffsetYRef.current,
                    )
                  : null;
              torsoTruncationRef.current = cuts ?? [];
              const placed =
                cuts !== null ||
                (modelShoulders !== null &&
                  drawGarmentWhole(
                    piecesCtx,
                    garmentPieces,
                    modelShoulders.left,
                    modelShoulders.right,
                    manualScaleRef.current,
                    manualOffsetXRef.current,
                    manualOffsetYRef.current,
                  ));
              const fitPath =
                cuts !== null
                  ? `whole garment on top, torso cut to the model's torso on ${cuts.length} rows, shoulders aligned to the model's ${modelShoulders?.source}`
                  : placed
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
              // On the webcam the garment is worn: kept only where the person is (their outline from the camera,
              // arms included), so it takes their shape and moves with their arms. A photo shows it whole.
              if (!isPhoto && currentCamMask) {
                piecesCtx.save();
                piecesCtx.globalCompositeOperation = "destination-in";
                piecesCtx.drawImage(currentCamMask, 0, 0, w, h);
                piecesCtx.restore();
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
        // Debug: cyan dots on the model's shoulder points, where the garment's shoulders were placed
        if (isPhoto && showBodyOutlinesRef.current && lastModelShoulders) {
          canvasCtx.save();
          for (const point of [lastModelShoulders.left, lastModelShoulders.right]) {
            canvasCtx.beginPath();
            canvasCtx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
            canvasCtx.fillStyle = "#00e5ff";
            canvasCtx.fill();
            canvasCtx.lineWidth = 2;
            canvasCtx.strokeStyle = "#000000";
            canvasCtx.stroke();
          }
          canvasCtx.restore();
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
      setPhotoOriginal(toParseCanvas(img));
      fitRequestRef.current += 1;
      setFittedResultUrl(null);
      setFitStatus("idle");
      setShowFitted(false);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  // Fits the garment onto the uploaded photo (once per photo and garment; the result is kept)
  const startFit = () => {
    if (fittedResultUrl || fitStatus === "working" || !photoOriginal || !selectedImageSrc) return;
    setFitStatus("working");
    setFitError(null);
    const request = fitRequestRef.current;
    fitGarmentOnPhoto(photoOriginal, selectedImageSrc)
      .then(({ canvas, report }) => {
        if (request !== fitRequestRef.current) return;
        console.info("[Fit garment]", report);
        setFittedResultUrl(canvas.toDataURL("image/jpeg", 0.92));
        setFitStatus("done");
      })
      .catch((err) => {
        console.warn("[Fit garment] failed", err);
        if (request !== fitRequestRef.current) return;
        setFitError(err instanceof Error ? err.message : String(err));
        setFitStatus("failed");
      });
  };

  // The button switches between the fitted photo and the live overlay
  const handleFitGarment = () => {
    if (showFitted) {
      setShowFitted(false);
      return;
    }
    setShowFitted(true);
    startFit();
  };

  // In photo mode a garment is fitted as soon as there's a photo (and again for each new photo or garment)
  useEffect(() => {
    if (inputSource !== "photo" || mode !== "garment" || !photoOriginal || !selectedImageSrc) return;
    if (fitStatus !== "idle") return;
    setShowFitted(true);
    startFit();
    // startFit reads the state listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputSource, mode, photoOriginal, selectedImageSrc, fitStatus]);

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

  // (Big enough to tap: the size and position buttons along the top on a phone)
  const mobileAdjustButtonStyle: React.CSSProperties = {
    background: "#1f2937",
    color: "#fff",
    border: "1px solid #4b5563",
    borderRadius: "6px",
    padding: "8px 0",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: "bold",
    flex: 1,
    minWidth: 0,
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
            // dvh, not vh: with vh the overlay is taller than the visible viewport on mobile
            // browsers, pushing the header controls out of reach with nothing to scroll.
            height: "100dvh",
            maxHeight: "100dvh",
            overflow: "hidden",
            overscrollBehavior: "none",
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
            
            {/* On a phone: size and position always on show, in one row (Minimize and Close in the menu) */}
            {isMobile && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", order: 2 }}>
                <button onClick={() => adjustScale(-0.1)} title="Decrease Image Size" style={mobileAdjustButtonStyle}>
                  −
                </button>
                <span style={{ color: "#fff", fontSize: "12px", minWidth: "38px", textAlign: "center" }}>
                  {Math.round(manualScaleRef.current * 100)}%
                </span>
                <button onClick={() => adjustScale(0.1)} title="Increase Image Size" style={mobileAdjustButtonStyle}>
                  +
                </button>
                <button onClick={() => adjustVerticalOffset(-5)} title="Move Image Up" style={mobileAdjustButtonStyle}>
                  ↑
                </button>
                <button onClick={() => adjustVerticalOffset(5)} title="Move Image Down" style={mobileAdjustButtonStyle}>
                  ↓
                </button>
                <button onClick={() => adjustHorizontalOffset(-5)} title="Move Image Left" style={mobileAdjustButtonStyle}>
                  ←
                </button>
                <button onClick={() => adjustHorizontalOffset(5)} title="Move Image Right" style={mobileAdjustButtonStyle}>
                  →
                </button>
              </div>
            )}

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
                  {showMobileControlsMenu ? "▴ Menu" : "☰ Menu"}
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
                      maxHeight: "calc(100dvh - 140px)",
                      overflowY: "auto",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                      zIndex: 10000
                    }}
                  >
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
              height: isMobile ? "calc(100% - 170px)" : "calc(100% - 60px)", 
              marginTop: isMobile ? "170px" : "60px",
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
                    {mode === "garment" && (
                      <button
                        onClick={handleFitGarment}
                        title="Fit this garment onto your photo, shaped to your body"
                        style={mobileControlActionButtonStyle}
                      >
                        {showFitted ? "↩ Back to overlay" : "✨ Fit to my photo"}
                      </button>
                    )}
                    {showFitted && (fitStatus === "working" || fitStatus === "failed") && (
                      <span style={{ ...mobileControlActionButtonStyle, fontWeight: "normal" }}>
                        {fitStatus === "working" ? "Fitting the garment…" : `Couldn't fit the garment: ${fitError}`}
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
            {showFitted && fitStatus === "working" && (
              <div
                style={{
                  position: "absolute",
                  zIndex: 3,
                  background: "rgba(17, 24, 39, 0.85)",
                  color: "#fff",
                  borderRadius: "10px",
                  padding: "12px 20px",
                  fontSize: "14px",
                  fontWeight: "bold",
                }}
              >
                Fitting the garment to your photo… (the first time also downloads the models)
              </div>
            )}
            {showFitted && fittedResultUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fittedResultUrl}
                alt="Your photo wearing the garment"
                style={{
                  maxWidth: isMobile ? "96vw" : "100%",
                  maxHeight: isMobile ? "calc(100dvh - 200px)" : "90%",
                  objectFit: "contain",
                  borderRadius: isMobile ? "8px" : "12px",
                  boxShadow: "0 12px 36px rgba(0,0,0,0.5)"
                }}
              />
            )}
            <canvas
              ref={canvasRef}
              width={targetWidth}
              height={targetHeight}
              style={{
                display: showFitted && fittedResultUrl ? "none" : undefined,
                width: isMobile ? "96vw" : "auto",
                height: isMobile ? "auto" : "90%", 
                maxHeight: isMobile ? "calc(100dvh - 200px)" : "none",
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