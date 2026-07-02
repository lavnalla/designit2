"use client";

import React, { useEffect, useRef, useState } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const DEFAULT_NECKLACE_FILES = [
  "necklace1.png", "necklace2.png", "necklace3.png", "necklace4.png",
  "necklace5.png", "design1.png", "design2.png", "design3.png"
];

interface NecklaceTryOnProps {
  selectedImageSrc?: string | null;
}

type Landmark2D = {
  x: number;
  y: number;
};

export default function NecklaceTryOn({ selectedImageSrc }: NecklaceTryOnProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const requestRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const latestLandmarksRef = useRef<Landmark2D[] | null>(null);

  const necklaceCatalog = React.useMemo(() => {
  if (selectedImageSrc) {
      return [selectedImageSrc, ...DEFAULT_NECKLACE_FILES];
  }
    return DEFAULT_NECKLACE_FILES;
  }, [selectedImageSrc]);

  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState("Loading tracking models...");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [scaleMult, setScaleMult] = useState(1.0);
  const [vertOffset, setVertOffset] = useState(0.0);
  const [showTouchKeyboard, setShowTouchKeyboard] = useState(false);

  const scaleStep = 0.05;
  const offsetStep = 0.03;

  const nextDesign = () => setCurrentIdx((prev) => (prev + 1) % necklaceCatalog.length);
  const prevDesign = () => setCurrentIdx((prev) => (prev - 1 + necklaceCatalog.length) % necklaceCatalog.length);
  const moveUp = () => setVertOffset((prev) => prev - offsetStep);
  const moveDown = () => setVertOffset((prev) => prev + offsetStep);
  const sizeUp = () => setScaleMult((prev) => prev + scaleStep);
  const sizeDown = () => setScaleMult((prev) => Math.max(0.1, prev - scaleStep));
  const resetAdjustments = () => {
    setScaleMult(1.0);
    setVertOffset(0.0);
  };

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 900px)");
    const sync = () => setShowTouchKeyboard(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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

    const loadImageSafe = (src: string) => {
      return new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        if (!src.startsWith("data:") && !src.startsWith("blob:")) {
          img.crossOrigin = "anonymous";
        }
        img.onload = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            resolve(img);
          } else {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    };
    
    async function setup() {
      try {
        const loadedImagesRaw = await Promise.all(
          necklaceCatalog.map(async (src) => {
            return loadImageSafe(src);
          })
        );

        const loadedImages = loadedImagesRaw.filter((img): img is HTMLImageElement => !!img);

        if (!active) return;

        if (loadedImages.length === 0) {
          setStatusText("Failed to load try-on image.");
          return;
        }

        imagesRef.current = loadedImages;
        setCurrentIdx(0);

        if (!poseLandmarkerRef.current) {
          setStatusText("Loading tracking engine models...");
          const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
          );
          
          const landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            outputSegmentationMasks: false
          });
          if (!active) return;
          poseLandmarkerRef.current = landmarker;
        }

        setStatusText("Ready! Click the button to start.");

      } catch (error) {
        console.error(error);
        setStatusText("Failed to initialize system assets.");
      }
    }

    setup();

    return () => {
      active = false;
    };
  }, [necklaceCatalog, selectedImageSrc]);

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
      link.download = `studio_snapshot_${Date.now()}.png`;
      link.href = snapshotCanvas.toDataURL("image/png");
      link.click();
    }
  }

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "n") {
        nextDesign();
      } else if (key === "b") {
        prevDesign();
      } else if (key === "u") {
        moveUp();
      } else if (key === "j") {
        moveDown();
      } else if (key === "+" || e.key === "=") {
        sizeUp();
      } else if (key === "-") {
        sizeDown();
      } else if (key === "r") {
        resetAdjustments();
      } else if (key === "s") {
        saveScreenshot();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, necklaceCatalog.length]);

  useEffect(() => {
    let lastVideoTime = -1;

    function predictLoop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = poseLandmarkerRef.current;

      if (video && canvas) {
        // Keep the draw surface valid even before metadata is fully available.
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          const activeImage = imagesRef.current[currentIdx];

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const hasValidVideoFrame =
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0;

          if (landmarker && hasValidVideoFrame && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            try {
              const startTimeMs = performance.now();
              const results = landmarker.detectForVideo(video, startTimeMs);
              latestLandmarksRef.current = results.landmarks && results.landmarks.length > 0
                ? results.landmarks[0]
                : null;
            } catch (err) {
              // Keep loop alive and continue drawing fallback placement.
              latestLandmarksRef.current = null;
              console.warn("Pose tracking frame failed", err);
            }
          }

          const landmarks = latestLandmarksRef.current;
          if (landmarks && activeImage) {
            const nose = landmarks[0];
            const leftShoulder = landmarks[11];
            const rightShoulder = landmarks[12];

            if (nose && leftShoulder && rightShoulder) {
              const nY = Math.trunc(nose.y * canvas.height);
              const lsX = Math.trunc(leftShoulder.x * canvas.width);
              const lsY = Math.trunc(leftShoulder.y * canvas.height);
              const rsX = Math.trunc(rightShoulder.x * canvas.width);
              const rsY = Math.trunc(rightShoulder.y * canvas.height);

              const midX = Math.trunc((lsX + rsX) / 2);
              const midY = Math.trunc((lsY + rsY) / 2);
              const shoulderWidth = Math.abs(rsX - lsX);

              const necklaceW = Math.trunc(shoulderWidth * scaleMult);
              const aspect = activeImage.naturalHeight / activeImage.naturalWidth;
              const necklaceH = Math.trunc(necklaceW * aspect);
              const neckY = Math.trunc(nY + (midY - nY) * (0.62 + vertOffset));
              const drawX = Math.trunc(midX - necklaceW / 2);
              const drawY = Math.trunc(neckY - necklaceH / 6);

              if (Number.isFinite(drawX) && Number.isFinite(drawY) && necklaceW > 0 && necklaceH > 0) {
                ctx.drawImage(activeImage, drawX, drawY, necklaceW, necklaceH);
              }
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
  }, [isActive, currentIdx, scaleMult, vertOffset, selectedImageSrc]);

  const isCustomAsset = selectedImageSrc && currentIdx === 0;

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
          <strong>
            [{currentIdx + 1}/{necklaceCatalog.length}] {isCustomAsset ? "Γ£¿ Studio Workspace Active Design (Transparent)" : necklaceCatalog[currentIdx]}
          </strong>
          <br />
          Scale: {scaleMult.toFixed(2)} | Offset: {vertOffset.toFixed(2)}<br />
          <span style={{ color: "#aaa", fontSize: "11px" }}>
            N/B: Switch | U/J: Up/Down | +/-: Size | R: Reset | S: Screenshot
          </span>
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
            Mobile Keyboard
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: "8px"
            }}
          >
            <button onClick={prevDesign} style={{ padding: "8px", borderRadius: "8px", background: "#1e293b", color: "#f8fafc", border: "1px solid #334155", fontWeight: 700 }}>B Prev</button>
            <button onClick={nextDesign} style={{ padding: "8px", borderRadius: "8px", background: "#1e293b", color: "#f8fafc", border: "1px solid #334155", fontWeight: 700 }}>N Next</button>
            <button onClick={sizeDown} style={{ padding: "8px", borderRadius: "8px", background: "#1e293b", color: "#f8fafc", border: "1px solid #334155", fontWeight: 700 }}>- Size</button>
            <button onClick={sizeUp} style={{ padding: "8px", borderRadius: "8px", background: "#1e293b", color: "#f8fafc", border: "1px solid #334155", fontWeight: 700 }}>+ Size</button>
            <button onClick={moveUp} style={{ padding: "8px", borderRadius: "8px", background: "#1e293b", color: "#f8fafc", border: "1px solid #334155", fontWeight: 700 }}>U Up</button>
            <button onClick={moveDown} style={{ padding: "8px", borderRadius: "8px", background: "#1e293b", color: "#f8fafc", border: "1px solid #334155", fontWeight: 700 }}>J Down</button>
            <button onClick={resetAdjustments} style={{ padding: "8px", borderRadius: "8px", background: "#334155", color: "#f8fafc", border: "1px solid #475569", fontWeight: 700 }}>R Reset</button>
            <button onClick={saveScreenshot} style={{ padding: "8px", borderRadius: "8px", background: "#0ea5e9", color: "#082f49", border: "1px solid #38bdf8", fontWeight: 800 }}>S Shot</button>
          </div>
        </div>
      )}
    </div>
  );
}
