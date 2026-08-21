(() => {
  const OVERLAY_ID = 'designit-picker-overlay';
  const HIGHLIGHT_ID = 'designit-picker-highlight';
  const LABEL_ID = 'designit-picker-label';
  const TOOLBAR_ID = 'designit-picker-toolbar';
  let active = false;
  let currentTarget = null;
  let selectionStart = null;
  let selectionBox = null;
  let isDraggingSelection = false;
  let mode = 'pick';

  function cleanup() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    document.getElementById(TOOLBAR_ID)?.remove();
    document.removeEventListener('mousemove', handleMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('mousedown', handleMouseDown, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('contextmenu', blockEvent, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    selectionBox?.remove();
    selectionBox = null;
    selectionStart = null;
    isDraggingSelection = false;
    active = false;
    currentTarget = null;
    mode = 'pick';
  }

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function getImageSourceFromElement(element) {
    if (!element) return null;

    if (element instanceof HTMLImageElement) {
      return element.currentSrc || element.src || null;
    }

    const style = window.getComputedStyle(element);
    const backgroundImage = style.backgroundImage;
    const match = backgroundImage.match(/url\(["']?(.*?)["']?\)/i);
    if (match?.[1]) {
      return match[1];
    }

    return null;
  }

  function findImageElement(startElement) {
    let element = startElement;
    while (element && element !== document.body) {
      const src = getImageSourceFromElement(element);
      if (src) {
        return { element, src };
      }
      element = element.parentElement;
    }
    return null;
  }

  function findImageElementAtPoint(clientX, clientY, fallbackTarget) {
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [];

    for (const candidate of stack) {
      const found = findImageElement(candidate);
      if (found?.src) {
        return found;
      }
    }

    return findImageElement(fallbackTarget);
  }

  function ensureUi() {
    if (!document.getElementById(OVERLAY_ID)) {
      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;background:rgba(15,23,42,0.08);cursor:crosshair;';
      document.documentElement.appendChild(overlay);
    }

    if (!document.getElementById(HIGHLIGHT_ID)) {
      const box = document.createElement('div');
      box.id = HIGHLIGHT_ID;
      box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #0ea5e9;background:rgba(14,165,233,0.16);border-radius:12px;box-shadow:0 0 0 9999px rgba(15,23,42,0.12);display:none;';
      document.documentElement.appendChild(box);
    }

    if (!document.getElementById(LABEL_ID)) {
      const label = document.createElement('div');
      label.id = LABEL_ID;
      label.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:320px;border:1px solid rgba(14,165,233,0.35);background:#0f172a;color:#fff;padding:12px 14px;border-radius:14px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 20px 40px rgba(15,23,42,0.35);';
      label.textContent = 'DesignIt picker active. Choose Pick Image or Capture Area. Press Esc to cancel.';
      document.documentElement.appendChild(label);
    }

    if (!document.getElementById(TOOLBAR_ID)) {
      const toolbar = document.createElement('div');
      toolbar.id = TOOLBAR_ID;
      toolbar.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;gap:8px;border:1px solid rgba(148,163,184,0.45);background:rgba(15,23,42,0.96);padding:8px;border-radius:16px;box-shadow:0 20px 40px rgba(15,23,42,0.35);';

      const pickButton = document.createElement('button');
      pickButton.type = 'button';
      pickButton.dataset.mode = 'pick';
      pickButton.textContent = 'Pick Image';
      pickButton.style.cssText = 'border:1px solid rgba(14,165,233,0.4);background:#0ea5e9;color:#fff;padding:8px 12px;border-radius:999px;font:700 12px/1 system-ui,sans-serif;cursor:pointer;';
      pickButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        mode = 'pick';
        syncToolbarMode();
      });

      const captureButton = document.createElement('button');
      captureButton.type = 'button';
      captureButton.dataset.mode = 'capture';
      captureButton.textContent = 'Capture Area';
      captureButton.style.cssText = 'border:1px solid rgba(245,158,11,0.4);background:transparent;color:#f8fafc;padding:8px 12px;border-radius:999px;font:700 12px/1 system-ui,sans-serif;cursor:pointer;';
      captureButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        mode = 'capture';
        syncToolbarMode();
      });

      toolbar.appendChild(pickButton);
      toolbar.appendChild(captureButton);
      document.documentElement.appendChild(toolbar);
    }
  }

  function syncToolbarMode() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      return;
    }

    toolbar.querySelectorAll('button').forEach((button) => {
      const isActive = button.dataset.mode === mode;
      if (button.dataset.mode === 'pick') {
        button.style.background = isActive ? '#0ea5e9' : 'transparent';
        button.style.color = '#ffffff';
      } else {
        button.style.background = isActive ? '#f59e0b' : 'transparent';
        button.style.color = '#ffffff';
      }
    });
  }

  function ensureSelectionBox() {
    if (!selectionBox) {
      selectionBox = document.createElement('div');
      selectionBox.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px dashed #f59e0b;background:rgba(245,158,11,0.18);display:none;';
      document.documentElement.appendChild(selectionBox);
    }
    return selectionBox;
  }

  function updateHighlight(target) {
    if (isDraggingSelection) {
      return;
    }

    const box = document.getElementById(HIGHLIGHT_ID);
    if (!box || !target) {
      return;
    }

    const rect = target.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  function handleMove(event) {
    if (selectionStart) {
      if (mode !== 'capture') {
        return;
      }

      const deltaX = event.clientX - selectionStart.x;
      const deltaY = event.clientY - selectionStart.y;
      isDraggingSelection = isDraggingSelection || Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6;

      if (isDraggingSelection) {
        const box = ensureSelectionBox();
        const left = Math.min(selectionStart.x, event.clientX);
        const top = Math.min(selectionStart.y, event.clientY);
        const width = Math.abs(deltaX);
        const height = Math.abs(deltaY);
        box.style.display = 'block';
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
      }
      return;
    }

    const found = findImageElementAtPoint(event.clientX, event.clientY, event.target);
    currentTarget = found;
    const box = document.getElementById(HIGHLIGHT_ID);
    if (!found) {
      if (box) box.style.display = 'none';
      return;
    }
    updateHighlight(found.element);
  }

  function handleClick(event) {
    if (!active) return;
    if (mode !== 'pick') {
      return;
    }
    if (selectionStart || isDraggingSelection) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const found = findImageElementAtPoint(event.clientX, event.clientY, event.target);
    if (!found?.src) {
      return;
    }

    cleanup();
    chrome.runtime.sendMessage({
      type: 'designit:open-source',
      sourceUrl: found.src,
    });
  }

  function handleMouseDown(event) {
    if (!active || event.button !== 0 || mode !== 'capture') {
      return;
    }

    selectionStart = { x: event.clientX, y: event.clientY };
    isDraggingSelection = false;
    const box = ensureSelectionBox();
    box.style.display = 'block';
    box.style.left = `${event.clientX}px`;
    box.style.top = `${event.clientY}px`;
    box.style.width = '0px';
    box.style.height = '0px';
  }

  function handleMouseUp(event) {
    if (!active || mode !== 'capture' || !selectionStart) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const x = Math.min(selectionStart.x, event.clientX);
    const y = Math.min(selectionStart.y, event.clientY);
    const width = Math.abs(event.clientX - selectionStart.x);
    const height = Math.abs(event.clientY - selectionStart.y);

    const box = selectionBox;
    selectionStart = null;
    if (box) {
      box.style.display = 'none';
    }

    if (width < 24 || height < 24) {
      isDraggingSelection = false;
      return;
    }

    isDraggingSelection = false;
    cleanup();
    chrome.runtime.sendMessage({
      type: 'designit:capture-area',
      crop: {
        x: Math.round(x * window.devicePixelRatio),
        y: Math.round(y * window.devicePixelRatio),
        width: Math.round(width * window.devicePixelRatio),
        height: Math.round(height * window.devicePixelRatio),
      },
    });
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      cleanup();
    }
  }

  function startPicker(startMode = 'pick') {
    cleanup();
    active = true;
    mode = startMode === 'capture' ? 'capture' : 'pick';
    ensureUi();
    syncToolbarMode();
    document.addEventListener('mousemove', handleMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('contextmenu', blockEvent, true);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'designit:start-picker') {
      startPicker(message.mode);
    }
  });
})();
