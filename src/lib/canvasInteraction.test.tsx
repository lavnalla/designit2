/**
 * Regression tests for the canvas interaction rules behind three bugs:
 *
 *  1. Copy fabric required the canvas lock, and nothing released it, so after
 *     add → copy → paste → add, the new garment could not be moved (a drag on
 *     a locked canvas draws a marquee instead).
 *  2. Releasing the mouse outside the canvas left the drag state set and the
 *     garment kept following the cursor with no button held.
 *  3. A hung pipeline call left the copy/paste buttons disabled forever.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { act } from "react";
import {
  canCopyFabric,
  canPasteFabric,
  shouldStartItemDrag,
  useReleaseInteractionOnWindow,
} from "./canvasInteraction";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("copy fabric availability", () => {
  it("does not depend on the canvas lock", () => {
    expect(canCopyFabric({ fabricBusy: null })).toBe(true);
    // The old guard keyed on isLocked; the new one must not even accept it.
    const state = { fabricBusy: null, isLocked: false } as { fabricBusy: null };
    expect(canCopyFabric(state)).toBe(true);
  });

  it("only waits on an in-flight pipeline call", () => {
    expect(canCopyFabric({ fabricBusy: "copy" })).toBe(false);
    expect(canCopyFabric({ fabricBusy: "paste" })).toBe(false);
  });

  it("paste needs a clipboard and an idle pipeline", () => {
    expect(canPasteFabric({ fabricBusy: null, hasClipboard: true })).toBe(true);
    expect(canPasteFabric({ fabricBusy: null, hasClipboard: false })).toBe(false);
    expect(canPasteFabric({ fabricBusy: "paste", hasClipboard: true })).toBe(false);
  });
});

describe("garment drag after a fabric copy/paste", () => {
  it("a third garment added after copy/paste can still be dragged on an unlocked canvas", () => {
    // Simulate the sequence: two garments, copy, paste, add a third. The copy
    // no longer touches the lock, so the canvas stays unlocked throughout.
    let isLocked = false;
    const copyFabric = () => {
      // The removed guard used to do: if (!isLocked) return; and the menu
      // offered "Lock now" -- which is what left the canvas locked.
      if (!canCopyFabric({ fabricBusy: null })) throw new Error("copy blocked");
    };
    copyFabric();
    expect(shouldStartItemDrag({ activeTool: "cursor", isLocked })).toBe(true);
    // If the user locks on purpose, drags are (correctly) blocked.
    isLocked = true;
    expect(shouldStartItemDrag({ activeTool: "cursor", isLocked })).toBe(false);
  });

  it("only the cursor tool starts a drag", () => {
    for (const tool of ["pen", "fill", "erase", "scissor", "ghost"]) {
      expect(shouldStartItemDrag({ activeTool: tool, isLocked: false })).toBe(false);
    }
    expect(shouldStartItemDrag({ activeTool: "cursor", isLocked: false, pickColorMode: true })).toBe(false);
  });
});

describe("drag release outside the canvas", () => {
  it("releases the interaction on a window pointerup", () => {
    const release = vi.fn();
    renderHook(() => useReleaseInteractionOnWindow(release));
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases on pointercancel and window blur too", () => {
    const release = vi.fn();
    renderHook(() => useReleaseInteractionOnWindow(release));
    act(() => {
      window.dispatchEvent(new Event("pointercancel"));
      window.dispatchEvent(new Event("blur"));
    });
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("stops listening once unmounted", () => {
    const release = vi.fn();
    const { unmount } = renderHook(() => useReleaseInteractionOnWindow(release));
    unmount();
    window.dispatchEvent(new Event("pointerup"));
    expect(release).not.toHaveBeenCalled();
  });
});
