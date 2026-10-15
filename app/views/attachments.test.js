import { render } from 'lit-html';
import { describe, expect, test, vi } from 'vitest';
import {
  IMAGE_MIMES,
  arrangeAttachments,
  attachmentUrl,
  attachmentsTemplate,
  fileName,
  formatBytes,
  isImageMime,
  viewerItems
} from './attachments.js';

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
    bytes: 2048,
    mime: 'image/png',
    source: 'fix-folder',
    missing: false,
    ...extra
  };
}

/**
 * @param {import('./attachments.js').AttachmentsState} state
 * @param {Partial<Parameters<typeof attachmentsTemplate>[2]>} [handlers]
 */
function mountTemplate(state, handlers = {}) {
  const el = document.createElement('div');
  document.body.append(el);
  const h = {
    onRetry: vi.fn(),
    onOpen: vi.fn(),
    onImageError: vi.fn(),
    ...handlers
  };
  render(attachmentsTemplate(state, 'bui-a1', h), el);
  return { el, h };
}

/** @param {import('../protocol.js').AttachmentRow[]} rows */
function ready(rows) {
  return {
    status: /** @type {const} */ ('ready'),
    rows,
    message: '',
    failed: new Set(/** @type {string[]} */ ([]))
  };
}

describe('attachment rules', () => {
  test('BR-BUI-001-3: four image mimes are images, SVG is not', () => {
    expect([...IMAGE_MIMES]).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp'
    ]);
    for (const m of IMAGE_MIMES) {
      expect(isImageMime(m)).toBe(true);
    }
    expect(isImageMime('image/svg+xml')).toBe(false);
    expect(isImageMime('text/plain')).toBe(false);
  });

  test('UI1: attachmentUrl encodes the id and the path', () => {
    expect(attachmentUrl('bui-a1', 'attachments/fix a/é&.png')).toBe(
      '/api/attachments/bui-a1?path=attachments%2Ffix%20a%2F%C3%A9%26.png'
    );
    expect(attachmentUrl('a/b', 'x')).toBe('/api/attachments/a%2Fb?path=x');
  });

  test('UI1: fileName is the last segment', () => {
    expect(fileName('attachments/fix-bui-a1/login.png')).toBe('login.png');
    expect(fileName('login.png')).toBe('login.png');
  });

  test('S13: formatBytes at the unit edges', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  test('S3 / BR-BUI-001-4: before and after form the pair and are not tiles', () => {
    const rows = [
      row(`${DIR}/before.png`),
      row(`${DIR}/other.png`),
      row(`${DIR}/after.png`)
    ];
    const a = arrangeAttachments(rows, 'bui-a1');
    expect(a.pair?.before.path).toBe(`${DIR}/before.png`);
    expect(a.pair?.after.path).toBe(`${DIR}/after.png`);
    expect(a.tiles.map((t) => t.row.path)).toEqual([`${DIR}/other.png`]);
  });

  test("S3: another issue's fix folder does not pair", () => {
    const rows = [
      row('attachments/fix-bui-b2/before.png'),
      row('attachments/fix-bui-b2/after.png')
    ];
    const a = arrangeAttachments(rows, 'bui-a1');
    expect(a.pair).toBeNull();
    expect(a.tiles).toHaveLength(2);
  });

  test('S4: before only, or a missing after, gives no pair and keeps order', () => {
    const only = arrangeAttachments(
      [row(`${DIR}/before.png`), row(`${DIR}/z.png`)],
      'bui-a1'
    );
    expect(only.pair).toBeNull();
    expect(only.tiles.map((t) => t.row.path)).toEqual([
      `${DIR}/before.png`,
      `${DIR}/z.png`
    ]);
    const gone = arrangeAttachments(
      [row(`${DIR}/before.png`), row(`${DIR}/after.png`, { missing: true })],
      'bui-a1'
    );
    expect(gone.pair).toBeNull();
    expect(gone.tiles.map((t) => t.kind)).toEqual(['image', 'missing']);
  });

  test('S14: an SVG row is a file tile', () => {
    const a = arrangeAttachments(
      [row(`${DIR}/chart.svg`, { mime: 'image/svg+xml' })],
      'bui-a1'
    );
    expect(a.tiles[0].kind).toBe('file');
  });

  test('S9 / D-02: viewerItems order Before, After, images; skips files and missing', () => {
    const rows = [
      row(`${DIR}/one.png`),
      row(`${DIR}/trace.log`, { mime: 'text/plain' }),
      row(`${DIR}/after.png`),
      row(`${DIR}/gone.png`, { missing: true }),
      row(`${DIR}/before.png`),
      row(`${DIR}/two.png`)
    ];
    const items = viewerItems(arrangeAttachments(rows, 'bui-a1'), 'bui-a1');
    expect(items.map((i) => fileName(i.path))).toEqual([
      'before.png',
      'after.png',
      'one.png',
      'two.png'
    ]);
    expect(items[0].url).toBe(attachmentUrl('bui-a1', `${DIR}/before.png`));
  });

  test('EX4: a failed path becomes a marker and leaves the viewer sequence', () => {
    const rows = [row(`${DIR}/a.png`), row(`${DIR}/b.png`)];
    const failed = new Set([`${DIR}/a.png`]);
    const a = arrangeAttachments(rows, 'bui-a1', failed);
    expect(a.tiles.map((t) => t.kind)).toEqual(['missing', 'image']);
    expect(viewerItems(a, 'bui-a1').map((i) => fileName(i.path))).toEqual([
      'b.png'
    ]);
  });
});

describe('attachments template', () => {
  test('S1 / BR-BUI-001-1: three rows give three tiles and the count title', () => {
    const { el } = mountTemplate(
      ready([
        row(`${DIR}/login.png`),
        row(`${DIR}/trace.log`, { mime: 'text/plain' }),
        row('attachments/spec/flow.png')
      ])
    );
    const tiles = el.querySelectorAll('[data-testid="attachment-tile"]');
    expect(Array.from(tiles).map((t) => t.getAttribute('data-path'))).toEqual([
      `${DIR}/login.png`,
      `${DIR}/trace.log`,
      'attachments/spec/flow.png'
    ]);
    expect(
      el.querySelector('[data-testid="attachments-title"]')?.textContent?.trim()
    ).toBe('Attachments (3)');
  });

  test('S3: the pair shows Before then After', () => {
    const { el } = mountTemplate(
      ready([row(`${DIR}/after.png`), row(`${DIR}/before.png`)])
    );
    const pair = el.querySelector('[data-testid="attachment-pair"]');
    expect(
      Array.from(pair?.querySelectorAll('figcaption') ?? []).map(
        (c) => c.textContent
      )
    ).toEqual(['Before', 'After']);
    expect(el.querySelectorAll('[data-testid="attachment-tile"]')).toHaveLength(
      0
    );
  });

  test('S8 / BR-BUI-001-5: a missing row is a marker with no src and no href', () => {
    const { el } = mountTemplate(
      ready([row(`${DIR}/gone.png`, { missing: true, bytes: null })])
    );
    const tile = el.querySelector('[data-testid="attachment-tile"]');
    expect(
      tile?.querySelector('[data-testid="attachment-missing"]')
    ).toBeTruthy();
    expect(tile?.textContent).toContain('File not found');
    expect(tile?.textContent).toContain(`${DIR}/gone.png`);
    expect(tile?.querySelector('[src],[href]')).toBeNull();
  });

  test('S14 / BR-BUI-001-3: an SVG is a download link without an image', () => {
    const { el } = mountTemplate(
      ready([row(`${DIR}/chart.svg`, { mime: 'image/svg+xml' })])
    );
    const tile = el.querySelector('[data-testid="attachment-tile"]');
    expect(tile?.querySelector('img')).toBeNull();
    const a = tile?.querySelector('a');
    expect(a?.getAttribute('href')).toBe(
      attachmentUrl('bui-a1', `${DIR}/chart.svg`)
    );
    expect(a?.getAttribute('download')).toBe('chart.svg');
  });

  test('S13: a log file is a download link with its size', () => {
    const { el } = mountTemplate(
      ready([row(`${DIR}/trace.log`, { mime: 'text/plain', bytes: 1536 })])
    );
    const a = el.querySelector('[data-testid="attachment-tile"] a');
    expect(a?.getAttribute('download')).toBe('trace.log');
    expect(a?.textContent).toContain('1.5 KB');
  });

  test('S2: clicking an image tile opens at its index in the viewer sequence', () => {
    const { el, h } = mountTemplate(
      ready([
        row(`${DIR}/trace.log`, { mime: 'text/plain' }),
        row(`${DIR}/a.png`),
        row(`${DIR}/b.png`)
      ])
    );
    const buttons = el.querySelectorAll(
      '[data-testid="attachment-tile"] button'
    );
    /** @type {HTMLElement} */ (buttons[1]).click();
    expect(h.onOpen).toHaveBeenCalledWith(1, buttons[1]);
  });

  test('EX4: an image error reports the path', () => {
    const { el, h } = mountTemplate(ready([row(`${DIR}/a.png`)]));
    el.querySelector('img')?.dispatchEvent(new Event('error'));
    expect(h.onImageError).toHaveBeenCalledWith(`${DIR}/a.png`);
  });

  test('S10: no rows shows the empty line', () => {
    const { el } = mountTemplate(ready([]));
    expect(el.textContent).toContain('No attachments.');
    expect(
      el.querySelector('[data-testid="attachments-title"]')?.textContent?.trim()
    ).toBe('Attachments (0)');
  });

  test('S11 / EX2: the error state shows the message and Retry calls onRetry once', () => {
    const { el, h } = mountTemplate({
      status: 'error',
      rows: [],
      message: 'database locked',
      failed: new Set()
    });
    const alert = /** @type {HTMLElement} */ (
      el.querySelector('[role="alert"]')
    );
    expect(alert.textContent).toContain(
      'Could not list attachments: database locked'
    );
    /** @type {HTMLButtonElement} */ (alert.querySelector('button')).click();
    expect(h.onRetry).toHaveBeenCalledTimes(1);
  });

  test('S12 / EX1: the unavailable state names bdw', () => {
    const { el } = mountTemplate({
      status: 'unavailable',
      rows: [],
      message: '',
      failed: new Set()
    });
    expect(el.textContent).toContain(
      'Attachments need bdw in a hub workspace.'
    );
    expect(
      el.querySelector('[data-testid="attachments-title"]')?.textContent?.trim()
    ).toBe('Attachments');
  });

  test('UI1: the loading state', () => {
    const { el } = mountTemplate({
      status: 'loading',
      rows: [],
      message: '',
      failed: new Set()
    });
    expect(el.textContent).toContain('Loading attachments…');
  });
});
