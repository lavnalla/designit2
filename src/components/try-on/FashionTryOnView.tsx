"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Detection = {
  id: number;
  label: string;
  pixels: number;
  percent: number;
};

type SegmentResponse = {
  model_id: string;
  device: string;
  inference_seconds: number;
  image_size: { width: number; height: number };
  detections: Detection[];
  original_data_url: string;
  mask_data_url: string;
  overlay_data_url: string;
  detail?: string;
};

type Mode = "upload" | "camera";

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function FashionTryOnView() {
  const [mode, setMode] = useState<Mode>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceOk, setServiceOk] = useState<boolean | null>(null);
  const [result, setResult] = useState<SegmentResponse | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/fashion-segment", { method: "GET" });
        if (!cancelled) setServiceOk(res.ok);
      } catch {
        if (!cancelled) setServiceOk(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }

  async function startCamera() {
    setError(null);
    setMode("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open camera");
      setCameraOn(false);
    }
  }

  async function segmentBlob(blob: Blob, localPreviewUrl?: string) {
    setBusy(true);
    setError(null);
    if (localPreviewUrl) setPreview(localPreviewUrl);

    try {
      const form = new FormData();
      form.append("file", blob, "capture.jpg");
      const res = await fetch("/api/fashion-segment", { method: "POST", body: form });
      const data = (await res.json()) as SegmentResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.detail || data.error || `Request failed (${res.status})`);
      }
      setResult(data);
      setPreview(data.original_data_url);
    } catch (err) {
      setResult(null);
      setError(
        err instanceof Error
          ? err.message
          : "Segmentation failed. Is the local Python service running?",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onFileChange(file: File | null) {
    if (!file) return;
    setMode("upload");
    await stopCamera();
    const url = URL.createObjectURL(file);
    await segmentBlob(file, url);
  }

  async function captureFromCamera() {
    const video = videoRef.current;
    if (!video || !cameraOn) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (!blob) {
      setError("Could not capture camera frame");
      return;
    }
    await segmentBlob(blob, canvas.toDataURL("image/jpeg", 0.92));
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-stone-100 text-slate-900">
      <nav className="flex items-center justify-between px-6 py-4 border-b-4 border-[#B87333] bg-gradient-to-r from-yellow-600 via-yellow-500 to-yellow-600 shadow-xl">
        <Link href="/" className="flex items-center gap-2 text-white font-black text-xl drop-shadow">
          <img src="/logo.png" alt="DesignIt" className="h-7 w-auto brightness-0 invert" />
          DesignIt
        </Link>
        <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-wide text-white">
          <Link href="/" className="hover:text-yellow-100">
            Home
          </Link>
          <span className="opacity-80">Try it on</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-800">
            Try it on — Fashion segmentation
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Upload a photo or use your camera. This page calls the open-source{" "}
            <a
              className="text-[#B87333] underline underline-offset-2"
              href="https://huggingface.co/sayeed99/segformer-b3-fashion"
              target="_blank"
              rel="noreferrer"
            >
              SegFormer fashion model
            </a>{" "}
            running locally on your machine.
          </p>
          <p
            className={`text-xs font-semibold ${
              serviceOk === null
                ? "text-slate-400"
                : serviceOk
                  ? "text-emerald-600"
                  : "text-rose-600"
            }`}
          >
            {serviceOk === null && "Checking local segmentation service…"}
            {serviceOk === true && "Local segmentation service is online"}
            {serviceOk === false &&
              "Service offline — run: npm run segment:server (port 8000)"}
          </p>
        </header>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode("upload");
                  void stopCamera();
                  fileRef.current?.click();
                }}
                className="px-4 py-2 rounded-full text-xs font-bold uppercase bg-gradient-to-r from-yellow-500 to-[#B87333] text-white shadow"
              >
                Upload photo
              </button>
              <button
                type="button"
                onClick={() => void startCamera()}
                className="px-4 py-2 rounded-full text-xs font-bold uppercase border border-slate-300 bg-white text-slate-700"
              >
                Use camera
              </button>
              {cameraOn && (
                <button
                  type="button"
                  onClick={() => void captureFromCamera()}
                  disabled={busy}
                  className="px-4 py-2 rounded-full text-xs font-bold uppercase bg-slate-900 text-white disabled:opacity-50"
                >
                  Capture & segment
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="relative aspect-[4/5] max-h-[480px] rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
              {mode === "camera" && cameraOn ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="w-full h-full object-cover scale-x-[-1]"
                />
              ) : preview ? (
                <img src={preview} alt="Input preview" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm text-slate-400 p-6 text-center">
                  Upload an outfit photo or turn on the camera to begin.
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-sm font-semibold">
                  Running SegFormer…
                </div>
              )}
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-4">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-600">Results</h2>

            {!result && (
              <p className="text-sm text-slate-400">
                Overlay, class list, and downloadable mask will appear here after segmentation.
              </p>
            )}

            {result && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <figure className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                    <img src={result.overlay_data_url} alt="Segmentation overlay" className="w-full h-auto" />
                    <figcaption className="text-[11px] text-center py-1 text-slate-500">Overlay</figcaption>
                  </figure>
                  <figure className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                    <img src={result.mask_data_url} alt="Segmentation mask" className="w-full h-auto" />
                    <figcaption className="text-[11px] text-center py-1 text-slate-500">Mask</figcaption>
                  </figure>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => downloadDataUrl(result.mask_data_url, "fashion-mask.png")}
                    className="px-3 py-2 rounded-full text-xs font-bold uppercase border border-slate-300"
                  >
                    Download mask
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadDataUrl(result.overlay_data_url, "fashion-overlay.png")}
                    className="px-3 py-2 rounded-full text-xs font-bold uppercase border border-slate-300"
                  >
                    Download overlay
                  </button>
                </div>

                <div className="text-xs text-slate-500">
                  {result.image_size.width}×{result.image_size.height} · {result.inference_seconds}s ·{" "}
                  {result.device} · {result.model_id}
                </div>

                <div>
                  <h3 className="text-xs font-black uppercase tracking-wide text-slate-600 mb-2">
                    Detected classes
                  </h3>
                  <ul className="space-y-1.5 max-h-56 overflow-auto pr-1">
                    {result.detections.length === 0 && (
                      <li className="text-sm text-slate-400">No fashion classes above threshold.</li>
                    )}
                    {result.detections.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-3 text-sm border-b border-slate-100 py-1.5"
                      >
                        <span className="font-medium text-slate-700">{d.label}</span>
                        <span className="text-slate-500 tabular-nums">{d.percent}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
