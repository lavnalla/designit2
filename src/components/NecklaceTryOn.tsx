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
}

declare global {
  interface Window {
    Camera: any;
    Holistic: any;
    SelfieSegmentation: any;
  }
}

export default function NecklaceTryOn({ selectedImageSrc }: NecklaceTryOnProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // References to hold the tracking metrics and image states across loops
  const latestSegmentationRef = useRef<any>(null);
  const latestPoseLandmarksRef = useRef<any>(null);
  const latestFaceLandmarksRef = useRef<any>(null);
  const garmentImageRef = useRef<HTMLImageElement | null>(null);

  // Engines stored as refs so they can be explicitly destroyed on close
  const activeCameraRef = useRef<any>(null);
  const selfieSegmentationRef = useRef<any>(null);
  const holisticRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Manual Adjustments placeholders
  const manualOffsetXRef = useRef<number>(0);
  const manualOffsetYRef = useRef<number>(0);
  const manualScaleRef = useRef<number>(1.0);

  // Track script load and full-screen minimized states
  const [scriptsLoaded, setScriptsLoaded] = useState({
    camera: false,
    selfie: false,
    holistic: false,
  });
  const [isLoaded, setIsModelLoaded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isClosed, setIsClosed] = useState(false);

  const targetWidth = 640;
  const targetHeight = 480;
  const BODY_MASK_THRESHOLD = 50;

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
        const topCutoffY = img.height * 0.2;
        const sourceHeightToKeep = img.height - topCutoffY;
        const sideCutoffX = img.width * 0.1;
        const sourceWidthToKeep = img.width * 0.8;

        localCropCtx.drawImage(
          img,
          sideCutoffX, topCutoffY, sourceWidthToKeep, sourceHeightToKeep,
          0, 0, img.width, img.height
        );

        const processedImg = new Image();
        processedImg.onload = () => {
          garmentImageRef.current = processedImg;
        };
        processedImg.src = localCropC.toDataURL();
      }
    };
    img.src = selectedImageSrc;
  }, [selectedImageSrc]);

  useEffect(() => {
    if (isClosed || isMinimized) return;
    if (!scriptsLoaded.camera || !scriptsLoaded.selfie || !scriptsLoaded.holistic) return;
    if (!videoRef.current || !canvasRef.current || !window.Camera || !window.SelfieSegmentation || !window.Holistic) return;

    let requestFrameId: number;

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

    setIsModelLoaded(true);

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

          camMaskCtx.clearRect(0, 0, w, h);
          camMaskCtx.save();
          camMaskCtx.drawImage(currentCamMask, 0, 0, w, h);
          camMaskCtx.globalCompositeOperation = "source-in";

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

            let customTopAnchor = minY;
            if (faceLandmarks && faceLandmarks[152]) {
              const chinY = faceLandmarks[152].y * h;
              customTopAnchor = chinY + torsoHeight * 0.05;
            } else {
              customTopAnchor = minY - torsoHeight * 0.22;
            }

            const drawX = minX - torsoWidth * 0.25 + manualOffsetXRef.current;
            const drawY = customTopAnchor - h * 0.05 + manualOffsetYRef.current - (h * 0.05); // 5% shift lift
            const drawW = torsoWidth * 1.5 * manualScaleRef.current;
            const drawH = (maxY - customTopAnchor + torsoHeight * 0.4);

            camMaskCtx.drawImage(croppedImageElement, drawX, drawY, drawW, drawH);
          } else {
            camMaskCtx.fillStyle = "rgba(0, 50, 255, 0.4)";
            camMaskCtx.fillRect(0, 0, w, h);
          }
          camMaskCtx.restore();

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
      requestFrameId = requestAnimationFrame(renderLoop);
    }

    // Capture the raw camera media stream reference directly to disable it cleanly later
    activeCameraRef.current = new window.Camera(video, {
      onFrame: async () => {
        if (selfieSegmentationRef.current) await selfieSegmentationRef.current.send({ image: video });
        if (holisticRef.current) await holisticRef.current.send({ image: video });
      },
      width: targetWidth,
      height: targetHeight,
    });

    activeCameraRef.current.start().then(() => {
      if (video.srcObject) {
        streamRef.current = video.srcObject as MediaStream;
      }
    });
    
    renderLoop();

    // CLEANUP LIFECYCLE: This forces everything running in memory to stop completely on close
    return () => {
      cancelAnimationFrame(requestFrameId);
      setIsModelLoaded(false);
      
      if (activeCameraRef.current) {
        try { activeCameraRef.current.stop(); } catch(e){}
        activeCameraRef.current = null;
      }
      
      // FIXED: Forcibly stop the webcam tracks to release hardware locks instantly
if (streamRef.current) {streamRef.current.getTracks().forEach((track) => {track.stop();track.enabled = false;});streamRef.current = null;}if (videoRef.current) {videoRef.current.srcObject = null;videoRef.current.load();}if (selfieSegmentationRef.current) {try { selfieSegmentationRef.current.close(); } catch(e){}selfieSegmentationRef.current = null;}if (holisticRef.current) {try { holisticRef.current.close(); } catch(e){}holisticRef.current = null;}latestSegmentationRef.current = null;latestPoseLandmarksRef.current = null;latestFaceLandmarksRef.current = null;};}, [scriptsLoaded, isMinimized, isClosed]);const handleCloseFittingRoom = () => {setIsClosed(true);setScriptsLoaded({ camera: false, selfie: false, holistic: false });};
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
            bottom: "20px",
            right: "20px",
            background: "#3b82f6",
            color: "#fff",
            padding: "12px 24px",
            borderRadius: "50px",
            border: "none",
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
            cursor: "pointer",
            fontWeight: "bold",
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
            justifyContent: "center", 
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
              justifyContent: "space-between", 
              alignItems: "center", 
              padding: "15px 30px", 
              background: "rgba(0,0,0,0.6)",
              boxSizing: "border-box"
            }}
          >
            <div style={{ color: "#fff", fontWeight: "bold", fontSize: "16px" }}>
              {"Virtual Fitting Room - Live Studio Preview"}
              {!isLoaded && <span style={{ marginLeft: "15px", color: "#a3a3a3", fontSize: "13px" }}>{"Loading Textures..."}</span>}
            </div>
            
            {/* MINIMIZE AND CLOSE CONTROLS */}
            <div style={{ display: "flex", gap: "12px" }}>
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
          </div>

          {/* DYNAMIC SCALING VIEWPORT CANVAS BOUNDS */}
          <div 
            style={{ 
              position: "relative", 
              width: "100%", 
              height: "calc(100% - 60px)", 
              marginTop: "60px",
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
                height: "90%", 
                aspectRatio: "4/3",
                transform: "rotateY(180deg)", 
                background: "#222",
                borderRadius: "12px",
                boxShadow: "0 12px 36px rgba(0,0,0,0.5)"
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}