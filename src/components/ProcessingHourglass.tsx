"use client";

// Resolves once the browser has drawn the next frame. The garment model runs on the page's own thread
// and holds it until it's done, so heavy work waits for this first, or the hourglass never shows up.
export function waitForPaint(): Promise<void> {
  // (A hidden tab draws no frames, so it goes ahead after a moment regardless)
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 100);
    requestAnimationFrame(() => setTimeout(() => {
      clearTimeout(fallback);
      resolve();
    }, 0));
  });
}

// A turning hourglass over a picture while the computer works on it (detecting garments, fitting one,
// loading the models). It lies over its positioned parent and lets clicks through to what's underneath.
export default function ProcessingHourglass({ message, dim = true }: { message: string; dim?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: dim ? "rgba(15, 23, 42, 0.35)" : "transparent",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
          maxWidth: "80%",
          padding: "14px 20px",
          borderRadius: "12px",
          background: "rgba(17, 24, 39, 0.85)",
          color: "#f8fafc",
          fontSize: "13px",
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        <span className="animate-spin" style={{ display: "inline-block", fontSize: "32px", lineHeight: 1 }}>
          ⏳
        </span>
        {message}
      </div>
    </div>
  );
}
