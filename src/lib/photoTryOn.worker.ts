// Runs photoTryOn off the main thread: receives both photos' parses, posts back the result (or an error).
// Kept running between fits (the webcam's live fit asks for one after another); each answer carries its id.

import { tryOnGarment, type PhotoParse } from "./photoTryOn";

self.onmessage = (e: MessageEvent<{ id: number; person: PhotoParse; garment: PhotoParse }>) => {
  const { id } = e.data;
  try {
    const { image, report } = tryOnGarment(e.data.person, e.data.garment);
    (self as unknown as Worker).postMessage({ id, image, report }, [image.data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
