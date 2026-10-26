// Runs photoTryOn off the main thread: receives both photos' parses, posts back the result (or an error)

import { tryOnGarment, type PhotoParse } from "./photoTryOn";

self.onmessage = (e: MessageEvent<{ person: PhotoParse; garment: PhotoParse }>) => {
  try {
    const { image, report } = tryOnGarment(e.data.person, e.data.garment);
    (self as unknown as Worker).postMessage({ image, report }, [image.data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
