import { Buffer } from 'node:buffer';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * Shared fake `bdw` / `bd` for the BUI-001 acceptance rows and the E2E specs.
 * One world is a temporary folder holding the workspace (`ws/`), the fake
 * binary (`bin/<binName>`) and its state file (`state.json`). The binary reads
 * `FAKE_BDW_STATE`, records every call and answers from the state.
 */

/**
 * @typedef {{ path: string, abs_path: string, bytes: number | null, mime: string, source: 'referenced' | 'fix-folder', missing: boolean }} AttachmentRow
 * @typedef {{ id: string, title: string, status: string, issue_type?: string, priority?: number }} FakeIssue
 * @typedef {{ root: string, ws: string, bin: string, statePath: string }} World
 * @typedef {{ path: string, mime?: string, source?: 'referenced' | 'fix-folder', missing?: boolean, content?: Buffer | string }} FileSpec
 */

const FAKE_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const statePath = process.env.FAKE_BDW_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
let argv = process.argv.slice(2);
const sandboxed = argv[0] === '--sandbox';
if (sandboxed) argv = argv.slice(1);
state.calls.push({ argv, sandboxed, cwd: process.cwd() });
fs.writeFileSync(statePath, JSON.stringify(state));
function out(value) {
  process.stdout.write(JSON.stringify(value) + '\\n');
  process.exit(0);
}
function fail(code, message) {
  process.stderr.write(message + '\\n');
  process.exit(code);
}
const failRe = process.env.FAKE_BDW_FAIL;
if (failRe && new RegExp(failRe).test(argv.join(' '))) {
  fail(1, 'fake bdw: unsupported: ' + argv.join(' '));
}
const cmd = argv[0];
if (cmd === 'hub' && argv[1] === 'attachments') {
  const id = argv[2];
  if (state.notHub) {
    fail(2, 'bdw: hub attachments: not inside a hub workspace (projects/<code>/issues); pass -C');
  }
  const failure = state.listingFails[id];
  if (failure) fail(failure.exit, failure.stderr);
  out(state.attachments[id] || []);
}
if (cmd === 'show') {
  const issue = state.issues.find((i) => i.id === argv[1]);
  if (!issue) fail(1, 'no issue found: ' + argv[1]);
  out([issue]);
}
if (cmd === 'list' || cmd === 'ready') out(state.issues);
if (cmd === 'blocked' || (cmd === 'epic' && argv[1] === 'status')) out([]);
if (cmd === 'comments') out([]);
fail(1, 'fake bdw: unsupported: ' + argv.join(' '));
`;

const MIME_BY_EXT = /** @type {Record<string, string>} */ ({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.log': 'text/plain',
  '.txt': 'text/plain'
});

/**
 * @param {string} file
 * @returns {string}
 */
function mimeOf(file) {
  return (
    MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream'
  );
}

/**
 * @param {number} n
 * @returns {Buffer}
 */
function crcOf(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0);
  return buf;
}

/** @type {number[]} */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

/**
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([len, body, crcOf(crc32(body))]);
}

/**
 * A valid grey PNG the browser can decode.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function pngBytes(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x99)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * @param {World} world
 * @returns {any}
 */
function readState(world) {
  return JSON.parse(readFileSync(world.statePath, 'utf8'));
}

/**
 * @param {World} world
 * @param {any} state
 */
function writeState(world, state) {
  writeFileSync(world.statePath, JSON.stringify(state));
}

/**
 * Build a world. The first argument is a folder to use, or nothing for a fresh
 * temporary folder. The workspace is `ws/`, with `.beads/metadata.json` and
 * `attachments/`.
 *
 * @param {string | object} [dir]
 * @param {{ binName?: 'bdw' | 'bd' }} [options]
 * @returns {World}
 */
export function makeWorld(dir, options = {}) {
  const binName = options.binName || 'bdw';
  const root = realpathSync(
    typeof dir === 'string'
      ? (mkdirSync(dir, { recursive: true }), dir)
      : mkdtempSync(path.join(tmpdir(), 'beads-ui-world-'))
  );
  const ws = path.join(root, 'ws');
  mkdirSync(path.join(ws, '.beads'), { recursive: true });
  mkdirSync(path.join(ws, 'attachments'), { recursive: true });
  writeFileSync(path.join(ws, '.beads', 'metadata.json'), '{}');
  const binDir = path.join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, binName);
  writeFileSync(bin, FAKE_SOURCE);
  chmodSync(bin, 0o755);
  const statePath = path.join(root, 'state.json');
  const world = { root, ws, bin, statePath };
  resetWorld(world);
  return world;
}

/**
 * Back to the Background: the two open issues and no attachments or recorded
 * calls. Files already written into `ws/` stay.
 *
 * @param {World} world
 */
export function resetWorld(world) {
  writeState(world, {
    issues: [],
    attachments: {},
    listingFails: {},
    notHub: false,
    calls: []
  });
  givenIssue(world, { id: 'bui-a1', title: 'Login is slow', status: 'open' });
  givenIssue(world, { id: 'bui-b2', title: 'Logout loops', status: 'open' });
}

/**
 * @param {World} world
 */
export function removeWorld(world) {
  rmSync(world.root, { recursive: true, force: true });
}

/**
 * @param {World} world
 * @param {FakeIssue} issue
 */
export function givenIssue(world, issue) {
  const state = readState(world);
  state.issues = state.issues.filter(
    (/** @type {FakeIssue} */ i) => i.id !== issue.id
  );
  state.issues.push({ issue_type: 'bug', priority: 2, ...issue });
  writeState(world, state);
}

/**
 * Set the listing for an issue and write each non-missing file into `ws/`.
 * Missing rows get `bytes: null` and no file.
 *
 * @param {World} world
 * @param {string} id
 * @param {FileSpec[]} files
 * @returns {AttachmentRow[]}
 */
export function givenAttachments(world, id, files) {
  const state = readState(world);
  /** @type {AttachmentRow[]} */
  const rows = files.map((f) => {
    const abs_path = path.join(world.ws, f.path);
    const mime = f.mime || mimeOf(f.path);
    if (f.missing) {
      return {
        path: f.path,
        abs_path,
        bytes: null,
        mime,
        source: f.source || 'referenced',
        missing: true
      };
    }
    const content =
      f.content ?? (mime === 'image/png' ? pngBytes(8, 8) : `fake ${f.path}\n`);
    mkdirSync(path.dirname(abs_path), { recursive: true });
    writeFileSync(abs_path, content);
    return {
      path: f.path,
      abs_path,
      bytes: Buffer.byteLength(content),
      mime,
      source: f.source || 'fix-folder',
      missing: false
    };
  });
  state.attachments[id] = rows;
  delete state.listingFails[id];
  writeState(world, state);
  return rows;
}

/**
 * @param {World} world
 * @param {string} id
 * @param {{ exit: number, stderr: string }} failure
 */
export function givenListingFails(world, id, { exit, stderr }) {
  const state = readState(world);
  state.listingFails[id] = { exit, stderr };
  writeState(world, state);
}

/**
 * Every `hub attachments` call answers exit 2, "not inside a hub workspace".
 *
 * @param {World} world
 */
export function givenNotHub(world) {
  const state = readState(world);
  state.notHub = true;
  writeState(world, state);
}

/**
 * Every recorded call, oldest first, with `--sandbox` already stripped.
 *
 * @param {World} world
 * @returns {{ argv: string[], sandboxed: boolean, cwd: string }[]}
 */
export function calls(world) {
  return readState(world).calls;
}

/**
 * Every recorded `hub` call as it was typed, `--sandbox` included.
 *
 * @param {World} world
 * @returns {string[]}
 */
export function hubCalls(world) {
  return calls(world)
    .filter((c) => c.argv[0] === 'hub')
    .map((c) => (c.sandboxed ? '--sandbox ' : '') + c.argv.join(' '));
}

/** Given-state names, one per scenario. */
export const STATE_NAMES = [
  'three-files',
  'one-image',
  'before-after',
  'before-only',
  'other-issue',
  'missing',
  'abc',
  'none',
  'fails',
  'not-hub',
  'log',
  'svg'
];

/**
 * Load a named Given-state for the issues `bui-a1` and `bui-b2`.
 *
 * @param {World} world
 * @param {string} name
 */
export function given(world, name) {
  const dir = 'attachments/fix-bui-a1';
  switch (name) {
    case 'three-files':
      givenAttachments(world, 'bui-a1', [
        { path: `${dir}/login.png` },
        { path: `${dir}/trace.log`, mime: 'text/plain' },
        { path: 'attachments/spec/flow.png', source: 'referenced' }
      ]);
      return;
    case 'one-image':
      givenAttachments(world, 'bui-a1', [{ path: `${dir}/login.png` }]);
      return;
    case 'before-after':
      givenAttachments(world, 'bui-a1', [
        { path: `${dir}/before.png` },
        { path: `${dir}/after.png` }
      ]);
      return;
    case 'before-only':
      givenAttachments(world, 'bui-a1', [{ path: `${dir}/before.png` }]);
      return;
    case 'other-issue':
      givenAttachments(world, 'bui-a1', []);
      givenAttachments(world, 'bui-b2', [
        { path: 'attachments/fix-bui-b2/secret.png' }
      ]);
      return;
    case 'missing':
      givenAttachments(world, 'bui-a1', [
        { path: `${dir}/gone.png`, missing: true, source: 'referenced' }
      ]);
      return;
    case 'abc':
      givenAttachments(world, 'bui-a1', [
        { path: `${dir}/a.png` },
        { path: `${dir}/b.png` },
        { path: `${dir}/c.png` }
      ]);
      return;
    case 'none':
      givenAttachments(world, 'bui-a1', []);
      return;
    case 'fails':
      givenListingFails(world, 'bui-a1', {
        exit: 1,
        stderr: 'database locked'
      });
      return;
    case 'not-hub':
      givenNotHub(world);
      return;
    case 'log':
      givenAttachments(world, 'bui-a1', [
        { path: `${dir}/trace.log`, mime: 'text/plain' }
      ]);
      return;
    case 'svg':
      givenAttachments(world, 'bui-a1', [
        {
          path: `${dir}/chart.svg`,
          mime: 'image/svg+xml',
          content:
            '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'
        }
      ]);
      return;
    default:
      throw new Error(`unknown Given-state: ${name}`);
  }
}
