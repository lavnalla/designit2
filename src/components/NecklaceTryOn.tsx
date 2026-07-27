import React, { useCallback, useEffect, useRef, useState } from "react";
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
const SNAPSHOT_INTERVAL_MS = 100;
const LANDMARK_SMOOTHING = 0.8;
const NECK_SHOULDER_JOINT_BLEND = 0.9;
const SHOULDER_FAR_WIDTH_NORM = 0.14;
const SHOULDER_NEAR_WIDTH_NORM = 0.24;
const MANUAL_SCALE_STEP = 0.03;
const MANUAL_MOVE_STEP_PX = 6;

type AccessoryType = "garment" | "necklace" | "earrings";

interface BodyVisualizerProps {
  selectedImageSrc?: string | null;
}

type SegmentationFrame = {
  data: Float32Array;
  width: number;
  height: number;
};

interface OriginalGarmentMetrics {
  shoulderCenterNorm: number;
  shoulderYNorm: number;
  leftShoulderNorm: { x: number; y: number };
  rightShoulderNorm: { x: number; y: number };
  leftArmTipNorm: { x: number; y: number };
  rightArmTipNorm: { x: number; y: number };
  torsoCenterNorm: number;
  torsoYNorm: number;
  necklaceAnchorXNorm: number;
  necklaceAnchorYNorm: number;
  necklaceCenterXNorm: number;
  necklaceCenterYNorm: number;
}

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

  const originalGarmentMetricsRef = useRef<OriginalGarmentMetrics | null>(null);

  const modelShoulderCenterNormRef = useRef<number | null>(null);
  const modelShoulderYNormRef = useRef<number | null>(null);
  const modelShoulderWidthNormRef = useRef<number>(0.25);
  const modelNeckNormRef = useRef<{ x: number; y: number } | null>(null);
  const modelNeckShoulderJointNormRef = useRef<{ x: number; y: number } | null>(null);
  const modelFaceBottomNormRef = useRef<number | null>(null);
  const modelFaceBoundsNormRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const modelLeftEarNormRef = useRef<{ x: number; y: number } | null>(null);
  const modelRightEarNormRef = useRef<{ x: number; y: number } | null>(null);
  const latestLandmarksRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const lastGoodLandmarksRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const isDetectionLockedByKeyboardRef = useRef(false);

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
  const showDebugOverlayRef = useRef(false);

  const lockDetectionFromKeyboard = useCallback(() => {
    if (isDetectionLockedByKeyboardRef.current) return;
    isDetectionLockedByKeyboardRef.current = true;
    setStatusText("Detection locked by keyboard input.");
  }, []);

  const unlockDetection = useCallback(() => {
    isDetectionLockedByKeyboardRef.current = false;
    setStatusText("Detection unlocked. Auto-tracking resumed.");
  }, []);

  const adjustScale = useCallback((delta: number) => {
    setManualScale((prev) => {
      const next = Math.max(0.6, Math.min(1.6, prev + delta));
      return Math.round(next * 1000) / 1000;
    });
  }, []);

  const adjustOffsetY = useCallback((delta: number) => {
    setManualOffsetY((prev) => Math.max(-120, Math.min(120, prev + delta)));
  }, []);

  const adjustOffsetX = useCallback((delta: number) => {
    setManualOffsetX((prev) => Math.max(-120, Math.min(120, prev + delta)));
  }, []);

  const runManualAction = useCallback((action: "scaleUp" | "scaleDown" | "moveUp" | "moveDown" | "moveLeft" | "moveRight", source: "keyboard" | "button") => {
    if (source === "keyboard") {
      lockDetectionFromKeyboard();
    }

    if (action === "scaleUp") {
      adjustScale(MANUAL_SCALE_STEP);
      return;
    }

    if (action === "scaleDown") {
      adjustScale(-MANUAL_SCALE_STEP);
      return;
    }

    if (action === "moveUp") {
      adjustOffsetY(-MANUAL_MOVE_STEP_PX);
      return;
    }

    if (action === "moveDown") {
      adjustOffsetY(MANUAL_MOVE_STEP_PX);
      return;
    }

    if (action === "moveLeft") {
      adjustOffsetX(-MANUAL_MOVE_STEP_PX);
      return;
    }

    adjustOffsetX(MANUAL_MOVE_STEP_PX);
  }, [adjustOffsetX, adjustOffsetY, adjustScale, lockDetectionFromKeyboard]);

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
    showDebugOverlayRef.current = showDebugOverlay;
  }, [showDebugOverlay]);

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

      const code = event.code;

      if (code === "Equal" || code === "NumpadAdd") {
        event.preventDefault();
        runManualAction("scaleUp", "keyboard");
        return;
      }

      if (code === "Minus" || code === "NumpadSubtract") {
        event.preventDefault();
        runManualAction("scaleDown", "keyboard");
        return;
      }

      if (code === "KeyU" || code === "ArrowUp") {
        event.preventDefault();
        runManualAction("moveUp", "keyboard");
        return;
      }

      if (code === "KeyJ" || code === "ArrowDown") {
        event.preventDefault();
        runManualAction("moveDown", "keyboard");
        return;
      }

      if (code === "KeyH" || code === "ArrowLeft") {
        event.preventDefault();
        runManualAction("moveLeft", "keyboard");
        return;
      }

      if (code === "KeyK" || code === "ArrowRight") {
        event.preventDefault();
        runManualAction("moveRight", "keyboard");
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [runManualAction]);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 900px)");
    const sync = () => setShowTouchKeyboard(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    garmentImageRef.current = null;
    originalGarmentMetricsRef.current = null;
    lastSnapshotAtRef.current = 0;
    isDetectionLockedByKeyboardRef.current = false;
    setHasSnapshot(false);
    setManualScale(1);
    setManualOffsetY(0);
    setManualOffsetX(0);

    modelShoulderCenterNormRef.current = null;
    modelShoulderYNormRef.current = null;
    modelNeckNormRef.current = null;
    modelNeckShoulderJointNormRef.current = null;
    latestLandmarksRef.current = null;
    lastGoodLandmarksRef.current = null;

    if (!selectedImageSrc) {
      return;
    }

    const img = new window.Image();
    if (!selectedImageSrc.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      garmentImageRef.current = img;

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

        const topBandStart = Math.max(0, topY >= 0 ? topY : 0);
        const topBandEnd = Math.max(topBandStart + 1, Math.floor(measureCanvas.height * 0.25));
        
        const shoulderZoneStart = Math.floor(measureCanvas.height * 0.12);
        const shoulderZoneEnd = Math.floor(measureCanvas.height * 0.42);

        const torsoBandStart = Math.max(shoulderZoneEnd, Math.floor(measureCanvas.height * 0.35));
        const torsoBandEnd = Math.max(torsoBandStart + 1, Math.floor(measureCanvas.height * 0.88));

        let bestWidth = -1;
        let bestCenter = measureCanvas.width / 2;
        let bestRowY = topBandStart;

        let widestShoulderSpan = -1;
        let bestLeftX = measureCanvas.width * 0.3;
        let bestRightX = measureCanvas.width * 0.7;
        let bestShoulderY = shoulderZoneStart;

        for (let y = shoulderZoneStart; y <= shoulderZoneEnd; y++) {
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
            const span = rowRight - rowLeft;
            const score = span * (1.0 - (y - shoulderZoneStart) / (shoulderZoneEnd - shoulderZoneStart || 1) * 0.25);
            if (score > widestShoulderSpan) {
              widestShoulderSpan = score;
              bestLeftX = rowLeft;
              bestRightX = rowRight;
              bestShoulderY = y;
            }
          }
        }

        const tempLeftShoulderNorm = {
          x: Math.max(0, Math.min(1, bestLeftX / Math.max(1, measureCanvas.width - 1))),
          y: Math.max(0, Math.min(1, bestShoulderY / Math.max(1, measureCanvas.height - 1)))
        };
        const tempRightShoulderNorm = {
          x: Math.max(0, Math.min(1, bestRightX / Math.max(1, measureCanvas.width - 1))),
          y: Math.max(0, Math.min(1, bestShoulderY / Math.max(1, measureCanvas.height - 1)))
        };

        const computedGarmentShoulderCenterX = (bestLeftX + bestRightX) / 2;
        const tempShoulderCenterNorm = Math.max(0, Math.min(1, computedGarmentShoulderCenterX / Math.max(1, measureCanvas.width - 1)));
        const tempShoulderYNorm = Math.max(0, Math.min(1, bestShoulderY / Math.max(1, measureCanvas.height - 1)));

        let leftArmMinX = bestLeftX;
        let leftArmTipY = bestShoulderY;
        let rightArmMaxX = bestRightX;
        let rightArmTipY = bestShoulderY;

        for (let y = bestShoulderY; y < Math.floor(measureCanvas.height * 0.7); y++) {
          for (let x = 0; x < measureCanvas.width; x++) {
            const alpha = imageData.data[(y * measureCanvas.width + x) * 4 + 3];
            if (alpha > GARMENT_ALPHA_THRESHOLD) {
              if (x < leftArmMinX) {
                leftArmMinX = x;
                leftArmTipY = y;
              }
              if (x > rightArmMaxX) {
                rightArmMaxX = x;
                rightArmTipY = y;
              }
            }
          }
        }

        const tempLeftArmTipNorm = {
          x: Math.max(0, Math.min(1, leftArmMinX / Math.max(1, measureCanvas.width - 1))),
          y: Math.max(0, Math.min(1, leftArmTipY / Math.max(1, measureCanvas.height - 1)))
        };
        const tempRightArmTipNorm = {
          x: Math.max(0, Math.min(1, rightArmMaxX / Math.max(1, measureCanvas.width - 1))),
          y: Math.max(0, Math.min(1, rightArmTipY / Math.max(1, measureCanvas.height - 1)))
        };

        for (let y = topBandStart; y < topBandEnd; y++) {
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

        let torsoBestWidth = -1;
        let torsoBestCenter = measureCanvas.width / 2;
        let torsoBestRowY = 0;

        for (let y = torsoBandStart; y < torsoBandEnd; y++) {
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
            if (rowWidth > torsoBestWidth) {
              torsoBestWidth = rowWidth;
              torsoBestCenter = (rowLeft + rowRight) / 2;
              torsoBestRowY = y;
            }
          }
        }

        const tempTorsoCenterNorm = Math.max(0, Math.min(1, torsoBestCenter / Math.max(1, measureCanvas.width - 1)));
        const tempTorsoYNorm = Math.max(0, Math.min(1, torsoBestRowY / Math.max(1, measureCanvas.height - 1)));

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

        let tempNecklaceCenterXNorm = 0.5;
        let tempNecklaceCenterYNorm = 0.5;
        if (maxX >= minX && maxY >= minY) {
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          tempNecklaceCenterXNorm = Math.max(0, Math.min(1, cx / Math.max(1, measureCanvas.width - 1)));
          tempNecklaceCenterYNorm = Math.max(0, Math.min(1, cy / Math.max(1, measureCanvas.height - 1)));
        }

        let tempNecklaceAnchorXNorm = tempShoulderCenterNorm;
        let tempNecklaceAnchorYNorm = Math.max(0, tempShoulderYNorm * 0.45);

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
            tempNecklaceAnchorXNorm = Math.max(0, Math.min(1, necklaceCenter / Math.max(1, measureCanvas.width - 1)));
            tempNecklaceAnchorYNorm = Math.max(0, Math.min(1, topY / Math.max(1, measureCanvas.height - 1)));
          }
        }

        originalGarmentMetricsRef.current = {
          shoulderCenterNorm: tempShoulderCenterNorm,
          shoulderYNorm: tempShoulderYNorm,
          leftShoulderNorm: tempLeftShoulderNorm,
          rightShoulderNorm: tempRightShoulderNorm,
          leftArmTipNorm: tempLeftArmTipNorm,
          rightArmTipNorm: tempRightArmTipNorm,
          torsoCenterNorm: tempTorsoCenterNorm,
          torsoYNorm: tempTorsoYNorm,
          necklaceAnchorXNorm: tempNecklaceAnchorXNorm,
          necklaceAnchorYNorm: tempNecklaceAnchorYNorm,
          necklaceCenterXNorm: tempNecklaceCenterXNorm,
          necklaceCenterYNorm: tempNecklaceCenterYNorm,
        };

      } catch (measureError) {
        console.warn("Original garment measurement failed", measureError);
      }
    };
    img.onerror = () => {
      garmentImageRef.current = null;
      originalGarmentMetricsRef.current = null;
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
      modelShoulderYNorm: number | null,
      faceBottomNorm: number | null,
      faceBoundsNorm: { left: number; top: number; right: number; bottom: number } | null,
      landmarks: Array<{ x: number; y: number }> | null
    ) => {
      const metrics = originalGarmentMetricsRef.current;
      if (!metrics) return;

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

      const naturalAspect = garmentImage.naturalHeight / Math.max(1, garmentImage.naturalWidth);
      const garmentDrawW = Math.max(1, Math.round(bodyW * manualScaleRef.current));
      const garmentDrawH = Math.max(1, Math.round(garmentDrawW * naturalAspect));

      const faceBottomY = faceBottomNorm !== null ? faceBottomNorm * targetHeight : null;
      const faceClearanceY = faceBottomY !== null
        ? faceBottomY + Math.max(10, Math.round(garmentDrawH * 0.05))
        : null;
      const faceBounds = faceBoundsNorm !== null
        ? {
          left: Math.max(0, Math.floor(faceBoundsNorm.left * targetWidth)),
          top: Math.max(0, Math.floor(faceBoundsNorm.top * targetHeight)),
          right: Math.min(targetWidth - 1, Math.ceil(faceBoundsNorm.right * targetWidth)),
          bottom: Math.min(targetHeight - 1, Math.ceil(faceBoundsNorm.bottom * targetHeight))
        }
        : null;

      const unclampedDrawX = Math.round(
        modelShoulderCenterX - (metrics.shoulderCenterNorm * garmentDrawW) + manualOffsetXRef.current
      );
      
      const baseDrawY = Math.round(
        modelShoulderY - (metrics.shoulderYNorm * garmentDrawH) + manualOffsetYRef.current
      );

      const unclampedDrawY = faceClearanceY !== null
        ? Math.min(baseDrawY, faceClearanceY)
        : baseDrawY;
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

      const modelHipY = landmarks && landmarks[23] && landmarks[24] 
        ? ((landmarks[23].y + landmarks[24].y) / 2) * targetHeight 
        : bodyY + bodyH * 0.85;

      for (let y = 0; y < targetHeight; y++) {
        const maskY = Math.min(frame.height - 1, Math.floor((y / targetHeight) * frame.height));
        const maskRow = maskY * frame.width;
        for (let x = 0; x < targetWidth; x++) {
          if (faceBounds && x >= faceBounds.left && x <= faceBounds.right && y >= faceBounds.top && y <= faceBounds.bottom) {
            continue;
          }
          if (faceBottomY !== null && y < faceBottomY) {
            continue;
          }

          const idx = (y * targetWidth + x) * 4;
          const maskVal = frame.data[maskRow + Math.min(frame.width - 1, Math.max(0, Math.floor((x / targetWidth) * frame.width)))];
          const isBodyPixel = maskVal > BODY_MASK_THRESHOLD;

          if (!isBodyPixel) {
            continue;
          }

          const garmentAlpha = garmentData[idx + 3];
          if (garmentAlpha > GARMENT_ALPHA_THRESHOLD) {
            cameraData[idx] = garmentData[idx];
            cameraData[idx + 1] = garmentData[idx + 1];
            cameraData[idx + 2] = garmentData[idx + 2];
            cameraData[idx + 3] = 255;
          }
        }
      }

      ctx.putImageData(cameraFrame, 0, 0);
    };

    const compositeNecklaceIntoNeck = (
      ctx: CanvasRenderingContext2D,
      garmentImage: HTMLImageElement,
      targetWidth: number,
      targetHeight: number,
      neckShoulderJointNorm: { x: number; y: number } | null,
      neckNorm: { x: number; y: number } | null,
      shoulderWidthNorm: number,
      shoulderCenterNorm: number | null,
      shoulderYNorm: number | null
    ) => {
      if (!neckNorm) return;
      const metrics = originalGarmentMetricsRef.current;
      if (!metrics) return;

      const centerXNorm = neckShoulderJointNorm?.x ?? shoulderCenterNorm ?? neckNorm.x;
      const neckX = centerXNorm * targetWidth;
      const centerYNorm = neckShoulderJointNorm?.y ?? shoulderYNorm ?? neckNorm.y;
      const shoulderWidthPx = Math.max(40, shoulderWidthNorm * targetWidth);
      const neckY = centerYNorm * targetHeight;

      const adjustedBaseW = shoulderWidthPx * 0.98 * manualScaleRef.current;
      const drawW = Math.max(44, Math.min(targetWidth * 0.9, adjustedBaseW));
      const drawH = drawW * (garmentImage.naturalHeight / Math.max(1, garmentImage.naturalWidth));
      const drawX = neckX - metrics.necklaceCenterXNorm * drawW + manualOffsetXRef.current;
      const necklaceJointYAnchorNorm =
        metrics.necklaceAnchorYNorm * 0.45 + metrics.necklaceCenterYNorm * 0.55;
      const drawY = neckY - necklaceJointYAnchorNorm * drawH + manualOffsetYRef.current;

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
      segmentation: SegmentationFrame | null,
      drawVisuals: boolean = true
    ) => {
      if (!segmentation) return;

      const data = segmentation.data;
      const width = segmentation.width;
      const height = segmentation.height;
      const metrics = originalGarmentMetricsRef.current;

      const shoulders = latestLandmarksRef.current;
      let targetShoulderYNorm = 0.25;

      if (shoulders && shoulders[11] && shoulders[12]) {
        const leftShoulderY = shoulders[11].y;
        const rightShoulderY = shoulders[12].y;
        targetShoulderYNorm = (leftShoulderY + rightShoulderY) / 2;
      }

      const shoulderYPixel = targetShoulderYNorm * height;
      const shoulderZoneTolerance = height * 0.12;

      let topmostRedYNorm = 1.0;
      const redPixels: Array<{ drawX: number; drawY: number }> = [];
      const greenPixels: Array<{ drawX: number; drawY: number }> = [];

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (data[idx] > BODY_MASK_THRESHOLD) {
            if (
              data[idx - 1] <= BODY_MASK_THRESHOLD || 
              data[idx + 1] <= BODY_MASK_THRESHOLD || 
              data[idx - width] <= BODY_MASK_THRESHOLD || 
              data[idx + width] <= BODY_MASK_THRESHOLD
            ) {
              const drawX = (x / width) * targetWidth;
              const drawY = (y / height) * targetHeight;

              if (Math.abs(y - shoulderYPixel) <= shoulderZoneTolerance) {
                redPixels.push({ drawX, drawY });
                const normY = y / height;
                if (normY < topmostRedYNorm) {
                  topmostRedYNorm = normY;
                }
              } else {
                greenPixels.push({ drawX, drawY });
              }
            }
          }
        }
      }

      if (topmostRedYNorm < 1.0) {
        modelShoulderYNormRef.current = modelShoulderYNormRef.current !== null
          ? lerp(modelShoulderYNormRef.current, topmostRedYNorm, LANDMARK_SMOOTHING)
          : topmostRedYNorm;
      }

      if (!drawVisuals) return;

      ctx.save();
      ctx.lineWidth = 3;

      for (const p of greenPixels) {
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(p.drawX, p.drawY, 2, 2);
      }

      for (const p of redPixels) {
        ctx.fillStyle = '#FF0000';
        ctx.fillRect(p.drawX, p.drawY, 2.5, 2.5);
      }

      const garmentImg = garmentImageRef.current;
      if (garmentImg && latestSegmentationRef.current && metrics) {
        const frame = latestSegmentationRef.current;
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

        if (maxMaskX >= minMaskX && maxMaskY >= minMaskY) {
          const bodyX = Math.max(0, Math.floor((minMaskX / frame.width) * targetWidth));
          const bodyY = Math.max(0, Math.floor((minMaskY / frame.height) * targetHeight));
          const bodyW = Math.max(1, Math.ceil(((maxMaskX - minMaskX + 1) / frame.width) * targetWidth));
          const bodyH = Math.max(1, Math.ceil(((maxMaskY - minMaskY + 1) / frame.height) * targetHeight));

          const modelShoulderCenterX = modelShoulderCenterNormRef.current !== null
            ? modelShoulderCenterNormRef.current * targetWidth
            : (bodyX + bodyW / 2);
          const modelShoulderY = modelShoulderYNormRef.current !== null
            ? modelShoulderYNormRef.current * targetHeight
            : bodyY;

          const naturalAspect = garmentImg.naturalHeight / Math.max(1, garmentImg.naturalWidth);
          const garmentDrawW = Math.max(1, Math.round(bodyW * manualScaleRef.current));
          const garmentDrawH = Math.max(1, Math.round(garmentDrawW * naturalAspect));

          const unclampedDrawX = Math.round(
            modelShoulderCenterX - (metrics.shoulderCenterNorm * garmentDrawW) + manualOffsetXRef.current
          );
          const baseDrawY = Math.round(
            modelShoulderY - (metrics.shoulderYNorm * garmentDrawH) + manualOffsetYRef.current
          );
          const garmentDrawX = Math.max(-garmentDrawW + 1, Math.min(targetWidth - 1, unclampedDrawX));
          const garmentDrawY = Math.max(-garmentDrawH + 1, Math.min(targetHeight - 1, baseDrawY));

          const tempC = document.createElement("canvas");
          tempC.width = garmentImg.naturalWidth;
          tempC.height = garmentImg.naturalHeight;
          const tCtx = tempC.getContext("2d", { willReadFrequently: true });
          if (tCtx && tempC.width > 0 && tempC.height > 0) {
            tCtx.drawImage(garmentImg, 0, 0);
            const gData = tCtx.getImageData(0, 0, tempC.width, tempC.height).data;
            const gWidth = tempC.width;
            const gHeight = tempC.height;

            const pinkOutlinePixels: Array<{ x: number; y: number }> = [];
            for (let gy = 1; gy < gHeight - 1; gy++) {
              for (let gx = 1; gx < gWidth - 1; gx++) {
                const idx = (gy * gWidth + gx) * 4 + 3;
                if (gData[idx] > GARMENT_ALPHA_THRESHOLD) {
                  if (
                    gData[((gy - 1) * gWidth + gx) * 4 + 3] <= GARMENT_ALPHA_THRESHOLD ||
                    gData[((gy + 1) * gWidth + gx) * 4 + 3] <= GARMENT_ALPHA_THRESHOLD ||
                    gData[(gy * gWidth + (gx - 1)) * 4 + 3] <= GARMENT_ALPHA_THRESHOLD ||
                    gData[(gy * gWidth + (gx + 1)) * 4 + 3] <= GARMENT_ALPHA_THRESHOLD
                  ) {
                    const mappedX = garmentDrawX + (gx / gWidth) * garmentDrawW;
                    const mappedY = garmentDrawY + (gy / gHeight) * garmentDrawH;
                    pinkOutlinePixels.push({ x: mappedX, y: mappedY });
                  }
                }
              }
            }

            for (const p of pinkOutlinePixels) {
              ctx.fillStyle = '#FF69B4';
              ctx.fillRect(p.x, p.y, 2, 2);
            }

            const leftSh = metrics.leftShoulderNorm;
            const rightSh = metrics.rightShoulderNorm;
            const mappedLeftShX = garmentDrawX + leftSh.x * garmentDrawW;
            const mappedLeftShY = garmentDrawY + leftSh.y * garmentDrawH;
            const mappedRightShX = garmentDrawX + rightSh.x * garmentDrawW;
            const mappedRightShY = garmentDrawY + rightSh.y * garmentDrawH;

            ctx.strokeStyle = '#FF1493';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(mappedLeftShX, mappedLeftShY);
            ctx.lineTo(mappedRightShX, mappedRightShY);
            ctx.stroke();

            ctx.fillStyle = '#FF1493';
            ctx.fillRect(mappedLeftShX - 2, mappedLeftShY - 2, 4, 4);
            ctx.fillRect(mappedRightShX - 2, mappedRightShY - 2, 4, 4);

            const leftArmTip = metrics.leftArmTipNorm;
            const rightArmTip = metrics.rightArmTipNorm;
            const mappedLeftArmTipX = garmentDrawX + leftArmTip.x * garmentDrawW;
            const mappedLeftArmTipY = garmentDrawY + leftArmTip.y * garmentDrawH;
            const mappedRightArmTipX = garmentDrawX + rightArmTip.x * garmentDrawW;
            const mappedRightArmTipY = garmentDrawY + rightArmTip.y * garmentDrawH;

            ctx.strokeStyle = '#00FFFF';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(mappedLeftShX, mappedLeftShY);
            ctx.lineTo(mappedLeftArmTipX, mappedLeftArmTipY);
            ctx.moveTo(mappedRightShX, mappedRightShY);
            ctx.lineTo(mappedRightArmTipX, mappedRightArmTipY);
            ctx.stroke();

            ctx.fillStyle = '#00FFFF';
            ctx.fillRect(mappedLeftArmTipX - 3, mappedLeftArmTipY - 3, 6, 6);
            ctx.fillRect(mappedRightArmTipX - 3, mappedRightArmTipY - 3, 6, 6);
          }
        }
      }

      ctx.restore();
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
            const shouldRunDetection = !isDetectionLockedByKeyboardRef.current;

            if (landmarker && shouldRunDetection) {
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
                if (latestLandmarksRef.current) {
                  lastGoodLandmarksRef.current = latestLandmarksRef.current;
                }

                if (modelLandmarks && modelLandmarks[11] && modelLandmarks[12]) {
                  const leftShoulder = modelLandmarks[11];
                  const rightShoulder = modelLandmarks[12];
                  const rawShoulderCenter =
                    (leftShoulder.x + rightShoulder.x) / 2;
                  
                  const rawShoulderY = (leftShoulder.y + rightShoulder.y) / 2;

                  const rawShoulderWidth = Math.max(
                    0.08,
                    Math.abs(rightShoulder.x - leftShoulder.x)
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
                        (modelShoulderYNormRef.current ?? rawShoulderY) -
                        modelShoulderWidthNormRef.current * 0.28
                      );
                    }
                    return Math.max(...candidates);
                  })();
                  modelFaceBottomNormRef.current = faceBottomY;
                  const faceLeftCandidates = [modelLandmarks[7]?.x, modelLandmarks[2]?.x, modelLandmarks[0]?.x, modelLandmarks[5]?.x].filter((value): value is number => typeof value === "number");
                  const faceRightCandidates = [modelLandmarks[8]?.x, modelLandmarks[5]?.x, modelLandmarks[0]?.x, modelLandmarks[2]?.x].filter((value): value is number => typeof value === "number");
                  const faceTopCandidates = [modelLandmarks[7]?.y, modelLandmarks[8]?.y, modelLandmarks[2]?.y, modelLandmarks[5]?.y, modelLandmarks[0]?.y].filter((value): value is number => typeof value === "number");
                  if (faceLeftCandidates.length > 0 && faceRightCandidates.length > 0 && faceTopCandidates.length > 0) {
                    modelFaceBoundsNormRef.current = {
                      left: Math.max(0, Math.min(...faceLeftCandidates)),
                      top: Math.max(0, Math.min(...faceTopCandidates)),
                      right: Math.min(1, Math.max(...faceRightCandidates)),
                      bottom: Math.min(1, faceBottomY)
                    };
                  } else {
                    modelFaceBoundsNormRef.current = null;
                  }

                  const rawNeckY = faceBottomY + modelShoulderWidthNormRef.current * 0.14;
                  const minNeckY = faceBottomY + modelShoulderWidthNormRef.current * 0.08;
                  const maxNeckY = (modelShoulderYNormRef.current ?? rawShoulderY) - modelShoulderWidthNormRef.current * 0.07;
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

                  const neckCenter = modelNeckNormRef.current;
                  if (neckCenter) {
                    const leftJointX = neckCenter.x + (leftShoulder.x - neckCenter.x) * NECK_SHOULDER_JOINT_BLEND;
                    const leftJointY = neckCenter.y + (leftShoulder.y - neckCenter.y) * NECK_SHOULDER_JOINT_BLEND;
                    const rightJointX = neckCenter.x + (rightShoulder.x - neckCenter.x) * NECK_SHOULDER_JOINT_BLEND;
                    const rightJointY = neckCenter.y + (rightShoulder.y - neckCenter.y) * NECK_SHOULDER_JOINT_BLEND;
                    const projectedJointY = (leftJointY + rightJointY) / 2;

                    const farPoseFactor = Math.max(
                      0,
                      Math.min(
                        1,
                        (SHOULDER_NEAR_WIDTH_NORM - rawShoulderWidth) /
                          (SHOULDER_NEAR_WIDTH_NORM - SHOULDER_FAR_WIDTH_NORM)
                      )
                    );
                    const shoulderYWeight = 0.55 + farPoseFactor * 0.35;
                    const shoulderBiasedJointY =
                      projectedJointY * (1 - shoulderYWeight) + rawShoulderY * shoulderYWeight;

                    const rawJointCenter = {
                      x: (leftJointX + rightJointX) / 2,
                      y: Math.min(
                        rawShoulderY,
                        Math.max(neckCenter.y, shoulderBiasedJointY)
                      )
                    };

                    modelNeckShoulderJointNormRef.current = modelNeckShoulderJointNormRef.current
                      ? {
                        x: lerp(modelNeckShoulderJointNormRef.current.x, rawJointCenter.x, LANDMARK_SMOOTHING),
                        y: lerp(modelNeckShoulderJointNormRef.current.y, rawJointCenter.y, LANDMARK_SMOOTHING)
                      }
                      : rawJointCenter;
                  } else {
                    modelNeckShoulderJointNormRef.current = null;
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
                  modelNeckShoulderJointNormRef.current = null;
                  modelFaceBottomNormRef.current = null;
                  modelFaceBoundsNormRef.current = null;
                  modelLeftEarNormRef.current = null;
                  modelRightEarNormRef.current = null;
                  latestLandmarksRef.current = lastGoodLandmarksRef.current;
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
                modelNeckShoulderJointNormRef.current = null;
                modelFaceBottomNormRef.current = null;
                modelFaceBoundsNormRef.current = null;
                modelLeftEarNormRef.current = null;
                modelRightEarNormRef.current = null;
                latestSegmentationRef.current = null;
                console.warn("Pose tracking frame failed", err);
              }
            }

            processingCtx.clearRect(0, 0, targetW, targetH);
            processingCtx.drawImage(video, 0, 0, targetW, targetH);
            const segmentationFrame = latestSegmentationRef.current;

            if (segmentationFrame && modelShoulderYNormRef.current === null) {
              const data = segmentationFrame.data;
              const width = segmentationFrame.width;
              const height = segmentationFrame.height;
              let topmostYNorm = 1.0;

              for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                  const idx = y * width + x;
                  if (data[idx] > BODY_MASK_THRESHOLD) {
                    if (
                      data[idx - 1] <= BODY_MASK_THRESHOLD || 
                      data[idx + 1] <= BODY_MASK_THRESHOLD || 
                      data[idx - width] <= BODY_MASK_THRESHOLD || 
                      data[idx + width] <= BODY_MASK_THRESHOLD
                    ) {
                      const normY = y / height;
                      if (normY < topmostYNorm) {
                        topmostYNorm = normY;
                      }
                    }
                  }
                }
              }

              if (topmostYNorm < 1.0) {
                modelShoulderYNormRef.current = topmostYNorm;
              }
            }

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
                    modelShoulderYNormRef.current,
                    modelFaceBottomNormRef.current,
                    modelFaceBoundsNormRef.current,
                    latestLandmarksRef.current
                  );
                }
              } else if (accessoryType === "necklace") {
                compositeNecklaceIntoNeck(
                  processingCtx,
                  garmentImageRef.current,
                  targetW,
                  targetH,
                  modelNeckShoulderJointNormRef.current,
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

            if (segmentationFrame) {
              drawDebugOutlines(
                processingCtx,
                targetW,
                targetH,
                segmentationFrame,
                showDebugOverlayRef.current
              );
            }

            displayCtx.drawImage(processingCanvas, 0, 0, targetW, targetH);

            lastSnapshotAtRef.current = now;
            setHasSnapshot(true);
            if (isDetectionLockedByKeyboardRef.current) {
              setStatusText("Snapshot auto-updates every 1 second. Detection locked by keyboard input.");
            } else {
              setStatusText("Snapshot auto-updates every 1 second.");
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
          <strong>Uniform Aspect Ratio Garment Compositing</strong>
          <br />
          <span style={{ fontSize: "11px", color: "#cbd5e1" }}>
            Garment shape, sleeves, and proportions are preserved natively without skewing.
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
            maxWidth: "310px"
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
          <button onClick={() => runManualAction("scaleUp", "button")} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>+</button>
          <button onClick={() => runManualAction("scaleDown", "button")} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>-</button>
          <button onClick={() => runManualAction("moveUp", "button")} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>U</button>
          <button onClick={() => runManualAction("moveDown", "button")} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>J</button>
          <button onClick={() => runManualAction("moveLeft", "button")} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>H</button>
          <button onClick={() => runManualAction("moveRight", "button")} style={{ padding: "6px 8px", borderRadius: "6px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.45)", fontSize: "11px", fontWeight: 800 }}>K</button>
          <button onClick={unlockDetection} style={{ padding: "6px 8px", borderRadius: "6px", background: "#0f766e", color: "#ccfbf1", border: "1px solid #14b8a6", fontSize: "11px", fontWeight: 800 }}>Unlock Detection</button>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#e2e8f0", fontSize: "11px", fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={showDebugOverlay}
              onChange={(e) => setShowDebugOverlay(e.target.checked)}
            />
            Debug (Body & Arm Tips)
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
            Show Green Body / Red Shoulder & Arm Tips Outline
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "8px"
            }}
          >
            <button onClick={() => runManualAction("scaleUp", "button")} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>+ Bigger</button>
            <button onClick={() => runManualAction("scaleDown", "button")} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>- Smaller</button>
            <button onClick={() => runManualAction("moveUp", "button")} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>U Move Up</button>
            <button onClick={() => runManualAction("moveDown", "button")} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>J Move Down</button>
            <button onClick={() => runManualAction("moveLeft", "button")} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>H Move Left</button>
            <button onClick={() => runManualAction("moveRight", "button")} style={{ padding: "10px", borderRadius: "8px", background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148, 163, 184, 0.5)", fontWeight: 800 }}>K Move Right</button>
            <button onClick={unlockDetection} style={{ padding: "10px", borderRadius: "8px", background: "#0f766e", color: "#ccfbf1", border: "1px solid #14b8a6", fontWeight: 800 }}>Unlock Detection</button>
            <button onClick={saveScreenshot} style={{ padding: "10px", borderRadius: "8px", background: "#0ea5e9", color: "#082f49", border: "1px solid #38bdf8", fontWeight: 800 }}>Save Screenshot (S)</button>
          </div>
        </div>
      )}
    </div>
  );
}