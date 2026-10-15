import { html } from 'lit-html';

/** @typedef {import('../protocol.js').AttachmentRow} AttachmentRow */
/** @typedef {{ row: AttachmentRow, kind: 'image' | 'file' | 'missing' }} Tile */
/** @typedef {{ path: string, url: string, bytes: number | null }} ViewerItem */
/** @typedef {{ status: 'loading' | 'ready' | 'unavailable' | 'error', rows: AttachmentRow[], message: string, failed: Set<string> }} AttachmentsState */
/** @typedef {{ pair: { before: AttachmentRow, after: AttachmentRow } | null, tiles: Tile[] }} Arranged */

/** MIME types shown inline; every other type, SVG included, is a download. */
export const IMAGE_MIMES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
]);

/**
 * @param {string} mime
 * @returns {boolean}
 */
export function isImageMime(mime) {
  return IMAGE_MIMES.includes(mime);
}

/**
 * The URL of one attachment file, built from encoded parts only.
 *
 * @param {string} id
 * @param {string} path
 * @returns {string}
 */
export function attachmentUrl(id, path) {
  return `/api/attachments/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`;
}

/**
 * @param {string} path
 * @returns {string}
 */
export function fileName(path) {
  const parts = String(path).split('/');
  return parts[parts.length - 1] || String(path);
}

/**
 * @param {number | null} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1048576) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Split the listing into the before/after pair and the remaining tiles.
 *
 * @param {AttachmentRow[]} rows
 * @param {string} issue_id
 * @param {Set<string>} [failed] - Paths whose image answered an error.
 * @returns {Arranged}
 */
export function arrangeAttachments(rows, issue_id, failed = new Set()) {
  const before_path = `attachments/fix-${issue_id}/before.png`;
  const after_path = `attachments/fix-${issue_id}/after.png`;
  /** @param {AttachmentRow} r */
  const usable = (r) => !r.missing && !failed.has(r.path);
  const before = rows.find((r) => r.path === before_path && usable(r));
  const after = rows.find((r) => r.path === after_path && usable(r));
  const pair = before && after ? { before, after } : null;
  /** @type {Tile[]} */
  const tiles = [];
  for (const row of rows) {
    if (pair && (row === pair.before || row === pair.after)) {
      continue;
    }
    /** @type {Tile['kind']} */
    const kind =
      row.missing || failed.has(row.path)
        ? 'missing'
        : isImageMime(row.mime)
          ? 'image'
          : 'file';
    tiles.push({ row, kind });
  }
  return { pair, tiles };
}

/**
 * The images the viewer steps through: Before, After, then image tiles.
 *
 * @param {Arranged} arranged
 * @param {string} issue_id
 * @returns {ViewerItem[]}
 */
export function viewerItems(arranged, issue_id) {
  /**
   * @param {AttachmentRow} r
   * @returns {ViewerItem}
   */
  const item = (r) => ({
    path: r.path,
    url: attachmentUrl(issue_id, r.path),
    bytes: r.bytes
  });
  /** @type {ViewerItem[]} */
  const items = [];
  if (arranged.pair) {
    items.push(item(arranged.pair.before), item(arranged.pair.after));
  }
  for (const t of arranged.tiles) {
    if (t.kind === 'image') {
      items.push(item(t.row));
    }
  }
  return items;
}

/**
 * @param {AttachmentsState} state
 * @param {string} issue_id
 * @param {{ onRetry: () => void, onOpen: (index: number, opener: HTMLElement) => void, onImageError: (path: string) => void }} handlers
 * @returns {import('lit-html').TemplateResult}
 */
export function attachmentsTemplate(state, issue_id, handlers) {
  const ready = state.status === 'ready';
  const title = ready ? `Attachments (${state.rows.length})` : 'Attachments';

  /** @type {import('lit-html').TemplateResult} */
  let body;
  if (state.status === 'loading') {
    body = html`<div class="muted">Loading attachments…</div>`;
  } else if (state.status === 'unavailable') {
    body = html`<div class="muted">
      Attachments need bdw in a hub workspace.
    </div>`;
  } else if (state.status === 'error') {
    body = html`<div class="muted" role="alert">
      Could not list attachments: ${state.message}
      <button type="button" @click=${() => handlers.onRetry()}>Retry</button>
    </div>`;
  } else if (state.rows.length === 0) {
    body = html`<div class="muted">No attachments.</div>`;
  } else {
    const arranged = arrangeAttachments(state.rows, issue_id, state.failed);
    const items = viewerItems(arranged, issue_id);
    /** @param {string} path */
    const indexOf = (path) => items.findIndex((i) => i.path === path);

    /**
     * @param {AttachmentRow} row
     * @param {string} caption
     */
    const pairFigure = (row, caption) =>
      html`<figure>
        <button
          type="button"
          @click=${(/** @type {Event} */ ev) =>
            handlers.onOpen(
              indexOf(row.path),
              /** @type {HTMLElement} */ (ev.currentTarget)
            )}
        >
          <img
            src=${attachmentUrl(issue_id, row.path)}
            alt=${fileName(row.path)}
            @error=${() => handlers.onImageError(row.path)}
          />
        </button>
        <figcaption>${caption}</figcaption>
      </figure>`;

    /** @param {Tile} tile */
    const tileTemplate = (tile) => {
      const row = tile.row;
      const name = fileName(row.path);
      if (tile.kind === 'missing') {
        return html`<li data-testid="attachment-tile" data-path=${row.path}>
          <div class="attachment-missing" data-testid="attachment-missing">
            <span class="attachment-missing__path">${row.path}</span>
            <span>File not found</span>
          </div>
        </li>`;
      }
      if (tile.kind === 'image') {
        return html`<li data-testid="attachment-tile" data-path=${row.path}>
          <button
            type="button"
            @click=${(/** @type {Event} */ ev) =>
              handlers.onOpen(
                indexOf(row.path),
                /** @type {HTMLElement} */ (ev.currentTarget)
              )}
          >
            <img
              loading="lazy"
              src=${attachmentUrl(issue_id, row.path)}
              alt=${name}
              @error=${() => handlers.onImageError(row.path)}
            />
            <span class="attachment-name">${name}</span>
          </button>
        </li>`;
      }
      return html`<li data-testid="attachment-tile" data-path=${row.path}>
        <a href=${attachmentUrl(issue_id, row.path)} download=${name}>
          <span class="attachment-name">${name}</span>
          <span class="attachment-size">${formatBytes(row.bytes)}</span>
        </a>
      </li>`;
    };

    body = html`${arranged.pair
        ? html`<div class="attachment-pair" data-testid="attachment-pair">
            ${pairFigure(arranged.pair.before, 'Before')}
            ${pairFigure(arranged.pair.after, 'After')}
          </div>`
        : ''}
      <ul class="attachment-grid">
        ${arranged.tiles.map(tileTemplate)}
      </ul>`;
  }

  return html`<section class="attachments" data-testid="attachments">
    <div class="props-card__title" data-testid="attachments-title">
      ${title}
    </div>
    ${body}
  </section>`;
}
