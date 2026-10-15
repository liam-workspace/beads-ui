import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openViewer } from './attachment-viewer.js';

const ITEMS = [
  {
    path: 'attachments/fix-x/a.png',
    url: '/api/attachments/x?path=a',
    bytes: 2048
  },
  {
    path: 'attachments/fix-x/b.png',
    url: '/api/attachments/x?path=b',
    bytes: null
  },
  {
    path: 'attachments/fix-x/c.png',
    url: '/api/attachments/x?path=c',
    bytes: 5
  }
];

/** @returns {{ parent: HTMLDialogElement, opener: HTMLButtonElement }} */
function mountParent() {
  document.body.innerHTML =
    '<dialog id="parent" open><button id="opener" type="button">o</button></dialog>';
  return {
    parent: /** @type {HTMLDialogElement} */ (
      document.getElementById('parent')
    ),
    opener: /** @type {HTMLButtonElement} */ (document.getElementById('opener'))
  };
}

const viewerEl = () =>
  document.querySelector('[data-testid="attachment-viewer"]');
const pathText = () =>
  document.querySelector('[data-testid="attachment-viewer-path"]')
    ?.textContent ?? '';

/** @param {string} name */
function click(name) {
  const b = Array.from(
    document.querySelectorAll('.attachment-viewer button')
  ).find((x) => x.textContent === name);
  /** @type {HTMLButtonElement} */ (b).click();
}

/** @param {string} key */
function press(key) {
  viewerEl()?.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  );
}

describe('attachment viewer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('S2: opens with the item url and path, inside the parent dialog', () => {
    const { parent, opener } = mountParent();
    openViewer({ items: ITEMS, index: 0, opener });
    const img = /** @type {HTMLImageElement} */ (
      document.querySelector('[data-testid="attachment-viewer-image"]')
    );
    expect(img.getAttribute('src')).toBe(ITEMS[0].url);
    expect(pathText()).toContain('attachments/fix-x/a.png');
    expect(pathText()).toContain('2.0 KB');
    expect(viewerEl()?.parentElement).toBe(parent);
  });

  test('S2: Close viewer removes it and focuses the opener', () => {
    const { opener } = mountParent();
    openViewer({ items: ITEMS, index: 0, opener });
    click('Close viewer');
    expect(viewerEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test('S9: arrow keys move and wrap', () => {
    const { opener } = mountParent();
    openViewer({ items: ITEMS, index: 0, opener });
    press('ArrowRight');
    expect(pathText()).toContain('b.png');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(pathText()).toContain('c.png');
  });

  test('S9: Next and Previous buttons move and wrap', () => {
    const { opener } = mountParent();
    openViewer({ items: ITEMS, index: 2, opener });
    click('Next');
    expect(pathText()).toContain('a.png');
    click('Previous');
    expect(pathText()).toContain('c.png');
  });

  test('D-03: cancel closes only the viewer and does not reach the parent', () => {
    const { parent, opener } = mountParent();
    const seen = vi.fn();
    parent.addEventListener('cancel', seen);
    openViewer({ items: ITEMS, index: 0, opener });
    viewerEl()?.dispatchEvent(
      new Event('cancel', { bubbles: true, cancelable: true })
    );
    expect(viewerEl()).toBeNull();
    expect(seen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  test('D-03: a backdrop mousedown closes only the viewer; a press inside does not close it', () => {
    const { parent, opener } = mountParent();
    const seen = vi.fn();
    parent.addEventListener('mousedown', seen);
    openViewer({ items: ITEMS, index: 0, opener });
    const img = document.querySelector(
      '[data-testid="attachment-viewer-image"]'
    );
    img?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(viewerEl()).not.toBeNull();
    viewerEl()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(viewerEl()).toBeNull();
    expect(seen).not.toHaveBeenCalled();
  });

  test('D-03: Escape keydown does not reach the parent', () => {
    const { parent, opener } = mountParent();
    const seen = vi.fn();
    parent.addEventListener('keydown', seen);
    openViewer({ items: ITEMS, index: 0, opener });
    press('Escape');
    press('ArrowRight');
    expect(seen).not.toHaveBeenCalled();
  });

  test('S2: opening again replaces the previous viewer', () => {
    const { opener } = mountParent();
    openViewer({ items: ITEMS, index: 0, opener });
    openViewer({ items: ITEMS, index: 1, opener });
    expect(
      document.querySelectorAll('[data-testid="attachment-viewer"]')
    ).toHaveLength(1);
    expect(pathText()).toContain('b.png');
  });
});
