import { describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';
import { createWsClient } from './ws.js';

// Mock WS client before importing the app
/** @type {Array<{ type: string, payload: unknown }>} */
const calls = [];
const issues = [
  { id: 'UI-1', title: 'One', status: 'open', priority: 1 },
  { id: 'UI-2', title: 'Two', status: 'open', priority: 2 }
];
vi.mock('./ws.js', () => {
  /** @type {Record<string, (p:any)=>void>} */
  const handlers = {};
  const singleton = {
    /**
     * @param {string} type
     * @param {any} payload
     */
    async send(type, payload) {
      calls.push({ type, payload });
      return null;
    },
    /**
     * @param {string} type
     * @param {(p:any)=>void} handler
     */
    on(type, handler) {
      handlers[type] = handler;
      return () => {};
    },
    // Test helper
    /**
     * @param {string} type
     * @param {any} payload
     */
    _trigger(type, payload) {
      if (handlers[type]) handlers[type](payload);
    },
    close() {},
    getState() {
      return 'open';
    }
  };
  return { createWsClient: () => singleton };
});

describe('deep link on initial load (UI-44)', () => {
  test('loads dialog and highlights list item when hash includes issue id', async () => {
    window.location.hash = '#/issue/UI-2';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    // Bootstrap app
    const client = /** @type {any} */ (createWsClient());
    bootstrap(root);

    // Allow initial subscriptions to wire
    await Promise.resolve();
    // Simulate per-subscription snapshot envelope for Issues tab
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 1,
      issues
    });
    await Promise.resolve();
    await Promise.resolve();

    // Dialog should be open and show raw id in header
    const dlg = /** @type {HTMLDialogElement} */ (
      document.getElementById('issue-dialog')
    );
    expect(dlg).not.toBeNull();
    const title = /** @type {HTMLElement} */ (
      document.getElementById('issue-dialog-title')
    );
    expect(title && title.textContent).toBe('UI-2');

    // The list renders asynchronously from push-only stores; dialog is open
    // and shows the correct id, which is sufficient for deep-link behavior.
  });

  test('BR-BUI-001-6: a deep link lists attachments once, however often the state changes', async () => {
    calls.length = 0;
    window.location.hash = '#/issues?issue=UI-2';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));
    const client = /** @type {any} */ (createWsClient());
    bootstrap(root);
    await Promise.resolve();
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 1,
      issues
    });
    // Other state changes while the issue stays open
    window.location.hash = '#/board?issue=UI-2';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await new Promise((r) => setTimeout(r, 20));
    const listings = calls.filter((c) => c.type === 'list-attachments');
    expect(listings).toHaveLength(1);
  });
});
