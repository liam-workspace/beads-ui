import { formatBytes } from './attachments.js';

/** @typedef {import('./attachments.js').ViewerItem} ViewerItem */

/** @type {{ close: () => void } | null} */
let active = null;

/**
 * Open the full-size viewer over the issue dialog. Escape, `Close viewer` and
 * a press on the backdrop close only the viewer; focus returns to `opener`.
 * Exported so other views can open the same viewer.
 *
 * @param {{ items: ViewerItem[], index: number, opener: HTMLElement }} args
 * @returns {{ close: () => void, show: (index: number) => void }}
 */
export function openViewer({ items, index, opener }) {
  if (active) {
    active.close();
  }

  const viewer = document.createElement('dialog');
  viewer.className = 'attachment-viewer';
  viewer.setAttribute('data-testid', 'attachment-viewer');
  viewer.setAttribute('aria-label', 'Attachment viewer');

  const img = document.createElement('img');
  img.setAttribute('data-testid', 'attachment-viewer-image');
  const info = document.createElement('div');
  info.className = 'attachment-viewer__info';
  info.setAttribute('data-testid', 'attachment-viewer-path');

  const bar = document.createElement('div');
  bar.className = 'attachment-viewer__bar';
  /**
   * @param {string} label
   * @param {() => void} onClick
   */
  const button = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  let current = 0;
  /** @param {number} i */
  function show(i) {
    const n = items.length;
    if (n === 0) {
      return;
    }
    current = ((i % n) + n) % n;
    const item = items[current];
    img.src = item.url;
    img.alt = item.path.split('/').pop() || item.path;
    const size = formatBytes(item.bytes);
    info.textContent = size ? `${item.path} · ${size}` : item.path;
  }

  let closed = false;
  function close() {
    if (closed) {
      return;
    }
    closed = true;
    if (active === handle) {
      active = null;
    }
    try {
      if (typeof viewer.close === 'function') {
        viewer.close();
      } else {
        viewer.removeAttribute('open');
      }
    } catch {
      viewer.removeAttribute('open');
    }
    viewer.remove();
    if (opener.isConnected) {
      opener.focus();
    }
  }

  const handle = { close, show };

  bar.append(
    button('Previous', () => show(current - 1)),
    button('Next', () => show(current + 1)),
    button('Close viewer', close)
  );
  viewer.append(img, info, bar);

  viewer.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    close();
  });
  viewer.addEventListener('mousedown', (ev) => {
    ev.stopPropagation();
    if (ev.target === viewer) {
      close();
    }
  });
  viewer.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      ev.stopPropagation();
      show(current + 1);
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      ev.stopPropagation();
      show(current - 1);
    } else if (ev.key === 'Escape') {
      ev.stopPropagation();
    }
  });

  show(index);
  (opener.closest('dialog') ?? document.body).append(viewer);
  if (typeof viewer.showModal === 'function') {
    viewer.showModal();
  } else {
    viewer.setAttribute('open', '');
  }
  active = handle;
  return handle;
}
