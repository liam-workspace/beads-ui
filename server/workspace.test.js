import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { getCurrentWorkspace, setCurrentWorkspace } from './workspace.js';

vi.mock('./bd.js', () => ({
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  getGitUserName: vi.fn()
}));

/** @type {string[]} */
const temp_dirs = [];

afterEach(() => {
  for (const dir of temp_dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * @returns {string}
 */
function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdui-ws-'));
  temp_dirs.push(dir);
  return dir;
}

describe('workspace state', () => {
  test('E3: getCurrentWorkspace returns what the last setCurrentWorkspace stored', () => {
    const first = { root_dir: '/a', db_path: '/a/db' };
    const second = { root_dir: '/b', db_path: '/b/db' };
    expect(setCurrentWorkspace(first)).toBe(first);
    expect(getCurrentWorkspace()).toBe(first);
    setCurrentWorkspace(second);
    expect(getCurrentWorkspace()).toEqual(second);
  });

  test('E3: attachWsServer stores its root_dir as the current workspace', async () => {
    const { attachWsServer } = await import('./ws.js');
    const root = makeDir();
    const server = createServer();
    const handle = attachWsServer(server, { root_dir: root });
    try {
      expect(getCurrentWorkspace()?.root_dir).toBe(root);
    } finally {
      handle.wss.close();
      server.close();
    }
  });

  test('E3: a set-workspace message makes the HTTP route read the new folder', async () => {
    const { handleMessage } = await import('./ws.js');
    const root = makeDir();
    const sock = { send: vi.fn() };
    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'ws-1',
          type: 'set-workspace',
          payload: { path: root }
        })
      )
    );
    expect(getCurrentWorkspace()?.root_dir).toBe(path.resolve(root));
  });
});
