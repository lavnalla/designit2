"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Scroll bars for an area that's scrolled on a phone or tablet, where a finger drag on the area itself is taken
// for drawing (it can't scroll it) and the browser shows no scroll bars of its own: a bar along the right and
// one along the bottom, each with a handle to drag and a track to tap. Shown on touch screens and narrow windows,
// where there's more to see that way.
// They're laid over the part of the area actually on screen: the browser's visible viewport (pinch-zoomed in,
// or above a phone's toolbars), not the whole page, and kept the same size on screen however far it's zoomed.
// They're put straight on the page (not inside the area's own layout), so nothing fixed to the screen elsewhere,
// like a banner along the bottom, can cover them.

// How thick a bar looks, how wide the strip round it that a finger can catch, and how far in from the edge (px
// on screen)
const BAR = 8;
const GRIP = 28;
const INSET = 2;
// The smallest a handle gets (px on screen), so it can still be grabbed
const MIN_HANDLE = 36;

type Metrics = {
  // The visible part of the area (page coordinates), and how many page pixels make one on screen
  left: number;
  top: number;
  width: number;
  height: number;
  unit: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
};

// Touch screens and narrow windows: where these bars are wanted
export const SCROLLBAR_SCREENS = "(pointer: coarse), (max-width: 1023px)";

export default function MobileScrollbars({ target }: { target: RefObject<HTMLElement | null> }) {
  const [m, setM] = useState<Metrics | null>(null);
  const drag = useRef<{ axis: "x" | "y"; start: number; startScroll: number; perPixel: number } | null>(null);

  // Kept up to date as the area scrolls or resizes, the page is zoomed or its toolbars come and go, and what's in
  // the area grows (checked a few times a second)
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const measure = () => {
      if (!window.matchMedia(SCROLLBAR_SCREENS).matches) {
        setM(null);
        return;
      }
      // What's on screen of the page: the visual viewport (zoomed in, it's a part of the page, offset)
      const vv = window.visualViewport;
      const viewLeft = vv ? vv.offsetLeft : 0;
      const viewTop = vv ? vv.offsetTop : 0;
      const viewRight = viewLeft + (vv ? vv.width : window.innerWidth);
      const viewBottom = viewTop + (vv ? vv.height : window.innerHeight);
      const rect = el.getBoundingClientRect();
      const left = Math.max(viewLeft, rect.left);
      const top = Math.max(viewTop, rect.top);
      const right = Math.min(viewRight, rect.right);
      const bottom = Math.min(viewBottom, rect.bottom);
      setM({
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        unit: 1 / (vv?.scale || 1),
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
      });
    };
    const first = requestAnimationFrame(measure);
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const timer = window.setInterval(measure, 400);
    return () => {
      cancelAnimationFrame(first);
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [target]);

  if (!m || m.width < 40 || m.height < 40) return null;
  const across = m.scrollWidth > m.clientWidth + 1;
  const down = m.scrollHeight > m.clientHeight + 1;
  if (!across && !down) return null;

  // Sizes in page pixels (the same on screen however far it's zoomed)
  const bar = BAR * m.unit;
  const grip = GRIP * m.unit;
  const inset = INSET * m.unit;
  const minHandle = MIN_HANDLE * m.unit;
  // Each bar's track, and its handle's size and place along it
  const trackX = m.width - inset * 2 - (down ? grip : 0);
  const trackY = m.height - inset * 2 - (across ? grip : 0);
  const handleX = Math.min(trackX, Math.max(minHandle, (trackX * m.clientWidth) / m.scrollWidth));
  const handleY = Math.min(trackY, Math.max(minHandle, (trackY * m.clientHeight) / m.scrollHeight));
  const roomX = Math.max(1, m.scrollWidth - m.clientWidth);
  const roomY = Math.max(1, m.scrollHeight - m.clientHeight);
  const atX = ((trackX - handleX) * m.scrollLeft) / roomX;
  const atY = ((trackY - handleY) * m.scrollTop) / roomY;

  const startDrag = (axis: "x" | "y") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current =
      axis === "x"
        ? { axis, start: e.clientX, startScroll: m.scrollLeft, perPixel: roomX / Math.max(1, trackX - handleX) }
        : { axis, start: e.clientY, startScroll: m.scrollTop, perPixel: roomY / Math.max(1, trackY - handleY) };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = target.current;
    if (!d || !el) return;
    e.stopPropagation();
    if (d.axis === "x") el.scrollTo({ left: d.startScroll + (e.clientX - d.start) * d.perPixel });
    else el.scrollTo({ top: d.startScroll + (e.clientY - d.start) * d.perPixel });
  };
  const endDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = null;
  };
  // A tap on the track (not the handle) jumps a screenful toward it
  const jump = (axis: "x" | "y") => (e: React.PointerEvent) => {
    const el = target.current;
    if (!el || e.target !== e.currentTarget) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (axis === "x") el.scrollBy({ left: (e.clientX - rect.left < atX ? -1 : 1) * m.clientWidth * 0.9 });
    else el.scrollBy({ top: (e.clientY - rect.top < atY ? -1 : 1) * m.clientHeight * 0.9 });
  };

  // A bar: a strip a finger can catch (see-through), with the thin track drawn along its middle and the handle
  // (its own catchable strip, a thin knob drawn in it) on top
  const strip = "fixed z-[10000] touch-none";
  const rail = "pointer-events-none absolute rounded-full bg-slate-900/15";
  const knob = "pointer-events-none absolute rounded-full bg-slate-600/70";
  const gap = (grip - bar) / 2;
  return createPortal(
    <>
      {across && (
        <div
          className={strip}
          data-scrollbar="across"
          style={{ left: m.left + inset, top: m.top + m.height - grip - inset, width: trackX, height: grip }}
          onPointerDown={jump("x")}
          onClick={(e) => e.stopPropagation()}
          aria-hidden
        >
          <div className={rail} style={{ left: 0, right: 0, top: gap, height: bar }} />
          <div
            className="absolute touch-none"
            style={{ left: atX, top: 0, width: handleX, height: grip }}
            onPointerDown={startDrag("x")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className={knob} style={{ left: 0, right: 0, top: gap, height: bar }} />
          </div>
        </div>
      )}
      {down && (
        <div
          className={strip}
          data-scrollbar="down"
          style={{ left: m.left + m.width - grip - inset, top: m.top + inset, width: grip, height: trackY }}
          onPointerDown={jump("y")}
          onClick={(e) => e.stopPropagation()}
          aria-hidden
        >
          <div className={rail} style={{ top: 0, bottom: 0, left: gap, width: bar }} />
          <div
            className="absolute touch-none"
            style={{ left: 0, top: atY, width: grip, height: handleY }}
            onPointerDown={startDrag("y")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className={knob} style={{ top: 0, bottom: 0, left: gap, width: bar }} />
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
