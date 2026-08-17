const MENU_ID = "open-in-designit";
const PICKER_MENU_ID = "pick-image-for-designit";
const STUDIO_URL = "https://idesignits.com/studio";

function openStudioWithSource(sourceUrl) {
  if (!sourceUrl) {
    return;
  }

  const url = `${STUDIO_URL}?source=${encodeURIComponent(sourceUrl)}`;
  chrome.tabs.create({ url });
}

function cropCapturedArea(dataUrl, crop) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = new OffscreenCanvas(Math.max(1, crop.width), Math.max(1, crop.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }

      ctx.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );

      canvas.convertToBlob({ type: 'image/png' })
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('Failed to read cropped blob'));
          reader.readAsDataURL(blob);
        })
        .catch(reject);
    };
    image.onerror = () => reject(new Error('Failed to decode captured tab image'));
    image.src = dataUrl;
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Open in DesignIt",
    contexts: ["image"],
  });

  chrome.contextMenus.create({
    id: PICKER_MENU_ID,
    title: "Pick image for DesignIt",
    contexts: ["page", "selection", "link", "image"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID && info.srcUrl) {
    openStudioWithSource(info.srcUrl);
    return;
  }

  if (info.menuItemId === PICKER_MENU_ID && info.pageUrl) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        return;
      }

      chrome.tabs.sendMessage(tabId, { type: "designit:start-picker", mode: "pick" });
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "designit:start-picker", mode: "capture" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "designit:open-source" || !message.sourceUrl) {
    if (message?.type === 'designit:capture-area' && message.crop) {
      chrome.tabs.captureVisibleTab(undefined, { format: 'png' }, async (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          return;
        }

        try {
          const croppedDataUrl = await cropCapturedArea(dataUrl, message.crop);
          openStudioWithSource(croppedDataUrl);
        } catch {
          // Ignore capture failures silently for now.
        }
      });
    }
    return;
  }

  openStudioWithSource(message.sourceUrl);
});
