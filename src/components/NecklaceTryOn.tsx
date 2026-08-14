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

declare global {
  interface Window {
    Camera: any;
    Holistic: any;
    SelfieSegmentation: any;
  }
}

export default function NecklaceTryOn({ selectedImageSrc, mode = "garment", onClose }: NecklaceTryOnProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // References to hold the tracking metrics and image states across loops
  const latestSegmentationRef = useRef<any>(null);
  const latestPoseLandmarksRef = useRef<any>(null);
  const latestFaceLandmarksRef = useRef<any>(null);
  const garmentImageRef = useRef<HTMLImageElement | null>(null);
  const overlayBoundsRef = useRef<OverlayBounds | null>(null);
  const necklaceAnchorsRef = useRef<NecklaceAnchorPoints | null>(null);
  const earringAssetsRef = useRef<EarringAssetSet | null>(null);

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

    sessionIdRef.current += 1;
    const sessionId = sessionIdRef.current;
    let requestFrameId: number;
    let cancelled = false;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext("2d", { willReadFrequently: true });
    if (!canvasCtx) return;

    const camMaskCanvas = document.createElement("canvas");
    camMaskCanvas.width = targetWidth;
    camMaskCanvas.height = targetHeight;
    const camMaskCtx = camMaskCanvas.getContext("2d");

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

      if (video.readyState === video.HAVE_ENOUGH_DATA && canvasCtx && camMaskCtx) {
        canvasCtx.clearRect(0, 0, targetWidth, targetHeight);
        canvasCtx.drawImage(video, 0, 0, targetWidth, targetHeight);

        const currentCamMask = latestSegmentationRef.current;
        const lm = latestPoseLandmarksRef.current;
        const faceLandmarks = latestFaceLandmarksRef.current;

        if (currentCamMask && lm) {
          const w = targetWidth;
          const h = targetHeight;

          const croppedImageElement = garmentImageRef.current;

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
                  const leftEarX = leftTempleX - faceWidth * 0.015 + manualOffsetXRef.current;
                  const rightEarX = rightTempleX + faceWidth * 0.015 + manualOffsetXRef.current;
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

          if (mode !== "necklace") {
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
            const pattern = camMaskCtx.createPattern(video, "no-repeat");
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
            await selfieSegmentationRef.current.send({ image: video });
          }

          if (sessionIdRef.current !== sessionId) {
            return;
          }

          if (holisticRef.current) {
            await holisticRef.current.send({ image: video });
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

        const tick = async () => {
          if (cancelled || sessionIdRef.current !== sessionId) {
            return;
          }

          await processFrame();

          if (!cancelled && sessionIdRef.current === sessionId) {
            requestFrameId = requestAnimationFrame(() => {
              void tick();
            });
          }
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

    void startCamera();

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
  }, [scriptsLoaded, isMinimized, isClosed, mode, onClose]);

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
            <canvas
              ref={canvasRef}
              width={targetWidth}
              height={targetHeight}
              style={{ 
                width: isMobile ? "96vw" : "auto",
                height: isMobile ? "auto" : "90%", 
                maxHeight: isMobile ? "calc(100vh - 160px)" : "none",
                aspectRatio: "4/3",
                transform: "rotateY(180deg)", 
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