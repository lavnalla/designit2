"use client";

import React, { useEffect, useRef, useState } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const NECKLACE_FILES = [
  "necklace1.png", "necklace2.png", "necklace3.png", "necklace4.png",
  "necklace5.png", "design1.png", "design2.png", "design3.png"
];

export default function NecklaceTryOn() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const requestRef = useRef<number | null>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);

  // State Management
  const [isReady, setIsReady] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState("Loading assets & tracking models...");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [scaleMult, setScaleMult] = useState(1.0);
  const [vertOffset, setVertOffset] = useState(0.0);

  // Constants
  const scaleStep = 0.05;
  const offsetStep = 0.03;

  // 1. Initialize & Preload everything on mount
  useEffect(() => {
    let active = true;

    async function setup() {
      try {
        // Preload Image Assets
        const loadedImages = await Promise.all(
          NECKLACE_FILES.map((src) => {
            return new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image();
              img.src = src; // Ensure these live in your /public directory
              img.onload = () => resolve(img);
              img.onerror = () => reject(new Error(`Failed to load ${src}`));
            });
          })
        );

        if (!active) return;
        imagesRef.current = loadedImages;

        // Initialize MediaPipe Pose Model
        setStatusText("Loading vision models...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            // Updated absolute CDN path configuration targeting the Lite layout model pipeline
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          outputSegmentationMasks: false
        });

        if (!active) return;
        poseLandmarkerRef.current = landmarker;
        setIsReady(true);
        setStatusText("Ready! Click the button to start.");
      } catch (error) {
        console.error(error);
        setStatusText("Failed to initialize system assets.");
      }
    }

    setup();

    return () => {
      active = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // 2. Capture Key Commands natively in React window context
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "n") {
        setCurrentIdx((prev) => (prev + 1) % NECKLACE_FILES.length);
      } else if (key === "b") {
        setCurrentIdx((prev) => (prev - 1 + NECKLACE_FILES.length) % NECKLACE_FILES.length);
      } else if (key === "u") {
        setVertOffset((prev) => prev - offsetStep);
      } else if (key === "j") {
        setVertOffset((prev) => prev + offsetStep);
      } else if (key === "+" || e.key === "=") {
        setScaleMult((prev) => prev + scaleStep);
      } else if (key === "-") {
        setScaleMult((prev) => Math.max(0.1, prev - scaleStep));
      } else if (key === "r") {
        setScaleMult(1.0);
        setVertOffset(0.0);
      } else if (key === "s") {
        saveScreenshot();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive]);

  // 3. Main processing loop execution tracking hooks
  useEffect(() => {
    let lastVideoTime = -1;

    function predictLoop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = poseLandmarkerRef.current;

      if (video && canvas && landmarker && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          const startTimeMs = performance.now();
          const results = landmarker.detectForVideo(video, startTimeMs);

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0];
            const nose = landmarks[0];
            const leftShoulder = landmarks[11];
            const rightShoulder = landmarks[12];

            // Normalize values down into exact viewport layout coordinates
            const nY = nose.y * canvas.height;
            const lsX = leftShoulder.x * canvas.width;
            const lsY = leftShoulder.y * canvas.height;
            const rsX = rightShoulder.x * canvas.width;
            const rsY = rightShoulder.y * canvas.height;

            const midX = (lsX + rsX) / 2;
            const midY = (lsY + rsY) / 2;
            const shoulderWidth = Math.abs(rsX - lsX);

            // Access live atomic configurations matching key updates
            const activeImage = imagesRef.current[currentIdx];
            
            if (activeImage) {
              const necklaceW = shoulderWidth * scaleMult;
              const aspect = activeImage.naturalHeight / activeImage.naturalWidth;
              const necklaceH = necklaceW * aspect;

              const neckY = nY + (midY - nY) * (0.62 + vertOffset);
              const drawX = midX - necklaceW / 2;
              const drawY = neckY - necklaceH / 6;

              ctx.drawImage(activeImage, drawX, drawY, necklaceW, necklaceH);
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
  }, [isActive, currentIdx, scaleMult, vertOffset]);

  // 4. Trigger Web Camera Device Capabilities
  const startTryOn = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });
      videoRef.current.srcObject = stream;
      setIsActive(true);
    } catch (err) {
      alert("Webcam connection failed.");
      console.error(err);
    }
  };

  // 5. Screenshot Logic
  const saveScreenshot = () => {
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
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "15px" }}>
      {!isActive && (
        <button
          onClick={startTryOn}
          disabled={!isReady}
          style={{
            background: isReady ? "#3498db" : "#555",
            color: "white",
            padding: "10px 20px",
            border: "none",
            borderRadius: "5px",
            cursor: isReady ? "pointer" : "not-allowed",
            fontSize: "16px"
          }}
        >
          {isReady ? "Start Virtual Try-On" : "Loading Engine Assets..."}
        </button>
      )}

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
        {/* HUD Control Overlay Panel */}
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
          <strong>[{currentIdx + 1}/{NECKLACE_FILES.length}] {NECKLACE_FILES[currentIdx]}</strong><br />
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
            transform: "scaleX(-1)"
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            width: "640px",
            height: "480px",
            transform: "scaleX(-1)"
          }}
        />
      </div>
      {!isActive && <p style={{ fontSize: "14px", color: "#888" }}>{statusText}</p>}
    </div>
  );
}