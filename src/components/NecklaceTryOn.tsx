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

type AccessoryType = "garment" | "necklace" | "earrings";

interface BodyVisualizerProps {
  selectedImageSrc?: string | null;
}

type SegmentationFrame = {
  data: Float32Array;
  width: number;
  height: number;
};

export default function BodyVisualizer({ selectedImageSrc }: BodyVisualizerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const requestRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestSegmentationRef = useRef<SegmentationFrame | null>(null);
  const garmentImageRef = useRef<HTMLImageElement | null>(null);
  const garmentLayerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const garmentShoulderCenterNormRef = useRef<number>(0.5);
  const garmentShoulderYNormRef = useRef<number>(0.08);
  const necklaceAnchorXNormRef = useRef<number>(0.5);
  const necklaceAnchorYNormRef = useRef<number>(0.08);
  const modelShoulderCenterNormRef = useRef<number | null>(null);
  const modelShoulderYNormRef = useRef<number | null>(null);
  const modelShoulderWidthNormRef = useRef<number>(0.25);
  const modelNeckNormRef = useRef<{ x: number; y: number } | null>(null);
  const modelLeftEarNormRef = useRef<{ x: number; y: number } | null>(null);
  const modelRightEarNormRef = useRef<{ x: number; y: number } | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState("Loading tracking models...");
  const [showTouchKeyboard, setShowTouchKeyboard] = useState(false);
  const [accessoryType, setAccessoryType] = useState<AccessoryType>("garment");
  const [manualScale, setManualScale] = useState(1);
  const [manualOffsetY, setManualOffsetY] = useState(0);
  const [manualOffsetX, setManualOffsetX] = useState(0);

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
    garmentShoulderCenterNormRef.current = 0.5;
    garmentShoulderYNormRef.current = 0.08;
    necklaceAnchorXNormRef.current = 0.5;
    necklaceAnchorYNormRef.current = 0.08;

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
    let lastVideoTime = -1;

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
      shoulderWidthNorm: number
    ) => {
      if (!neckNorm) return;

      const neckX = neckNorm.x * targetWidth;
      const neckY = neckNorm.y * targetHeight;
      const shoulderWidthPx = Math.max(40, shoulderWidthNorm * targetWidth);

      const adjustedBaseW = shoulderWidthPx * 0.98 * manualScaleRef.current;
      const drawW = Math.max(44, Math.min(targetWidth * 0.9, adjustedBaseW));
      const drawH = drawW * (garmentImage.naturalHeight / Math.max(1, garmentImage.naturalWidth));
      const drawX = neckX - necklaceAnchorXNormRef.current * drawW + manualOffsetXRef.current;
      const drawY = neckY - necklaceAnchorYNormRef.current * drawH + shoulderWidthPx * 0.012 + manualOffsetYRef.current;

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

      const cameraBefore = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const composed = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const necklaceData = necklaceCtx.getImageData(0, 0, targetWidth, targetHeight).data;

      // Hard pixel replacement (no overlay blending): necklace pixels replace camera pixels.
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const idx = (y * targetWidth + x) * 4;
          const alpha = necklaceData[idx + 3];
          if (alpha <= GARMENT_ALPHA_THRESHOLD) continue;

          const camR = cameraBefore.data[idx];
          const camG = cameraBefore.data[idx + 1];
          const camB = cameraBefore.data[idx + 2];
          const camLuma = (0.2126 * camR + 0.7152 * camG + 0.0722 * camB) / 255;
          const lightingScale = 0.75 + camLuma * 0.55;

          const neckR = Math.max(0, Math.min(255, Math.round(necklaceData[idx] * lightingScale)));
          const neckG = Math.max(0, Math.min(255, Math.round(necklaceData[idx + 1] * lightingScale)));
          const neckB = Math.max(0, Math.min(255, Math.round(necklaceData[idx + 2] * lightingScale)));

          composed.data[idx] = neckR;
          composed.data[idx + 1] = neckG;
          composed.data[idx + 2] = neckB;
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

    function predictLoop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = poseLandmarkerRef.current;

      if (video && canvas) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const hasValidVideoFrame =
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0;

          const shouldProcessFrame = hasValidVideoFrame && video.currentTime !== lastVideoTime;

          if (shouldProcessFrame) {
            lastVideoTime = video.currentTime;
            const startTimeMs = performance.now();

            if (landmarker) {
              try {
                const results = landmarker.detectForVideo(video, startTimeMs);
                const modelLandmarks = results.landmarks && results.landmarks.length > 0
                  ? results.landmarks[0]
                  : null;
                if (modelLandmarks && modelLandmarks[11] && modelLandmarks[12]) {
                  modelShoulderCenterNormRef.current = (modelLandmarks[11].x + modelLandmarks[12].x) / 2;
                  modelShoulderYNormRef.current = (modelLandmarks[11].y + modelLandmarks[12].y) / 2;
                  modelShoulderWidthNormRef.current = Math.max(0.08, Math.abs(modelLandmarks[12].x - modelLandmarks[11].x));

                  const nose = modelLandmarks[0];
                  const mouthLeft = modelLandmarks[9];
                  const mouthRight = modelLandmarks[10];
                  const faceBottomY = (() => {
                    const candidates: number[] = [];
                    if (typeof nose?.y === "number") candidates.push(nose.y);
                    if (typeof mouthLeft?.y === "number") candidates.push(mouthLeft.y);
                    if (typeof mouthRight?.y === "number") candidates.push(mouthRight.y);
                    if (candidates.length === 0) {
                      return modelShoulderYNormRef.current - modelShoulderWidthNormRef.current * 0.28;
                    }
                    return Math.max(...candidates);
                  })();

                  // Keep neck immediately below face, but never as low as shoulder line.
                  const rawNeckY = faceBottomY + modelShoulderWidthNormRef.current * 0.14;
                  const minNeckY = faceBottomY + modelShoulderWidthNormRef.current * 0.08;
                  const maxNeckY = modelShoulderYNormRef.current - modelShoulderWidthNormRef.current * 0.07;
                  const neckY = Math.min(Math.max(rawNeckY, minNeckY), maxNeckY);

                  const neckX = modelShoulderCenterNormRef.current;

                  modelNeckNormRef.current = {
                    x: neckX,
                    y: Math.max(0, neckY)
                  };
                  modelLeftEarNormRef.current = modelLandmarks[7]
                    ? { x: modelLandmarks[7].x, y: modelLandmarks[7].y }
                    : null;
                  modelRightEarNormRef.current = modelLandmarks[8]
                    ? { x: modelLandmarks[8].x, y: modelLandmarks[8].y }
                    : null;
                } else {
                  modelShoulderCenterNormRef.current = null;
                  modelShoulderYNormRef.current = null;
                  modelNeckNormRef.current = null;
                  modelLeftEarNormRef.current = null;
                  modelRightEarNormRef.current = null;
                }

                const segmentationMask = results.segmentationMasks && results.segmentationMasks.length > 0
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
                latestSegmentationRef.current = null;
                console.warn("Pose tracking frame failed", err);
              }
            }
          }

          // Base frame: render camera first, then replace body pixels with garment pixels.
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const segmentationFrame = latestSegmentationRef.current;

          if (garmentImageRef.current) {
            if (accessoryType === "garment") {
              if (segmentationFrame) {
                compositeGarmentIntoBody(
                  ctx,
                  segmentationFrame,
                  garmentImageRef.current,
                  canvas.width,
                  canvas.height,
                  modelShoulderCenterNormRef.current,
                  modelShoulderYNormRef.current
                );
              }
            } else if (accessoryType === "necklace") {
              compositeNecklaceIntoNeck(
                ctx,
                garmentImageRef.current,
                canvas.width,
                canvas.height,
                modelNeckNormRef.current,
                modelShoulderWidthNormRef.current
              );
            } else {
              compositeEarrings(
                ctx,
                garmentImageRef.current,
                canvas.width,
                canvas.height,
                modelLeftEarNormRef.current,
                modelRightEarNormRef.current,
                modelShoulderWidthNormRef.current
              );
            }
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
  }, [isActive, accessoryType]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "15px" }}>
      <div
        style={{
          position: "relative",
          width: "640px",
          height: "480px",
          background: "#000",
          borderRadius: "8px",
          overflow: "hidden",
          display: isActive ? "block" : "none"
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "10px",
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
          <strong>Live Garment Pixel Compositing</strong>
          <br />
          <span style={{ fontSize: "11px", color: "#cbd5e1" }}>
            Body pixels are replaced with garment image pixels before display.
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
            top: "10px",
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
        </div>

        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{
            position: "absolute",
            width: "640px",
            height: "480px",
            transform: "scaleX(-1)",
            zIndex: 1
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            width: "640px",
            height: "480px",
            transform: "scaleX(-1)",
            zIndex: 2
          }}
        />

      </div>
      {!isActive && <p style={{ fontSize: "14px", color: "#888" }}>{statusText}</p>}

      {showTouchKeyboard && (
        <div
          style={{
            width: "min(100%, 640px)",
            background: "#0f172a",
            color: "#e2e8f0",
            borderRadius: "10px",
            padding: "10px",
            border: "1px solid rgba(148, 163, 184, 0.35)"
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