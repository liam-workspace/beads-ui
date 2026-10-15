/**
 * @import { AttachmentRow } from '../app/protocol.js'
 */
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
