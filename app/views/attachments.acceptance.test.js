import { describe, expect, test, vi } from 'vitest';
import { createDetailView } from './detail.js';

const DIR = 'attachments/fix-bui-a1';

/**
 * @param {string} path
 * @param {Partial<import('../protocol.js').AttachmentRow>} [extra]
 * @returns {import('../protocol.js').AttachmentRow}
 */
function row(path, extra = {}) {
  return {
    path,
    abs_path: '/ws/' + path,
    bytes: 100,
    mime: 'image/png',
    source: 'fix-folder',
    missing: false,
    ...extra
  };
}

/**
 * @param {Record<string, any>} issues - Issue per id for `detail:<id>`.
 */
function makeStores(issues) {
  /** @type {Array<(client_id?: string) => void>} */
  const listeners = [];
  return {
    issues,
    /** @param {string} client_id */
    snapshotFor(client_id) {
      const issue = issues[client_id.replace('detail:', '')];
      return issue ? [issue] : [];
    },
    /** @param {(client_id?: string) => void} fn */
    subscribe(fn) {
      listeners.push(fn);
      return () => {};
    },
    /** @param {string} id */
    push(id) {
      for (const fn of listeners) fn('detail:' + id);
    }
  };
}

/**
 * @param {(payload: { id: string }) => unknown} listing
 */
function setup(listing) {
  document.body.innerHTML = '<section><div id="mount"></div></section>';
  const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
  /** @type {Array<{ type: string, payload: any }>} */
  const calls = [];
  const stores = makeStores({
    'bui-a1': { id: 'bui-a1', title: 'A', status: 'open', updated_at: 1 },
    'bui-b2': { id: 'bui-b2', title: 'B', status: 'open', updated_at: 1 }
  });
  const view = createDetailView(
    mount,
    /** @type {any} */ (
      async (/** @type {string} */ type, /** @type {any} */ payload) => {
        calls.push({ type, payload });
        if (type === 'list-attachments') return listing(payload);
        return [];
      }
    ),
    undefined,
    stores
  );
  const listCalls = () => calls.filter((c) => c.type === 'list-attachments');
  return { mount, view, stores, listCalls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('attachments in the detail view', () => {
  test('S1 / BR-BUI-001-1: three rows give three tiles before the comments', async () => {
    const { mount, view } = setup(() => [
      row(`${DIR}/login.png`),
      row(`${DIR}/trace.log`, { mime: 'text/plain' }),
      row('attachments/spec/flow.png', { source: 'referenced' })
    ]);
    await view.load('bui-a1');
    await flush();
    expect(
      mount.querySelectorAll('[data-testid="attachment-tile"]')
    ).toHaveLength(3);
    expect(
      mount
        .querySelector('[data-testid="attachments-title"]')
        ?.textContent?.trim()
    ).toBe('Attachments (3)');
    const section = /** @type {Node} */ (
      mount.querySelector('[data-testid="attachments"]')
    );
    const comments = /** @type {Node} */ (mount.querySelector('.comments'));
    expect(
      section.compareDocumentPosition(comments) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test('S10: an empty listing shows No attachments.', async () => {
    const { mount, view } = setup(() => []);
    await view.load('bui-a1');
    await flush();
    expect(mount.textContent).toContain('No attachments.');
  });

  test('S11 / EX2: a failed listing shows the message and Retry lists again', async () => {
    let n = 0;
    const { mount, view, listCalls } = setup(() => {
      n++;
      if (n === 1) {
        throw { code: 'bd_error', message: 'database locked' };
      }
      return [row(`${DIR}/login.png`)];
    });
    await view.load('bui-a1');
    await flush();
    expect(mount.textContent).toContain(
      'Could not list attachments: database locked'
    );
    const retry = /** @type {HTMLButtonElement} */ (
      Array.from(mount.querySelectorAll('[role="alert"] button')).find(
        (b) => b.textContent?.trim() === 'Retry'
      )
    );
    retry.click();
    await flush();
    expect(listCalls()).toHaveLength(2);
    expect(
      mount.querySelectorAll('[data-testid="attachment-tile"]')
    ).toHaveLength(1);
  });

  test('S12 / EX1: attachments_unavailable shows the bdw message', async () => {
    const { mount, view } = setup(() => {
      throw { code: 'attachments_unavailable', message: 'not a hub' };
    });
    await view.load('bui-a1');
    await flush();
    expect(mount.textContent).toContain(
      'Attachments need bdw in a hub workspace.'
    );
    expect(mount.textContent).not.toContain('Could not list attachments');
  });

  test('S11: a reply that is not a list shows the error state', async () => {
    const { mount, view } = setup(() => ({}));
    await view.load('bui-a1');
    await flush();
    expect(mount.textContent).toContain(
      'Could not list attachments: unexpected reply'
    );
    expect(mount.querySelector('[data-testid="attachment-tile"]')).toBeNull();
  });

  test('BR-BUI-001-6: load lists again; a push lists again only when updated_at changes', async () => {
    const { view, stores, listCalls } = setup(() => []);
    await view.load('bui-a1');
    await flush();
    expect(listCalls()).toHaveLength(1);
    await view.load('bui-a1');
    await flush();
    expect(listCalls()).toHaveLength(2);

    stores.push('bui-a1');
    await flush();
    expect(listCalls()).toHaveLength(2);

    stores.issues['bui-a1'] = { ...stores.issues['bui-a1'], updated_at: 2 };
    stores.push('bui-a1');
    await flush();
    expect(listCalls()).toHaveLength(3);
    expect(listCalls()[2].payload).toEqual({ id: 'bui-a1' });
  });

  test('BR-BUI-001-6: a slow reply for the first issue is dropped after another load', async () => {
    /** @type {Array<(rows: unknown) => void>} */
    const resolvers = [];
    const { mount, view } = setup(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    void view.load('bui-a1');
    await flush();
    void view.load('bui-b2');
    await flush();
    resolvers[0]([row(`${DIR}/stale.png`)]);
    await flush();
    expect(mount.querySelector('[data-testid="attachment-tile"]')).toBeNull();
    expect(mount.textContent).toContain('Loading attachments…');
    resolvers[1]([row('attachments/fix-bui-b2/fresh.png')]);
    await flush();
    const tiles = mount.querySelectorAll('[data-testid="attachment-tile"]');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].getAttribute('data-path')).toBe(
      'attachments/fix-bui-b2/fresh.png'
    );
  });

  test('EX4: an image that fails to load turns into the broken-file marker', async () => {
    const { mount, view } = setup(() => [row(`${DIR}/login.png`)]);
    await view.load('bui-a1');
    await flush();
    mount
      .querySelector('[data-testid="attachment-tile"] img')
      ?.dispatchEvent(new Event('error'));
    await flush();
    const tile = mount.querySelector('[data-testid="attachment-tile"]');
    expect(
      tile?.querySelector('[data-testid="attachment-missing"]')
    ).toBeTruthy();
    expect(tile?.querySelector('img')).toBeNull();
  });

  test('S2: clicking an image tile opens the viewer; Escape closes only the viewer', async () => {
    const { mount, view } = setup(() => [
      row(`${DIR}/login.png`),
      row(`${DIR}/trace.log`, { mime: 'text/plain' })
    ]);
    const parent = document.createElement('dialog');
    parent.setAttribute('open', '');
    document.body.append(parent);
    parent.append(mount);
    const parent_cancel = vi.fn();
    parent.addEventListener('cancel', parent_cancel);
    await view.load('bui-a1');
    await flush();
    const tile = /** @type {HTMLElement} */ (
      mount.querySelector('[data-path$="login.png"] button')
    );
    tile.click();
    const viewer = document.querySelector('[data-testid="attachment-viewer"]');
    expect(viewer).toBeTruthy();
    expect(
      document.querySelector('[data-testid="attachment-viewer-path"]')
        ?.textContent
    ).toContain(`${DIR}/login.png`);
    viewer?.dispatchEvent(
      new Event('cancel', { bubbles: true, cancelable: true })
    );
    expect(
      document.querySelector('[data-testid="attachment-viewer"]')
    ).toBeNull();
    expect(parent_cancel).not.toHaveBeenCalled();
    expect(parent.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(tile);
  });

  test('S3 / D-02: from Before, Next twice reaches the image tile', async () => {
    const { mount, view } = setup(() => [
      row(`${DIR}/login.png`),
      row(`${DIR}/before.png`),
      row(`${DIR}/after.png`)
    ]);
    await view.load('bui-a1');
    await flush();
    const first = /** @type {HTMLElement} */ (
      mount.querySelector('.attachment-pair figure button')
    );
    first.click();
    const path = () =>
      document.querySelector('[data-testid="attachment-viewer-path"]')
        ?.textContent ?? '';
    expect(path()).toContain('before.png');
    document
      .querySelector('[data-testid="attachment-viewer"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    expect(path()).toContain('after.png');
    document
      .querySelector('[data-testid="attachment-viewer"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    expect(path()).toContain('login.png');
  });
});
