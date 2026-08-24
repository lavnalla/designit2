"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

type AdSlotProps = {
  slot: string;
  format?: "auto" | "rectangle" | "horizontal" | "vertical";
  className?: string;
  style?: React.CSSProperties;
};

export default function AdSlot({ slot, format = "auto", className, style }: AdSlotProps) {
  const adRef = useRef<HTMLElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  if (!process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT || !slot) {
    return null;
  }

  useEffect(() => {
    const adElement = adRef.current;

    if (!adElement) {
      return;
    }

    const updateReadiness = () => {
      setIsReady(adElement.offsetWidth > 0);
    };

    updateReadiness();

    const resizeObserver = new ResizeObserver(() => {
      updateReadiness();
    });

    resizeObserver.observe(adElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const adElement = adRef.current;

    if (!isReady || !adElement || adElement.getAttribute("data-adsbygoogle-status")) {
      return;
    }

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ignore repeated init failures during hydration or local development.
    }
  }, [isReady]);

  return (
    <ins
      ref={adRef}
      className={`adsbygoogle ${className ?? ""}`.trim()}
      style={{ display: "block", ...style }}
      data-ad-client={process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  );
}