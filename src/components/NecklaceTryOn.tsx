"use client";

import React, { useEffect, useRef, useState } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const MEDIAPIPE_TASKS_VERSION = "0.10.35";
const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/wasm`;
const MEDIAPIPE_NOISE_PATTERNS = [
  "face_landmarker_graph.cc:180",
  "FaceBlendshapesGraph acceleration to xnnpack by default",
  "gl_context.cc:1118",
  "landmark_projection_calculator.cc:81",
  "OpenGL error checking is disabled",
  "Created TensorFlow Lite XNNPACK delegate for CPU"
];
const BODY_MASK_THRESHOLD = 0.35;
const GARMENT_ALPHA_THRESHOLD = 12;
const SNAPSHOT_INTERVAL_MS = 1000;
const LANDMARK_SMOOTHING = 0.8;
const NECKLACE_SHOULDER_Y_DROP_FACTOR = 0.06;

type AccessoryType = "garment" | "necklace" | "earrings";

interface BodyVisualizerProps {
  selectedImageSrc?: string | null;
}

type SegmentationFrame = {
  data: Float32Array;
  width: number;
  height: number;
};

function lerp(prev: number, next: number, smoothing: number) {
  return prev * smoothing + next * (1 - smoothing);
}

export default function BodyVisualizer({ selectedImageSrc }: BodyVisualizerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const requestRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastSnapshotAtRef = useRef(0);
  const latestSegmentationRef = useRef<SegmentationFrame | null>(null);
  const garmentImageRef = useRef<HTMLImageElement | null>(null);
  const garmentLayerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const garmentShoulderCenterNormRef = useRef<number>(0.5);
  const garmentShoulderYNormRef = useRef<number>(0.08);
  const necklaceAnchorXNormRef = useRef<number>(0.5);
  const necklaceAnchorYNormRef = useRef<number>(0.08);
  const necklaceCenterXNormRef = useRef<number>(0.5);
  const necklaceCenterYNormRef = useRef<number>(0.5);
  const modelShoulderCenterNormRef = useRef<number | null>(null);
  const modelShoulderYNormRef = useRef<number | null>(null);
  const modelShoulderWidthNormRef = useRef<number>(0.25);
  const modelNeckNormRef = useRef<{ x: number; y: number } | null>(null);
  const modelLeftEarNormRef = useRef<{ x: number; y: number } | null>(null);
  const modelRightEarNormRef = useRef<{ x: number; y: number } | null>(null);
  const latestLandmarksRef = useRef<Array<{ x: number; y: number }> | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [statusText, setStatusText] = useState("Loading tracking models...");
  const [showTouchKeyboard, setShowTouchKeyboard] = useState(false);
  const [accessoryType, setAccessoryType] = useState<AccessoryType>("garment");
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [manualScale, setManualScale] = useState(1);
  const [manualOffsetY, setManualOffsetY] = useState(0);
  const [manualOffsetX, setManualOffsetX] = useState(0);
  const [isWindowOpen, setIsWindowOpen] = useState(true);
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(true);

  const manualScaleRef = useRef(1);
  const manualOffsetYRef = useRef(0);
  const manualOffsetXRef = useRef(0);

  const adjustScale = (delta: number) => {
    setManualScale((prev) => {
      const next = Math.max(0.6, Math.min(1.6, prev + delta));
      return Math.round(next * 1000) / 1000;
    });
  };

  const adjustOffsetY = (delta: number) => {
    setManualOffsetY((prev) => Math.max(-120, Math.min(120, prev + delta)));
  };

  const adjustOffsetX = (delta: number) => {
    setManualOffsetX((prev) => Math.max(-120, Math.min(120, prev + delta)));
  };

  const closeTryOn = () => {
    setIsWindowOpen(false);
    setIsWindowMinimized(false);
    setIsActive(false);
    setHasSnapshot(false);
    setStatusText("Try-on closed.");

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    manualScaleRef.current = manualScale;
  }, [manualScale]);

  useEffect(() => {
    manualOffsetYRef.current = manualOffsetY;
  }, [manualOffsetY]);

  useEffect(() => {
    manualOffsetXRef.current = manualOffsetX;
  }, [manualOffsetX]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || target?.isContentEditable) {
        return;
      }

      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        saveScreenshot();
        return;
      }

      if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
        event.preventDefault();
        adjustScale(0.03);
        return;
      }

      if (event.key === "-" || event.code === "NumpadSubtract") {
        event.preventDefault();
        adjustScale(-0.03);
        return;
      }

      if (event.key === "u" || event.key === "U" || event.code === "KeyU") {
        event.preventDefault();
        adjustOffsetY(-4);
        return;
      }

      if (event.key === "j" || event.key === "J" || event.code === "KeyJ") {
        event.preventDefault();
        adjustOffsetY(4);
        return;
      }

      if (event.key === "h" || event.key === "H" || event.code === "KeyH" || event.code === "ArrowLeft") {
        event.preventDefault();
        adjustOffsetX(-4);
        return;
      }

      if (event.key === "k" || event.key === "K" || event.code === "KeyK" || event.code === "ArrowRight") {
        event.preventDefault();
        adjustOffsetX(4);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 900px)");
    const sync = () => setShowTouchKeyboard(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    garmentImageRef.current = null;
    lastSnapshotAtRef.current = 0;
    setHasSnapshot(false);
    garmentShoulderCenterNormRef.current = 0.5;
    garmentShoulderYNormRef.current = 0.08;
    necklaceAnchorXNormRef.current = 0.5;
    necklaceAnchorYNormRef.current = 0.08;
    necklaceCenterXNormRef.current = 0.5;
    necklaceCenterYNormRef.current = 0.5;

    if (!selectedImageSrc) {
      return;
    }

    const img = new window.Image();
    if (!selectedImageSrc.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      garmentImageRef.current = img;

      // Estimate garment shoulder center from the widest row in the upper garment band.
      try {
        const measureCanvas = document.createElement("canvas");
        measureCanvas.width = img.naturalWidth;
        measureCanvas.height = img.naturalHeight;
        const measureCtx = measureCanvas.getContext("2d", { willReadFrequently: true });
        if (!measureCtx || img.naturalWidth < 2 || img.naturalHeight < 2) {
          return;
        }

        measureCtx.clearRect(0, 0, measureCanvas.width, measureCanvas.height);
        measureCtx.drawImage(img, 0, 0);
        const imageData = measureCtx.getImageData(0, 0, measureCanvas.width, measureCanvas.height);

        const topBandEnd = Math.max(1, Math.floor(measureCanvas.height * 0.45));
        let bestWidth = -1;
        let bestCenter = measureCanvas.width / 2;
        let bestRowY = 0;

        for (let y = 0; y < topBandEnd; y++) {
          let rowLeft = -1;
          let rowRight = -1;
          for (let x = 0; x < measureCanvas.width; x++) {
            const alpha = imageData.data[(y * measureCanvas.width + x) * 4 + 3];
            if (alpha > GARMENT_ALPHA_THRESHOLD) {
              if (rowLeft === -1) rowLeft = x;
              rowRight = x;
            }
          }

          if (rowLeft !== -1 && rowRight !== -1) {
            const rowWidth = rowRight - rowLeft + 1;
            if (rowWidth > bestWidth) {
              bestWidth = rowWidth;
              bestCenter = (rowLeft + rowRight) / 2;
              bestRowY = y;
            }
          }
        }

        garmentShoulderCenterNormRef.current = Math.max(0, Math.min(1, bestCenter / Math.max(1, measureCanvas.width - 1)));
        garmentShoulderYNormRef.current = Math.max(0, Math.min(1, bestRowY / Math.max(1, measureCanvas.height - 1)));

        // True necklace visual center from opaque pixel bounding box.
        let minX = measureCanvas.width;
        let minY = measureCanvas.height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < measureCanvas.height; y++) {
          for (let x = 0; x < measureCanvas.width; x++) {
            const alpha = imageData.data[(y * measureCanvas.width + x) * 4 + 3];
            if (alpha > GARMENT_ALPHA_THRESHOLD) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX >= minX && maxY >= minY) {
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          necklaceCenterXNormRef.current = Math.max(0, Math.min(1, cx / Math.max(1, measureCanvas.width - 1)));
          necklaceCenterYNormRef.current = Math.max(0, Math.min(1, cy / Math.max(1, measureCanvas.height - 1)));
        }

        // Necklace-specific anchor: top-chain region center, not the widest garment row.
        let topY = -1;
        for (let y = 0; y < measureCanvas.height; y++) {
          let hasOpaque = false;
          for (let x = 0; x < measureCanvas.width; x++) {
            const alpha = imageData.data[(y * measureCanvas.width + x) * 4 + 3];
            if (alpha > GARMENT_ALPHA_THRESHOLD) {
              hasOpaque = true;
              break;
            }
          }
          if (hasOpaque) {
            topY = y;
            break;
          }
        }

        if (topY >= 0) {
          const topBandBottom = Math.min(measureCanvas.height - 1, topY + Math.max(2, Math.floor(measureCanvas.height * 0.2)));
          let totalCenter = 0;
          let rowCount = 0;

          for (let y = topY; y <= topBandBottom; y++) {
            let rowLeft = -1;
            let rowRight = -1;
            for (let x = 0; x < measureCanvas.width; x++) {
              const alpha = imageData.data[(y * measureCanvas.width + x) * 4 + 3];
              if (alpha > GARMENT_ALPHA_THRESHOLD) {
                if (rowLeft === -1) rowLeft = x;
                rowRight = x;
              }
            }

            if (rowLeft !== -1 && rowRight !== -1) {
              totalCenter += (rowLeft + rowRight) / 2;
              rowCount += 1;
            }
          }

          if (rowCount > 0) {
            const necklaceCenter = totalCenter / rowCount;
            necklaceAnchorXNormRef.current = Math.max(0, Math.min(1, necklaceCenter / Math.max(1, measureCanvas.width - 1)));
            necklaceAnchorYNormRef.current = Math.max(0, Math.min(1, topY / Math.max(1, measureCanvas.height - 1)));
          } else {
            necklaceAnchorXNormRef.current = garmentShoulderCenterNormRef.current;
            necklaceAnchorYNormRef.current = Math.max(0, garmentShoulderYNormRef.current * 0.45);
          }
        } else {
          necklaceAnchorXNormRef.current = garmentShoulderCenterNormRef.current;
          necklaceAnchorYNormRef.current = Math.max(0, garmentShoulderYNormRef.current * 0.45);
        }
      } catch (measureError) {
        console.warn("Garment shoulder center measurement failed", measureError);
      }
    };
    img.onerror = () => {
      garmentImageRef.current = null;
      console.warn("Garment image failed to load for try-on compositing");
    };
    img.src = selectedImageSrc;
  }, [selectedImageSrc]);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 }
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        lastSnapshotAtRef.current = 0;
        setHasSnapshot(false);
        setStatusText("Capturing snapshot every 1 second...");
        setIsActive(true);
      } catch (err) {
        setStatusText("Webcam connection failed.");
        console.error(err);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    const withSuppressedMediapipeLogs = async <T,>(task: () => Promise<T>) => {
      const shouldDrop = (args: unknown[]) => {
        const message = args.map((arg) => String(arg)).join(" ");
        return MEDIAPIPE_NOISE_PATTERNS.some((pattern) => message.includes(pattern));
      };

      const originalLog = console.log;
      const originalInfo = console.info;
      const originalWarn = console.warn;

      console.log = (...args: unknown[]) => {
        if (!shouldDrop(args)) originalLog(...args);
      };
      console.info = (...args: unknown[]) => {
        if (!shouldDrop(args)) originalInfo(...args);
      };
      console.warn = (...args: unknown[]) => {
        if (!shouldDrop(args)) originalWarn(...args);
      };

      try {
        return await task();
      } finally {
        console.log = originalLog;
        console.info = originalInfo;
        console.warn = originalWarn;
      }
    };
    
    async function setup() {
      try {
        const vision = await withSuppressedMediapipeLogs(async () => {
          return FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        });

        if (!poseLandmarkerRef.current) {
          setStatusText("Loading tracking engine models...");

          const landmarker = await withSuppressedMediapipeLogs(async () => {
            return PoseLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                delegate: "GPU"
              },
              runningMode: "VIDEO",
              outputSegmentationMasks: true
            });
          });
          if (!active) return;
          poseLandmarkerRef.current = landmarker;
        }

        setStatusText("Ready! Live try-on compositing active.");

      } catch (error) {
        console.error(error);
        setStatusText("Failed to initialize system assets.");
      }
    }

    setup();

    return () => {
      active = false;
    };
  }, []);

  function saveScreenshot() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const snapshotCanvas = document.createElement("canvas");
    snapshotCanvas.width = canvas.width;
    snapshotCanvas.height = canvas.height;
    const sCtx = snapshotCanvas.getContext("2d");

    if (sCtx) {
      sCtx.translate(snapshotCanvas.width, 0);
      sCtx.scale(-1, 1);
      sCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
      sCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height);

      const link = document.createElement("a");
      link.download = `body_segments_${Date.now()}.png`;
      link.href = snapshotCanvas.toDataURL("image/png");
      link.click();
    }
  }

  useEffect(() => {
    const compositeGarmentIntoBody = (
      ctx: CanvasRenderingContext2D,
      frame: SegmentationFrame,
      garmentImage: HTMLImageElement,
      targetWidth: number,
      targetHeight: number,
      modelShoulderCenterNorm: number | null,
      modelShoulderYNorm: number | null
    ) => {
      // Find a coarse body bounding box from segmentation to place the garment image.
      let minMaskX = frame.width;
      let minMaskY = frame.height;
      let maxMaskX = -1;
      let maxMaskY = -1;

      for (let y = 0; y < frame.height; y++) {
        const row = y * frame.width;
        for (let x = 0; x < frame.width; x++) {
          if (frame.data[row + x] > BODY_MASK_THRESHOLD) {
            if (x < minMaskX) minMaskX = x;
            if (y < minMaskY) minMaskY = y;
            if (x > maxMaskX) maxMaskX = x;
            if (y > maxMaskY) maxMaskY = y;
          }
        }
      }

      if (maxMaskX < minMaskX || maxMaskY < minMaskY) {
        return;
      }

      const bodyX = Math.max(0, Math.floor((minMaskX / frame.width) * targetWidth));
      const bodyY = Math.max(0, Math.floor((minMaskY / frame.height) * targetHeight));
      const bodyW = Math.max(1, Math.ceil(((maxMaskX - minMaskX + 1) / frame.width) * targetWidth));
      const bodyH = Math.max(1, Math.ceil(((maxMaskY - minMaskY + 1) / frame.height) * targetHeight));

      const modelShoulderCenterX = modelShoulderCenterNorm !== null
        ? modelShoulderCenterNorm * targetWidth
        : (bodyX + bodyW / 2);
      const modelShoulderY = modelShoulderYNorm !== null
        ? modelShoulderYNorm * targetHeight
        : bodyY;
      const garmentShoulderCenterNorm = garmentShoulderCenterNormRef.current;
      const garmentShoulderYNorm = garmentShoulderYNormRef.current;
      const garmentDrawW = bodyW;
      const garmentDrawH = bodyH;
      const unclampedDrawX = Math.round(modelShoulderCenterX - garmentShoulderCenterNorm * garmentDrawW);
      const unclampedDrawY = Math.round(modelShoulderY - garmentShoulderYNorm * garmentDrawH);
      const garmentDrawX = Math.max(-garmentDrawW + 1, Math.min(targetWidth - 1, unclampedDrawX));
      const garmentDrawY = Math.max(-garmentDrawH + 1, Math.min(targetHeight - 1, unclampedDrawY));

      if (!garmentLayerCanvasRef.current) {
        garmentLayerCanvasRef.current = document.createElement("canvas");
      }
      const garmentCanvas = garmentLayerCanvasRef.current;
      garmentCanvas.width = targetWidth;
      garmentCanvas.height = targetHeight;
      const garmentCtx = garmentCanvas.getContext("2d", { willReadFrequently: true });
      if (!garmentCtx) return;

      garmentCtx.clearRect(0, 0, targetWidth, targetHeight);
      garmentCtx.drawImage(garmentImage, garmentDrawX, garmentDrawY, garmentDrawW, garmentDrawH);

      const cameraFrame = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const cameraData = cameraFrame.data;
      const garmentData = garmentCtx.getImageData(0, 0, targetWidth, targetHeight).data;

      for (let y = 0; y < targetHeight; y++) {
        const maskY = Math.min(frame.height - 1, Math.floor((y / targetHeight) * frame.height));
        const maskRow = maskY * frame.width;
        for (let x = 0; x < targetWidth; x++) {
          const maskX = Math.min(frame.width - 1, Math.floor((x / targetWidth) * frame.width));
          if (frame.data[maskRow + maskX] <= BODY_MASK_THRESHOLD) {
            continue;
          }

          const idx = (y * targetWidth + x) * 4;
          const garmentAlpha = garmentData[idx + 3];
          if (garmentAlpha === 0) {
            continue;
          }

          cameraData[idx] = garmentData[idx];
          cameraData[idx + 1] = garmentData[idx + 1];
          cameraData[idx + 2] = garmentData[idx + 2];
          cameraData[idx + 3] = 255;
        }
      }

      ctx.putImageData(cameraFrame, 0, 0);
    };

    const compositeNecklaceIntoNeck = (
      ctx: CanvasRenderingContext2D,
      garmentImage: HTMLImageElement,
      targetWidth: number,
      targetHeight: number,
      neckNorm: { x: number; y: number } | null,
      shoulderWidthNorm: number,
      shoulderCenterNorm: number | null,
      shoulderYNorm: number | null
    ) => {
      if (!neckNorm) return;

      const centerXNorm = shoulderCenterNorm ?? neckNorm.x;
      const neckX = centerXNorm * targetWidth;
      const centerYNorm = shoulderYNorm ?? neckNorm.y;
      const shoulderWidthPx = Math.max(40, shoulderWidthNorm * targetWidth);
      const shoulderYDropPx = shoulderWidthPx * NECKLACE_SHOULDER_Y_DROP_FACTOR;
      const neckY = centerYNorm * targetHeight + shoulderYDropPx;

      const adjustedBaseW = shoulderWidthPx * 0.98 * manualScaleRef.current;
      const drawW = Math.max(44, Math.min(targetWidth * 0.9, adjustedBaseW));
      const drawH = drawW * (garmentImage.naturalHeight / Math.max(1, garmentImage.naturalWidth));
      const drawX = neckX - necklaceCenterXNormRef.current * drawW + manualOffsetXRef.current;
      const drawY = neckY - necklaceCenterYNormRef.current * drawH + manualOffsetYRef.current;

      if (!garmentLayerCanvasRef.current) {
        garmentLayerCanvasRef.current = document.createElement("canvas");
      }
      const necklaceCanvas = garmentLayerCanvasRef.current;
      necklaceCanvas.width = targetWidth;
      necklaceCanvas.height = targetHeight;
      const necklaceCtx = necklaceCanvas.getContext("2d", { willReadFrequently: true });
      if (!necklaceCtx) return;

      necklaceCtx.clearRect(0, 0, targetWidth, targetHeight);
      necklaceCtx.drawImage(garmentImage, drawX, drawY, drawW, drawH);

      const composed = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const necklaceData = necklaceCtx.getImageData(0, 0, targetWidth, targetHeight).data;

      // Hard pixel replacement (no overlay blending): necklace pixels replace camera pixels.
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const idx = (y * targetWidth + x) * 4;
          const alpha = necklaceData[idx + 3];
          if (alpha === 0) continue;

          composed.data[idx] = necklaceData[idx];
          composed.data[idx + 1] = necklaceData[idx + 1];
          composed.data[idx + 2] = necklaceData[idx + 2];
          composed.data[idx + 3] = 255;
        }
      }

      ctx.putImageData(composed, 0, 0);
    };

    const compositeEarrings = (
      ctx: CanvasRenderingContext2D,
      garmentImage: HTMLImageElement,
      targetWidth: number,
      targetHeight: number,
      leftEar: { x: number; y: number } | null,
      rightEar: { x: number; y: number } | null,
      shoulderWidthNorm: number
    ) => {
      const shoulderWidthPx = Math.max(40, shoulderWidthNorm * targetWidth);
      const drawW = Math.max(26, shoulderWidthPx * 0.22);
      const drawH = drawW * (garmentImage.naturalHeight / Math.max(1, garmentImage.naturalWidth));

      if (leftEar) {
        const x = leftEar.x * targetWidth - drawW * 0.92;
        const y = leftEar.y * targetHeight - drawH * 0.12;
        ctx.drawImage(garmentImage, x, y, drawW, drawH);
      }

      if (rightEar) {
        const x = rightEar.x * targetWidth - drawW * 0.08;
        const y = rightEar.y * targetHeight - drawH * 0.12;
        ctx.save();
        ctx.translate(x + drawW, y);
        ctx.scale(-1, 1);
        ctx.drawImage(garmentImage, 0, 0, drawW, drawH);
        ctx.restore();
      }
    };

    const drawDebugOutlines = (
      ctx: CanvasRenderingContext2D,
      targetWidth: number,
      targetHeight: number,
      landmarks: Array<{ x: number; y: number }> | null
    ) => {
      if (!landmarks) return;

      const getPoint = (index: number) => {
        const p = landmarks[index];
        if (!p) return null;
        return { x: p.x * targetWidth, y: p.y * targetHeight };
      };

      const drawPath = (indices: number[], color: string, closePath = false, lineWidth = 2) => {
        const pts = indices.map(getPoint).filter((p): p is { x: number; y: number } => Boolean(p));
        if (pts.length < 2) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        if (closePath) ctx.closePath();
        ctx.stroke();
        ctx.restore();
      };

      const drawCurvedChain = (indices: number[], color: string, lineWidth = 2) => {
        const pts = indices.map(getPoint).filter((p): p is { x: number; y: number } => Boolean(p));
        if (pts.length < 2) return;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const curr = pts[i];
          const cx = (prev.x + curr.x) / 2;
          const cy = (prev.y + curr.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, cx, cy);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        ctx.restore();
      };

      const leftShoulder = getPoint(11);
      const rightShoulder = getPoint(12);
      const leftMouth = getPoint(9);
      const rightMouth = getPoint(10);
      const leftHip = getPoint(23);
      const rightHip = getPoint(24);
      const shoulderWidthPx = leftShoulder && rightShoulder
        ? Math.max(30, Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y))
        : 80;

      // Face: round/oval from ear span and eye level.
      const leftEar = getPoint(7);
      const rightEar = getPoint(8);
      const nose = getPoint(0);
      const leftEye = getPoint(2);
      const rightEye = getPoint(5);
      if (leftEar && rightEar && nose && leftEye && rightEye) {
        const centerX = (leftEar.x + rightEar.x) / 2;
        const eyeY = (leftEye.y + rightEye.y) / 2;
        const radiusX = Math.max(18, Math.abs(rightEar.x - leftEar.x) * 0.56);
        const radiusY = Math.max(22, Math.abs(nose.y - eyeY) * 2.1);

        ctx.save();
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(centerX, eyeY + radiusY * 0.25, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        drawPath([7, 3, 2, 1, 0, 4, 5, 6, 8, 10, 9], "#22d3ee", true, 2);
      }

      // Torso outside boundary.
      if (leftShoulder && rightShoulder && rightHip && leftHip) {
        ctx.save();
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(leftShoulder.x, leftShoulder.y);
        ctx.lineTo(rightShoulder.x, rightShoulder.y);
        ctx.lineTo(rightHip.x, rightHip.y);
        ctx.lineTo(leftHip.x, leftHip.y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      } else {
        drawPath([11, 12, 24, 23], "#f59e0b", true, 2);
      }

      // Arms outside contours.
      drawCurvedChain([11, 13, 15, 17, 19, 21], "#a3e635", 2);
      drawCurvedChain([12, 14, 16, 18, 20, 22], "#a3e635", 2);

      // Neck: semi-circle based on shoulder span.
      if (leftShoulder && rightShoulder) {
        const centerX = (leftShoulder.x + rightShoulder.x) / 2;
        const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
        const topY = leftMouth && rightMouth
          ? (leftMouth.y + rightMouth.y) / 2
          : shoulderY - shoulderWidthPx * 0.22;
        const centerY = topY + (shoulderY - topY) * 0.45;
        const radiusX = shoulderWidthPx * 0.22;
        const radiusY = Math.max(10, shoulderWidthPx * 0.12);

        ctx.save();
        ctx.strokeStyle = "#f472b6";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, Math.PI, 0, false);
        ctx.stroke();
        ctx.restore();
      }
    };

    const withSuppressedMediapipeLogsSync = <T,>(task: () => T): T => {
      const shouldDrop = (args: unknown[]) => {
        const message = args.map((arg) => String(arg)).join(" ");
        return MEDIAPIPE_NOISE_PATTERNS.some((pattern) => message.includes(pattern));
      };

      const originalLog = console.log;
      const originalInfo = console.info;
      const originalWarn = console.warn;

      console.log = (...args: unknown[]) => {
        if (!shouldDrop(args)) originalLog(...args);
      };
      console.info = (...args: unknown[]) => {
        if (!shouldDrop(args)) originalInfo(...args);
      };
      console.warn = (...args: unknown[]) => {
        if (!shouldDrop(args)) originalWarn(...args);
      };

      try {
        return task();
      } finally {
        console.log = originalLog;
        console.info = originalInfo;
        console.warn = originalWarn;
      }
    };

    function predictLoop() {
      const video = videoRef.current;
      const displayCanvas = canvasRef.current;
      const landmarker = poseLandmarkerRef.current;

      if (video && displayCanvas) {
        const targetW = video.videoWidth || 640;
        const targetH = video.videoHeight || 480;

        if (displayCanvas.width !== targetW || displayCanvas.height !== targetH) {
          displayCanvas.width = targetW;
          displayCanvas.height = targetH;
        }

        if (!processingCanvasRef.current) {
          processingCanvasRef.current = document.createElement("canvas");
        }
        const processingCanvas = processingCanvasRef.current;
        if (processingCanvas.width !== targetW || processingCanvas.height !== targetH) {
          processingCanvas.width = targetW;
          processingCanvas.height = targetH;
        }

        const displayCtx = displayCanvas.getContext("2d");
        const processingCtx = processingCanvas.getContext("2d");

        if (displayCtx && processingCtx) {
          const hasValidVideoFrame =
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0;

          const now = performance.now();
          const dueForSnapshot =
            lastSnapshotAtRef.current === 0 ||
            (now - lastSnapshotAtRef.current) >= SNAPSHOT_INTERVAL_MS;
          const shouldProcessFrame = hasValidVideoFrame && dueForSnapshot;

          if (shouldProcessFrame) {
            const startTimeMs = performance.now();

            if (landmarker) {
              try {
                const results = withSuppressedMediapipeLogsSync(() =>
                  landmarker.detectForVideo(video, startTimeMs)
                );
                const modelLandmarks =
                  results.landmarks && results.landmarks.length > 0
                    ? results.landmarks[0]
                    : null;

                latestLandmarksRef.current = modelLandmarks
                  ? modelLandmarks.map((p) => ({ x: p.x, y: p.y }))
                  : null;

                if (modelLandmarks && modelLandmarks[11] && modelLandmarks[12]) {
                  const rawShoulderCenter =
                    (modelLandmarks[11].x + modelLandmarks[12].x) / 2;
                  const rawShoulderY =
                    (modelLandmarks[11].y + modelLandmarks[12].y) / 2;
                  const rawShoulderWidth = Math.max(
                    0.08,
                    Math.abs(modelLandmarks[12].x - modelLandmarks[11].x)
                  );

                  modelShoulderCenterNormRef.current = modelShoulderCenterNormRef.current !== null
                    ? lerp(modelShoulderCenterNormRef.current, rawShoulderCenter, LANDMARK_SMOOTHING)
                    : rawShoulderCenter;
                  modelShoulderYNormRef.current = modelShoulderYNormRef.current !== null
                    ? lerp(modelShoulderYNormRef.current, rawShoulderY, LANDMARK_SMOOTHING)
                    : rawShoulderY;
                  modelShoulderWidthNormRef.current = lerp(
                    modelShoulderWidthNormRef.current,
                    rawShoulderWidth,
                    LANDMARK_SMOOTHING
                  );

                  const nose = modelLandmarks[0];
                  const mouthLeft = modelLandmarks[9];
                  const mouthRight = modelLandmarks[10];
                  const faceBottomY = (() => {
                    const candidates: number[] = [];
                    if (typeof nose?.y === "number") candidates.push(nose.y);
                    if (typeof mouthLeft?.y === "number") candidates.push(mouthLeft.y);
                    if (typeof mouthRight?.y === "number") candidates.push(mouthRight.y);
                    if (candidates.length === 0) {
                      return (
                        modelShoulderYNormRef.current -
                        modelShoulderWidthNormRef.current * 0.28
                      );
                    }
                    return Math.max(...candidates);
                  })();

                  const rawNeckY = faceBottomY + modelShoulderWidthNormRef.current * 0.14;
                  const minNeckY = faceBottomY + modelShoulderWidthNormRef.current * 0.08;
                  const maxNeckY = modelShoulderYNormRef.current - modelShoulderWidthNormRef.current * 0.07;
                  const neckY = Math.min(Math.max(rawNeckY, minNeckY), maxNeckY);

                  const rawNeckX = modelShoulderCenterNormRef.current;
                  const rawNeckYClamped = Math.max(0, neckY);

                  if (modelNeckNormRef.current) {
                    modelNeckNormRef.current = {
                      x: lerp(modelNeckNormRef.current.x, rawNeckX, LANDMARK_SMOOTHING),
                      y: lerp(modelNeckNormRef.current.y, rawNeckYClamped, LANDMARK_SMOOTHING)
                    };
                  } else {
                    modelNeckNormRef.current = {
                      x: rawNeckX,
                      y: rawNeckYClamped
                    };
                  }

                  if (modelLandmarks[7]) {
                    const rawLeft = { x: modelLandmarks[7].x, y: modelLandmarks[7].y };
                    modelLeftEarNormRef.current = modelLeftEarNormRef.current
                      ? {
                        x: lerp(modelLeftEarNormRef.current.x, rawLeft.x, LANDMARK_SMOOTHING),
                        y: lerp(modelLeftEarNormRef.current.y, rawLeft.y, LANDMARK_SMOOTHING)
                      }
                      : rawLeft;
                  } else {
                    modelLeftEarNormRef.current = null;
                  }

                  if (modelLandmarks[8]) {
                    const rawRight = { x: modelLandmarks[8].x, y: modelLandmarks[8].y };
                    modelRightEarNormRef.current = modelRightEarNormRef.current
                      ? {
                        x: lerp(modelRightEarNormRef.current.x, rawRight.x, LANDMARK_SMOOTHING),
                        y: lerp(modelRightEarNormRef.current.y, rawRight.y, LANDMARK_SMOOTHING)
                      }
                      : rawRight;
                  } else {
                    modelRightEarNormRef.current = null;
                  }
                } else {
                  modelShoulderCenterNormRef.current = null;
                  modelShoulderYNormRef.current = null;
                  modelNeckNormRef.current = null;
                  modelLeftEarNormRef.current = null;
                  modelRightEarNormRef.current = null;
                }

                const segmentationMask =
                  results.segmentationMasks && results.segmentationMasks.length > 0
                    ? results.segmentationMasks[0]
                    : null;

                if (segmentationMask) {
                  latestSegmentationRef.current = {
                    data: segmentationMask.getAsFloat32Array(),
                    width: segmentationMask.width,
                    height: segmentationMask.height
                  };
                  segmentationMask.close();
                } else {
                  latestSegmentationRef.current = null;
                }
              } catch (err) {
                modelShoulderCenterNormRef.current = null;
                modelShoulderYNormRef.current = null;
                modelNeckNormRef.current = null;
                modelLeftEarNormRef.current = null;
                modelRightEarNormRef.current = null;
                latestLandmarksRef.current = null;
                latestSegmentationRef.current = null;
                console.warn("Pose tracking frame failed", err);
              }
            }

            // Snapshot-only output: redraw only when the interval capture is due.
            processingCtx.clearRect(0, 0, targetW, targetH);
            processingCtx.drawImage(video, 0, 0, targetW, targetH);
            const segmentationFrame = latestSegmentationRef.current;

            if (garmentImageRef.current) {
              if (accessoryType === "garment") {
                if (segmentationFrame) {
                  compositeGarmentIntoBody(
                    processingCtx,
                    segmentationFrame,
                    garmentImageRef.current,
                    targetW,
                    targetH,
                    modelShoulderCenterNormRef.current,
                    modelShoulderYNormRef.current
                  );
                }
              } else if (accessoryType === "necklace") {
                compositeNecklaceIntoNeck(
                  processingCtx,
                  garmentImageRef.current,
                  targetW,
                  targetH,
                  modelNeckNormRef.current,
                  modelShoulderWidthNormRef.current,
                  modelShoulderCenterNormRef.current,
                  modelShoulderYNormRef.current
                );
              } else {
                compositeEarrings(
                  processingCtx,
                  garmentImageRef.current,
                  targetW,
                  targetH,
                  modelLeftEarNormRef.current,
                  modelRightEarNormRef.current,
                  modelShoulderWidthNormRef.current
                );
              }
            }

            if (showDebugOverlay) {
              drawDebugOutlines(processingCtx, targetW, targetH, latestLandmarksRef.current);
            }

            // Atomically present processed snapshot; previous frame stays visible until now.
            displayCtx.drawImage(processingCanvas, 0, 0, targetW, targetH);

            lastSnapshotAtRef.current = now;
            setHasSnapshot(true);
            setStatusText("Snapshot auto-updates every 1 second.");
          }
        }
      }

      if (isActive) {
        requestRef.current = requestAnimationFrame(predictLoop);
      }
    }

    if (isActive) {
      requestRef.current = requestAnimationFrame(predictLoop);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isActive, accessoryType, showDebugOverlay]);

  if (!isWindowOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100dvw",
        height: "100dvh",
        overflow: "hidden",
        pointerEvents: "auto",
        zIndex: 9999
      }}
    >
      {isWindowOpen && isWindowMinimized && (
        <button
          onClick={() => setIsWindowMinimized(false)}
          style={{
            position: "absolute",
            right: "10px",
            bottom: "10px",
            zIndex: 40,
            border: "1px solid rgba(148, 163, 184, 0.5)",
            background: "rgba(2, 6, 23, 0.9)",
            color: "#e2e8f0",
            borderRadius: "6px",
            padding: "8px 12px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer"
          }}
        >
          Try-On
        </button>
      )}
      <div
        style={{
          position: "absolute",
          left: isWindowMaximized ? 0 : "50%",
          top: isWindowMaximized ? 0 : "50%",
          transform: isWindowMaximized ? "none" : "translate(-50%, -50%)",
          width: isWindowMaximized ? "100dvw" : "min(92dvw, 1200px)",
          height: isWindowMaximized ? "100dvh" : "min(88dvh, 760px)",
          background: "#000",
          borderRadius: isWindowMaximized ? "0" : "10px",
          border: isWindowMaximized ? "none" : "1px solid rgba(100, 116, 139, 0.55)",
          boxShadow: isWindowMaximized ? "none" : "0 20px 60px rgba(2,6,23,0.65)",
          overflow: "hidden",
          display: isWindowOpen && !isWindowMinimized && (isActive || hasSnapshot) ? "block" : "none",
          pointerEvents: "auto"
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "32px",
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 8px 0 10px",
            background: "rgba(15, 23, 42, 0.92)",
            borderBottom: "1px solid rgba(148, 163, 184, 0.4)"
          }}
        >
          <span style={{ color: "#cbd5e1", fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Try-On
          </span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={() => setIsWindowMinimized(true)}
              title="Minimize"
              style={{
                width: "32px",
                height: "24px",
                border: "none",
                background: "#334155",
                color: "#e2e8f0",
                borderRadius: "0",
                fontSize: "13px",
                fontWeight: 800,
                lineHeight: 1,
                cursor: "pointer"
              }}
            >
              −
            </button>
            <button
              onClick={() => setIsWindowMaximized((prev) => !prev)}
              title={isWindowMaximized ? "Restore" : "Maximize"}
              style={{
                width: "32px",
                height: "24px",
                border: "none",
                background: "#334155",
                color: "#e2e8f0",
                borderRadius: "0",
                fontSize: "12px",
                fontWeight: 800,
                lineHeight: 1,
                cursor: "pointer"
              }}
            >
              □
            </button>
            <button
              onClick={() => {
                closeTryOn();
              }}
              title="Close"
              style={{
                width: "32px",
                height: "24px",
                border: "none",
                background: "#b91c1c",
                color: "#fee2e2",
                borderRadius: "0",
                fontSize: "13px",
                fontWeight: 800,
                lineHeight: 1,
                cursor: "pointer"
              }}
            >
              ×
            </button>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            top: "44px",
            left: "10px",
            background: "rgba(0,0,0,0.75)",
            padding: "8px 12px",
            borderRadius: "4px",
            color: "white",
            fontFamily: "monospace",
            fontSize: "13px",
            zIndex: 10,
            textAlign: "left",
            pointerEvents: "none",
            lineHeight: "1.4"
          }}
        >
          <strong>Snapshot Pixel Compositing</strong>
          <br />
          <span style={{ fontSize: "11px", color: "#cbd5e1" }}>
            A new camera snapshot is captured every 1s and composited before display.
          </span>
          <br />
          <span style={{ color: "#9ca3af", fontSize: "11px" }}>
            Mode: {accessoryType}
          </span>
          <br />
          <span style={{ color: "#aaa", fontSize: "11px" }}>
            S: Take Screenshot
          </span>
          <br />
          <span style={{ color: "#aaa", fontSize: "11px" }}>
            +/-: Resize, U/J: Up/Down, H/K: Left/Right
          </span>
        </div>

        <div
          style={{
            position: "absolute",
            top: "44px",
            right: "10px",
            background: "rgba(0,0,0,0.72)",
            padding: "8px",
            borderRadius: "8px",
            zIndex: 11,
            pointerEvents: "auto",
            display: "flex",
            gap: "6px",
            alignItems: "center",
            flexWrap: "wrap",
            maxWidth: "280px"
          }}
        >
          <label style={{ color: "#e2e8f0", fontSize: "10px", fontWeight: 800, textTransform: "uppercase" }}>Type</label>
          <select
            value={accessoryType}
            onChange={(e) => setAccessoryType(e.target.value as AccessoryType)}
            style={{
              padding: "6px 8px",
              borderRadius: "6px",
              background: "#0b1220",
              color: "#e2e8f0",
              border: "1px solid rgba(148, 163, 184, 0.45)",
              fontSize: "12px",
              fontWeight: 700
            }}
          >
            <option value="garment">Garment</option>
            <option value="necklace">Necklace</option>
            <option value="earrings">Earrings</option>
          </select>
          <button onClick={() => adjustScale(0.03)} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>+</button>
          <button onClick={() => adjustScale(-0.03)} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>-</button>
          <button onClick={() => adjustOffsetY(-4)} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>U</button>
          <button onClick={() => adjustOffsetY(4)} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>J</button>
          <button onClick={() => adjustOffsetX(-4)} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>H</button>
          <button onClick={() => adjustOffsetX(4)} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>K</button>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#e2e8f0", fontSize: "11px", fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={showDebugOverlay}
              onChange={(e) => setShowDebugOverlay(e.target.checked)}
            />
            Debug
          </label>
        </div>

        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
            zIndex: 1,
            visibility: "hidden"
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
            zIndex: 2,
            visibility: "visible"
          }}
        />

      </div>
      {!isActive && isWindowOpen && !isWindowMinimized && (
        <p
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "14px",
            color: "#cbd5e1",
            background: "rgba(2, 6, 23, 0.7)",
            padding: "8px 12px",
            borderRadius: "8px",
            margin: 0,
            zIndex: 15
          }}
        >
          {statusText}
        </p>
      )}

      {showTouchKeyboard && isWindowOpen && !isWindowMinimized && isWindowMaximized && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            maxHeight: "42dvh",
            overflowY: "auto",
            background: "#0f172a",
            color: "#e2e8f0",
            borderRadius: "0",
            padding: "10px",
            borderTop: "1px solid rgba(148, 163, 184, 0.35)",
            zIndex: 20
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 700, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Controls
          </div>
          <div style={{ marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", color: "#cbd5e1" }}>Type</label>
            <select
              value={accessoryType}
              onChange={(e) => setAccessoryType(e.target.value as AccessoryType)}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "8px",
                background: "#0b1220",
                color: "#e2e8f0",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                fontSize: "12px",
                fontWeight: 700
              }}
            >
              <option value="garment">Garment</option>
              <option value="necklace">Necklace</option>
              <option value="earrings">Earrings</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", color: "#e2e8f0", fontSize: "12px", fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={showDebugOverlay}
              onChange={(e) => setShowDebugOverlay(e.target.checked)}
            />
            Show Debug Outlines
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "8px"
            }}
          >
            <button onClick={() => adjustScale(0.03)} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>+ Bigger</button>
            <button onClick={() => adjustScale(-0.03)} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>- Smaller</button>
            <button onClick={() => adjustOffsetY(-4)} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>U Move Up</button>
            <button onClick={() => adjustOffsetY(4)} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>J Move Down</button>
            <button onClick={() => adjustOffsetX(-4)} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>H Move Left</button>
            <button onClick={() => adjustOffsetX(4)} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>K Move Right</button>
            <button onClick={saveScreenshot} style={{ padding: "10px", borderRadius: "8px", background: "#0ea5e9", color: "#082f49", border: "1px solid #38bdf8", fontWeight: 800 }}>Save Screenshot (S)</button>
          </div>
        </div>
      )}
    </div>
  );
}