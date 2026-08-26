"use client";

import React, { useEffect, useRef, useState } from "react";

export type GarmentPart = "arm" | "body" | "neck" | "shoulders";

const PART_COLORS: Record<GarmentPart, string> = {
  arm: "#ff0000",
  body: "#00ff00",
  neck: "#0000ff",
  shoulders: "#ffff00",
};

const PART_LABELS: Record<GarmentPart, string> = {
  arm: "Arm",
  body: "Body",
  neck: "Neck",
  shoulders: "Shoulders",
};

const BRUSH_SIZE = 10;

type Point = { x: number; y: number };
type Stroke = { part: GarmentPart; points: Point[] };

interface GarmentPartPainterProps {
  imageSrc: string;
  onSave: (maskDataUrl: string) => void;
  onContinue: () => void;
  onClose: () => void;
}

export default function GarmentPartPainter({
  imageSrc,
  onSave,
  onContinue,
  onClose,
}: GarmentPartPainterProps) {
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const autoMaskImageRef = useRef<HTMLImageElement | null>(null);

  const [activePart, setActivePart] = useState<GarmentPart>("arm");
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [hasSaved, setHasSaved] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [hasAutoRun, setHasAutoRun] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    setHasAutoRun(false);

    img.onload = () => {
      if (cancelled) return;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });

      const imageCanvas = imageCanvasRef.current;
      if (imageCanvas) {
        imageCanvas.width = img.naturalWidth;
        imageCanvas.height = img.naturalHeight;
        const ctx = imageCanvas.getContext("2d");
        ctx?.drawImage(img, 0, 0);
      }

      const maskCanvas = maskCanvasRef.current;
      if (maskCanvas) {
        maskCanvas.width = img.naturalWidth;
        maskCanvas.height = img.naturalHeight;
      }
    };

    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  const getCanvasPoint = (
    e: React.PointerEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const paintSegment = (
    part: GarmentPart,
    from: Point,
    to: Point
  ) => {
    const ctx = maskCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = PART_COLORS[part];
    ctx.lineWidth = BRUSH_SIZE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const redrawStrokes = (strokeList: Stroke[]) => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (autoMaskImageRef.current) {
      ctx.drawImage(autoMaskImageRef.current, 0, 0, canvas.width, canvas.height);
    }
    strokeList.forEach((stroke) => {
      if (stroke.points.length === 0) return;
      ctx.strokeStyle = PART_COLORS[stroke.part];
      ctx.lineWidth = BRUSH_SIZE;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const [first, ...rest] = stroke.points;
      ctx.moveTo(first.x, first.y);
      if (rest.length === 0) {
        ctx.lineTo(first.x, first.y);
      } else {
        rest.forEach((p) => ctx.lineTo(p.x, p.y));
      }
      ctx.stroke();
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    if (!point) return;
    isDrawingRef.current = true;
    lastPointRef.current = point;
    currentStrokeRef.current = { part: activePart, points: [point] };
    paintSegment(activePart, point, point);
    setHasSaved(false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const point = getCanvasPoint(e);
    if (!point || !lastPointRef.current || !currentStrokeRef.current) return;
    paintSegment(currentStrokeRef.current.part, lastPointRef.current, point);
    currentStrokeRef.current.points.push(point);
    lastPointRef.current = point;
  };

  const stopDrawing = () => {
    if (currentStrokeRef.current && currentStrokeRef.current.points.length > 0) {
      setStrokes((prev) => [...prev, currentStrokeRef.current as Stroke]);
    }
    currentStrokeRef.current = null;
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleUndo = () => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      redrawStrokes(next);
      return next;
    });
    setHasSaved(false);
  };

  const handleClear = () => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    autoMaskImageRef.current = null;
    setStrokes([]);
    setHasSaved(false);
  };

  const handleAutoDetect = async () => {
    setIsAutoDetecting(true);
    setAutoDetectError(null);
    try {
      const response = await fetch("/api/garment-segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: imageSrc }),
      });
      const data = await response.json();
      if (!response.ok || !data?.maskDataUrl) {
        throw new Error(data?.details || data?.error || "Auto-detect failed");
      }

      const maskImg = new Image();
      await new Promise<void>((resolve, reject) => {
        maskImg.onload = () => resolve();
        maskImg.onerror = () => reject(new Error("Could not load detected mask image"));
        maskImg.src = data.maskDataUrl;
      });

      autoMaskImageRef.current = maskImg;
      redrawStrokes(strokes);
      setHasSaved(false);
    } catch (err) {
      setAutoDetectError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAutoDetecting(false);
    }
  };

  useEffect(() => {
    if (imageSize && !hasAutoRun) {
      setHasAutoRun(true);
      void handleAutoDetect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSize, hasAutoRun]);

  const handleSave = (): string | null => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const maskDataUrl = canvas.toDataURL("image/png");
    try {
      window.localStorage.setItem(
        `garmentPartMask:${imageSrc.slice(-64)}`,
        maskDataUrl
      );
    } catch (storageError) {
      console.warn("Could not save garment part mask to localStorage.", storageError);
    }
    onSave(maskDataUrl);
    setHasSaved(true);
    return maskDataUrl;
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        background: "rgba(15, 23, 42, 0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          background: "#0f172a",
          borderRadius: "16px",
          padding: "16px",
          width: "min(94vw, 720px)",
          maxHeight: "94vh",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          overflowY: "auto",
        }}
      >
        <div>
          <h3
            style={{
              color: "#e2e8f0",
              fontSize: "13px",
              fontWeight: 800,
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Mark Garment Parts
          </h3>
          <p style={{ color: "#94a3b8", fontSize: "11px", margin: "4px 0 0" }}>
            {isAutoDetecting
              ? "Detecting garment parts automatically…"
              : "Auto-detected below — pick a part and draw over anything that's wrong or missing."}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {(Object.keys(PART_COLORS) as GarmentPart[]).map((part) => (
            <button
              key={part}
              onClick={() => setActivePart(part)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                borderRadius: "8px",
                border:
                  activePart === part
                    ? "2px solid #f8fafc"
                    : "2px solid transparent",
                background: "#1e293b",
                color: "#e2e8f0",
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "3px",
                  background: PART_COLORS[part],
                  display: "inline-block",
                }}
              />
              {PART_LABELS[part]}
            </button>
          ))}
          <button
            onClick={handleAutoDetect}
            disabled={isAutoDetecting}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 12px",
              borderRadius: "8px",
              border: "2px solid transparent",
              background: "#334155",
              color: "#e2e8f0",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              cursor: isAutoDetecting ? "wait" : "pointer",
              opacity: isAutoDetecting ? 0.6 : 1,
            }}
          >
            {isAutoDetecting ? "Detecting…" : hasAutoRun ? "🔄 Re-detect" : "✨ Auto-Detect"}
          </button>
        </div>

        {autoDetectError && (
          <p style={{ color: "#fca5a5", fontSize: "11px", margin: 0 }}>
            Auto-detect failed: {autoDetectError}
          </p>
        )}

        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: imageSize
              ? `${imageSize.width} / ${imageSize.height}`
              : "3 / 4",
            background: "#f1f5f9",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <canvas
            ref={imageCanvasRef}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          />
          <canvas
            ref={maskCanvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrawing}
            onPointerLeave={stopDrawing}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0.55,
              cursor: "crosshair",
              touchAction: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            onClick={handleClear}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(148,163,184,0.4)",
              background: "transparent",
              color: "#cbd5e1",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
          <button
            onClick={handleUndo}
            disabled={strokes.length === 0}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(148,163,184,0.4)",
              background: "transparent",
              color: strokes.length === 0 ? "#475569" : "#cbd5e1",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              cursor: strokes.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            ← Back
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(148,163,184,0.4)",
              background: "transparent",
              color: "#cbd5e1",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: "none",
              background: "#0ea5e9",
              color: "#0f172a",
              fontSize: "11px",
              fontWeight: 800,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Save Outline
          </button>
          <button
            onClick={() => {
              if (!hasSaved) handleSave();
              onContinue();
            }}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: "none",
              background: "#facc15",
              color: "#1c1917",
              fontSize: "11px",
              fontWeight: 800,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Continue to Webcam →
          </button>
        </div>
      </div>
    </div>
  );
}
