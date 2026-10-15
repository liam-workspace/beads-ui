import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync
} from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from 'vitest';
import WebSocket from 'ws';
import {
  calls,
  given,
  givenAttachments,
  hubCalls,
  makeWorld,
  removeWorld,
  resetWorld
} from '../test/fake-bdw.fixture.js';
import { createApp } from './app.js';
import { getConfig } from './config.js';
import { attachWsServer } from './ws.js';

/**
 * Acceptance rows for BUI-001 (02-design.md §6 b): the real HTTP app and the
 * real WebSocket server, a fake bdw, one row per behaviour. Written at step 5;
 * red until the BE lane builds `list-attachments` and `GET /api/attachments`.
 */

/** @typedef {import('../test/fake-bdw.fixture.js').World} World */

const SAVED_ENV = {
  BD_BIN: process.env.BD_BIN,
  FAKE_BDW_STATE: process.env.FAKE_BDW_STATE
};

/** @type {World} */
let world;
/** @type {World} */
let plain_bd_world;
/** @type {import('node:http').Server} */
let server;
/** @type {{ wss: import('ws').WebSocketServer }} */
let handle;
let base_url = '';
let ws_url = '';
let req_seq = 0;

/**
 * @param {World} w
 */
function useWorld(w) {
  process.env.BD_BIN = w.bin;
  process.env.FAKE_BDW_STATE = w.statePath;
}

beforeAll(async () => {
  world = makeWorld();
  plain_bd_world = makeWorld(undefined, { binName: 'bd' });
  useWorld(world);
  const config = getConfig();
  const app = createApp({ ...config, root_dir: world.ws });
  server = createServer(app);
  handle = attachWsServer(server, {
    path: '/ws',
    heartbeat_ms: 60000,
    refresh_debounce_ms: 0,
    root_dir: world.ws
  });
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(0))
  );
  const port = /** @type {import('node:net').AddressInfo} */ (server.address())
    .port;
  base_url = `http://127.0.0.1:${port}`;
  ws_url = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const client of handle?.wss.clients ?? []) {
    client.terminate();
  }
  await new Promise((resolve) => server.close(() => resolve(0)));
  removeWorld(world);
  removeWorld(plain_bd_world);
});

beforeEach(() => {
  resetWorld(world);
  resetWorld(plain_bd_world);
  useWorld(world);
});

/**
 * Send one request over a real WebSocket and return its reply.
 *
 * @param {string} type
 * @param {unknown} payload
 * @returns {Promise<{ ok: boolean, payload?: any, error?: { code: string, message: string } }>}
 */
function request(type, payload) {
  return new Promise((resolve, reject) => {
    const id = `acc-${++req_seq}`;
    const socket = new WebSocket(ws_url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`no reply to ${type}`));
    }, 8000);
    socket.on('open', () => socket.send(JSON.stringify({ id, type, payload })));
    socket.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.id === id) {
        clearTimeout(timer);
        socket.close();
        resolve(msg);
      }
    });
    socket.on('error', reject);
  });
}

/**
 * @param {string} id
 * @param {string | null} file
 * @returns {Promise<{ status: number, headers: Headers, body: Buffer }>}
 */
async function getFile(id, file) {
  const query = file === null ? '' : `?path=${encodeURIComponent(file)}`;
  const res = await fetch(`${base_url}/api/attachments/${id}${query}`);
  return {
    status: res.status,
    headers: res.headers,
    body: Buffer.from(await res.arrayBuffer())
  };
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function treeOf(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const st = lstatSync(full);
    out.push(`${full} ${st.size} ${st.mtimeMs}`);
    if (entry.isDirectory()) {
      out.push(...treeOf(full));
    }
  }
  return out.sort();
}

const DIR = 'attachments/fix-bui-a1';

describe('op 1 · list-attachments', () => {
  test('S1 · BR-BUI-001-1 · A-01 passes the listing rows through unchanged and in order', async () => {
    given(world, 'three-files');
    const expected = JSON.parse(readFileSync(world.statePath, 'utf8'))
      .attachments['bui-a1'];
    const reply = await request('list-attachments', { id: 'bui-a1' });
    expect(reply.ok).toBe(true);
    expect(reply.payload).toEqual(expected);
    expect(reply.payload.map((/** @type {any} */ r) => r.path)).toEqual([
      `${DIR}/login.png`,
      `${DIR}/trace.log`,
      'attachments/spec/flow.png'
    ]);
  });

  test('S10 · A-02 an issue without files answers an empty array', async () => {
    given(world, 'none');
    const reply = await request('list-attachments', { id: 'bui-a1' });
    expect(reply.ok).toBe(true);
    expect(reply.payload).toEqual([]);
  });

  test('S11 · EX2 · A-03 a failing listing answers bd_error with the stderr', async () => {
    given(world, 'fails');
    const reply = await request('list-attachments', { id: 'bui-a1' });
    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe('bd_error');
    expect(reply.error?.message).toBe('database locked');
  });

  test('EX1 · A-04 outside a hub workspace answers attachments_unavailable', async () => {
    given(world, 'not-hub');
    const reply = await request('list-attachments', { id: 'bui-a1' });
    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe('attachments_unavailable');
    expect(reply.error?.message).toBe(
      'Attachments need bdw in a hub workspace.'
    );
  });

  test('S12 · EX1 · A-05 plain bd answers attachments_unavailable and never runs hub', async () => {
    useWorld(plain_bd_world);
    given(plain_bd_world, 'three-files');
    const reply = await request('list-attachments', { id: 'bui-a1' });
    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe('attachments_unavailable');
    expect(hubCalls(plain_bd_world)).toEqual([]);
  });

  test('op 1 contract · D-12 · A-06 an id that is missing or could be a flag is a bad_request', async () => {
    given(world, 'three-files');
    const missing = await request('list-attachments', {});
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe('bad_request');
    const flag = await request('list-attachments', { id: '--check' });
    expect(flag.ok).toBe(false);
    expect(flag.error?.code).toBe('bad_request');
    expect(calls(world).filter((c) => c.argv.includes('--check'))).toEqual([]);
  });

  test('BR-BUI-001-6 · A-07 reads the listing on every request', async () => {
    given(world, 'one-image');
    const first = await request('list-attachments', { id: 'bui-a1' });
    expect(first.payload).toHaveLength(1);
    given(world, 'three-files');
    const second = await request('list-attachments', { id: 'bui-a1' });
    expect(second.payload).toHaveLength(3);
    expect(hubCalls(world)).toHaveLength(2);
  });

  test('BR-BUI-001-7 · A-08 runs only the sandboxed listing and changes nothing in the workspace', async () => {
    given(world, 'three-files');
    const before = treeOf(world.ws);
    const reply = await request('list-attachments', { id: 'bui-a1' });
    for (const row of reply.payload ?? []) {
      await getFile('bui-a1', row.path);
    }
    expect(reply.ok).toBe(true);
    const all = calls(world);
    expect(all.length).toBeGreaterThan(0);
    expect(hubCalls(world)).toHaveLength(all.length);
    for (const call of hubCalls(world)) {
      expect(call).toBe('--sandbox hub attachments bui-a1 --json');
    }
    expect(treeOf(world.ws)).toEqual(before);
  });
});

describe('op 2 · GET /api/attachments/:id', () => {
  test('S5 · BR-BUI-001-2 · BR-BUI-001-3 · F-01 serves a listed image inline', async () => {
    given(world, 'one-image');
    const res = await getFile('bui-a1', `${DIR}/login.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(
      res.body.equals(readFileSync(path.join(world.ws, DIR, 'login.png')))
    ).toBe(true);
    expect(res.headers.get('content-disposition')).toBe(
      'inline; filename="login.png"'
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('S6 · EX3 · F-02 refuses a file listed only for another issue', async () => {
    given(world, 'other-issue');
    const res = await getFile('bui-a1', 'attachments/fix-bui-b2/secret.png');
    expect(res.status).toBe(404);
    expect(res.body.length).toBe(0);
  });

  test('S7 · EX3 · F-03 refuses a path outside the workspace', async () => {
    given(world, 'one-image');
    const res = await getFile('bui-a1', '../../.ssh/id_rsa');
    expect(res.status).toBe(404);
    expect(res.body.length).toBe(0);
  });

  test('S7 · BR-BUI-001-2 · F-04 refuses listed rows that resolve outside the workspace', async () => {
    mkdirSync(path.join(world.ws, 'attachments'), { recursive: true });
    symlinkSync(
      path.join(world.root, 'link-target.png'),
      path.join(world.ws, 'attachments', 'link.png')
    );
    givenAttachments(world, 'bui-a1', [
      { path: '../outside.txt' },
      { path: 'attachments/link.png' }
    ]);
    for (const file of ['../outside.txt', 'attachments/link.png']) {
      const res = await getFile('bui-a1', file);
      expect(res.status).toBe(404);
      expect(res.body.length).toBe(0);
    }
  });

  test('BR-BUI-001-2 · BR-BUI-001-5 · F-05 refuses a row the listing marks missing', async () => {
    given(world, 'missing');
    const res = await getFile('bui-a1', `${DIR}/gone.png`);
    expect(res.status).toBe(404);
    expect(res.body.length).toBe(0);
  });

  test('EX4 · F-06 refuses a listed file deleted after the listing was set', async () => {
    given(world, 'one-image');
    unlinkSync(path.join(world.ws, DIR, 'login.png'));
    const res = await getFile('bui-a1', `${DIR}/login.png`);
    expect(res.status).toBe(404);
    expect(res.body.length).toBe(0);
  });

  test('S13 · BR-BUI-001-3 · F-07 serves a log file as a download', async () => {
    given(world, 'log');
    const res = await getFile('bui-a1', `${DIR}/trace.log`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="trace.log"'
    );
  });

  test('S14 · BR-BUI-001-3 · F-08 serves an SVG as a download, never inline', async () => {
    given(world, 'svg');
    const res = await getFile('bui-a1', `${DIR}/chart.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="chart.svg"'
    );
  });

  test('BR-BUI-001-2 · F-09 refuses when the listing fails or is unavailable', async () => {
    given(world, 'fails');
    const failed = await getFile('bui-a1', `${DIR}/login.png`);
    expect(failed.status).toBe(404);
    expect(failed.body.length).toBe(0);
    resetWorld(world);
    given(world, 'not-hub');
    const unavailable = await getFile('bui-a1', `${DIR}/login.png`);
    expect(unavailable.status).toBe(404);
    expect(unavailable.body.length).toBe(0);
  });

  test('BR-BUI-001-2 · F-10 refuses an id that could be a flag and a request without path', async () => {
    given(world, 'one-image');
    const flag = await getFile('--help', `${DIR}/login.png`);
    expect(flag.status).toBe(404);
    expect(flag.body.length).toBe(0);
    expect(calls(world).filter((c) => c.argv.includes('--help'))).toEqual([]);
    const no_path = await getFile('bui-a1', null);
    expect(no_path.status).toBe(404);
    expect(no_path.body.length).toBe(0);
  });
});
