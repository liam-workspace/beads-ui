/**
 * @import { AttachmentRow } from '../app/protocol.js'
 * @import { Request, RequestHandler, Response } from 'express'
 */
import fs from 'node:fs';
import path from 'node:path';
import { getBdBin, runBdJson } from './bd.js';

/** Issue ids that can never be read as a flag or a path (BR-BUI-001-3). */
export const ISSUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const UNAVAILABLE_MESSAGE = 'Attachments need bdw in a hub workspace.';

/**
 * @param {unknown} id
 * @returns {id is string}
 */
export function isValidIssueId(id) {
  return typeof id === 'string' && ISSUE_ID_PATTERN.test(id);
}

/**
 * Only the `bdw` wrapper has the `hub attachments` command.
 *
 * @param {string} bin
 * @returns {boolean}
 */
export function isBdwBinary(bin) {
  return path.basename(bin) === 'bdw';
}

/**
 * @param {number} code - Exit code of the failed listing.
 * @param {string} stderr
 * @returns {{ code: 'attachments_unavailable' | 'bd_error', message: string }}
 */
export function classifyListingFailure(code, stderr) {
  if (code === 2 && stderr.includes('not inside a hub workspace')) {
    return { code: 'attachments_unavailable', message: UNAVAILABLE_MESSAGE };
  }
  const trimmed = stderr.trim();
  return {
    code: 'bd_error',
    message: trimmed.length > 0 ? trimmed : `bdw exited with code ${code}`
  };
}

/**
 * Run `bdw hub attachments <id> --json` in the workspace. The bd binary is read
 * per call, never at import time.
 *
 * @param {string} id - A valid issue id.
 * @param {{ cwd?: string }} opts
 * @returns {Promise<{ ok: true, rows: AttachmentRow[] } | { ok: false, code: 'attachments_unavailable' | 'bd_error', message: string }>}
 */
export async function listIssueAttachments(id, opts) {
  if (!isBdwBinary(getBdBin())) {
    return {
      ok: false,
      code: 'attachments_unavailable',
      message: UNAVAILABLE_MESSAGE
    };
  }
  const res = await runBdJson(['hub', 'attachments', id, '--json'], {
    cwd: opts.cwd
  });
  if (res.code !== 0) {
    return { ok: false, ...classifyListingFailure(res.code, res.stderr || '') };
  }
  if (!Array.isArray(res.stdoutJson)) {
    return { ok: false, ...classifyListingFailure(0, '') };
  }
  return { ok: true, rows: /** @type {AttachmentRow[]} */ (res.stdoutJson) };
}

/**
 * @param {string} mime
 * @returns {boolean}
 */
export function isImageMime(mime) {
  return (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/gif' ||
    mime === 'image/webp'
  );
}

/**
 * The row the file route may serve: the exact listed path, not missing.
 *
 * @param {AttachmentRow[]} rows
 * @param {string} file
 * @returns {AttachmentRow | null}
 */
export function findServableRow(rows, file) {
  return rows.find((row) => row.path === file && !row.missing) ?? null;
}

/**
 * Resolve `rel` under `root` and return its real path only when it lies inside
 * the real path of `root`. Symlinks and `..` that leave the root give null.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {Promise<string | null>}
 */
export async function resolveInside(root, rel) {
  try {
    const real_root = await fs.promises.realpath(root);
    const real = await fs.promises.realpath(path.resolve(real_root, rel));
    const relative = path.relative(real_root, real);
    if (
      relative === '' ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    ) {
      return null;
    }
    return real;
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw err;
  }
}

/**
 * Response headers for one served file (BR-BUI-001-3): images inline with their
 * own type, everything else a download. Values stay ASCII.
 *
 * @param {AttachmentRow} row
 * @returns {Record<string, string>}
 */
export function contentHeaders(row) {
  const image = isImageMime(row.mime);
  const raw_name = row.path.split('/').pop() ?? '';
  // Printable ASCII only, without quote or backslash; everything else is `_`.
  const safe_name = raw_name.replace(/["\\]|[^ -~]/g, '_');
  const non_ascii = /[\u0080-￿]/.test(raw_name);
  let disposition = `${image ? 'inline' : 'attachment'}; filename="${safe_name}"`;
  if (non_ascii) {
    // encodeURIComponent keeps ' ( ) *, which RFC 8187 attr-char does not allow
    const encoded = encodeURIComponent(raw_name).replace(
      /['()*]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
    );
    disposition += `; filename*=UTF-8''${encoded}`;
  }
  return {
    'Content-Type': image ? row.mime : 'application/octet-stream',
    'Content-Disposition': disposition,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  };
}

/**
 * @param {Response} res
 */
function refuse(res) {
  res.status(404).set('Cache-Control', 'no-store').end();
}

/**
 * Express handler for `GET /api/attachments/:id?path=`. Every refusal is one
 * empty 404; no error escapes as a 500.
 *
 * @param {() => string} getRoot - The current workspace root, read per request.
 * @returns {RequestHandler}
 */
export function attachmentRoute(getRoot) {
  return async (/** @type {Request} */ req, /** @type {Response} */ res) => {
    try {
      const id = req.params.id;
      const file = req.query.path;
      if (!isValidIssueId(id) || typeof file !== 'string' || file === '') {
        return refuse(res);
      }
      const root = getRoot();
      const listed = await listIssueAttachments(id, { cwd: root });
      if (!listed.ok) {
        return refuse(res);
      }
      const row = findServableRow(listed.rows, file);
      if (!row) {
        return refuse(res);
      }
      const real = await resolveInside(root, row.path);
      if (!real) {
        return refuse(res);
      }
      /** @type {Buffer} */
      let bytes;
      /** @type {fs.promises.FileHandle | null} */
      let handle = null;
      try {
        handle = await fs.promises.open(real, 'r');
        if (!(await handle.stat()).isFile()) {
          return refuse(res);
        }
        bytes = await handle.readFile();
      } catch {
        return refuse(res);
      } finally {
        // A failing close must not replace the answer already sent
        await handle?.close().catch(() => {});
      }
      res.status(200).set(contentHeaders(row)).end(bytes);
    } catch {
      refuse(res);
    }
  };
}
