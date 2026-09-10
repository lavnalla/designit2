/**
 * Pure rules for the Studio canvas's pointer modes, kept out of Studio.tsx so
 * they can be unit-tested without rendering the 8000-line component.
 *
 * Background: "Copy fabric" used to require the canvas lock, and nothing ever
 * released it, so after a copy/paste every garment added afterwards "could not
 * be moved" -- a drag on a locked canvas draws a marquee instead. These helpers
 * make the two decisions explicit and independent of each other.
 */

import { useEffect } from "react";

export type FabricBusy = null | "copy" | "paste";

/** Copy fabric only waits on an in-flight pipeline call. It never needs the lock. */
export function canCopyFabric(state: { fabricBusy: FabricBusy }): boolean {
  return state.fabricBusy === null;
}

/** Paste needs something on the fabric clipboard and no in-flight pipeline call. */
export function canPasteFabric(state: { fabricBusy: FabricBusy; hasClipboard: boolean }): boolean {
  return state.fabricBusy === null && state.hasClipboard;
}

/**
 * A pointer-down on a shape or stroke starts a move only with the cursor tool
 * on an unlocked canvas. Every other tool falls through to the canvas handler.
 */
export function shouldStartItemDrag(state: { activeTool: string; isLocked: boolean; pickColorMode?: boolean }): boolean {
  return state.activeTool === "cursor" && !state.isLocked && !state.pickColorMode;
}

/**
 * Releasing the mouse outside the canvas never reaches the canvas's own
 * pointer-up handler, so the drag state stayed set and the garment kept
 * following the cursor with no button held. Listening on the window catches
 * the release wherever it lands, and pointercancel/blur cover the pointer
 * being taken away entirely (touch cancelled, window losing focus).
 */
export function useReleaseInteractionOnWindow(release: () => void): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => release();
    window.addEventListener("pointerup", handler);
    window.addEventListener("pointercancel", handler);
    window.addEventListener("blur", handler);
    return () => {
      window.removeEventListener("pointerup", handler);
      window.removeEventListener("pointercancel", handler);
      window.removeEventListener("blur", handler);
    };
  }, [release]);
}
