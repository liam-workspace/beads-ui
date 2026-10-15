import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  attachmentRoute,
  classifyListingFailure,
  contentHeaders,
  findServableRow,
  isBdwBinary,
  isImageMime,
  isValidIssueId,
  resolveInside
} from './attachments.js';
import { runBdJson } from './bd.js';

vi.mock('./bd.js', () => ({
  getBdBin: () => '/hub/.claude/bin/bdw',
  runBdJson: vi.fn()
}));

describe('isValidIssueId', () => {
  test('BR-BUI-001-3: accepts ids that cannot be read as a flag or a path', () => {
    expect(isValidIssueId('bui-a1')).toBe(true);
    expect(isValidIssueId('BUI.1_x')).toBe(true);
  });

  test('BR-BUI-001-3: rejects empty, flag-like, spaced, slashed and non-string ids', () => {
    for (const bad of ['', '--check', '-x', 'a b', 'a/b', '../x', 5, null]) {
      expect(isValidIssueId(bad)).toBe(false);
    }
  });
});

describe('isBdwBinary', () => {
  test('E1: true only when the basename is bdw', () => {
    expect(isBdwBinary('/x/.claude/bin/bdw')).toBe(true);
    expect(isBdwBinary('bdw')).toBe(true);
    for (const bad of ['bd', '/usr/bin/bd', 'bdw-old', '/bdw/bd']) {
      expect(isBdwBinary(bad)).toBe(false);
    }
  });
});

describe('classifyListingFailure', () => {
  test('E1: exit 2 outside a hub workspace is attachments_unavailable', () => {
    expect(
      classifyListingFailure(2, 'error: not inside a hub workspace\n')
    ).toEqual({
      code: 'attachments_unavailable',
      message: 'Attachments need bdw in a hub workspace.'
    });
  });

  test('E2: exit 2 as a usage error is bd_error', () => {
    expect(classifyListingFailure(2, 'usage: bdw hub').code).toBe('bd_error');
  });

  test('E2: any other exit is bd_error with trimmed stderr', () => {
    expect(classifyListingFailure(1, 'database locked\n')).toEqual({
      code: 'bd_error',
      message: 'database locked'
    });
  });

  test('E2: empty stderr names the exit code', () => {
    expect(classifyListingFailure(1, '')).toEqual({
      code: 'bd_error',
      message: 'bdw exited with code 1'
    });
  });
});

describe('isImageMime', () => {
  test('BR-BUI-001-3: only the four raster types are images', () => {
    for (const ok of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(isImageMime(ok)).toBe(true);
    }
    for (const bad of [
      'image/svg+xml',
      'text/plain',
      'application/octet-stream',
      ''
    ]) {
      expect(isImageMime(bad)).toBe(false);
    }
  });
});

/**
 * @param {Partial<import('../app/protocol.js').AttachmentRow>} over
 * @returns {import('../app/protocol.js').AttachmentRow}
 */
function row(over) {
  return {
    path: 'attachments/x/a.png',
    abs_path: '/w/attachments/x/a.png',
    bytes: 1,
    mime: 'image/png',
    source: 'fix-folder',
    missing: false,
    ...over
  };
}

describe('findServableRow', () => {
  const rows = [
    row({ path: 'attachments/x/a.png' }),
    row({ path: 'attachments/x/gone.png', missing: true, bytes: null })
  ];

  test('S6: matches the exact path of a present row', () => {
    expect(findServableRow(rows, 'attachments/x/a.png')).toBe(rows[0]);
  });

  test('BR-BUI-001-5: a missing row is not servable', () => {
    expect(findServableRow(rows, 'attachments/x/gone.png')).toBeNull();
  });

  test('S6: no normalisation, so variants of a listed path do not match', () => {
    expect(findServableRow(rows, './attachments/x/a.png')).toBeNull();
    expect(findServableRow(rows, 'attachments//x/a.png')).toBeNull();
    expect(findServableRow(rows, 'attachments/x/../x/a.png')).toBeNull();
  });
});

describe('resolveInside', () => {
  /** @type {string} */
  let base;
  /** @type {string} */
  let root;

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bdui-in-')));
    root = path.join(base, 'ws');
    fs.mkdirSync(path.join(root, 'attachments'), { recursive: true });
    fs.writeFileSync(path.join(root, 'attachments', 'a.png'), 'a');
    fs.writeFileSync(path.join(base, 'outside.txt'), 'x');
    fs.symlinkSync(
      path.join(base, 'outside.txt'),
      path.join(root, 'attachments', 'out.txt')
    );
    fs.symlinkSync(
      path.join(root, 'attachments', 'a.png'),
      path.join(root, 'attachments', 'in.png')
    );
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('S7: a file inside the workspace resolves to its real path', async () => {
    expect(await resolveInside(root, 'attachments/a.png')).toBe(
      path.join(root, 'attachments', 'a.png')
    );
  });

  test('S7: a ../ path to a file outside is refused', async () => {
    expect(await resolveInside(root, '../outside.txt')).toBeNull();
  });

  test('S7: a symlink that leaves the workspace is refused', async () => {
    expect(await resolveInside(root, 'attachments/out.txt')).toBeNull();
  });

  test('S7: a symlink that stays inside resolves to its target', async () => {
    expect(await resolveInside(root, 'attachments/in.png')).toBe(
      path.join(root, 'attachments', 'a.png')
    );
  });

  test('EX4: an absent file is null', async () => {
    expect(await resolveInside(root, 'attachments/none.png')).toBeNull();
  });

  test('S7: the root itself is null', async () => {
    expect(await resolveInside(root, '.')).toBeNull();
  });

  test('EX4: a path through a regular file (ENOTDIR) is null', async () => {
    expect(await resolveInside(root, 'attachments/a.png/x')).toBeNull();
  });
});

describe('contentHeaders', () => {
  test('S5: a png is shown inline with its own type', () => {
    expect(contentHeaders(row({ path: 'attachments/x/login.png' }))).toEqual({
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="login.png"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
  });

  test('BR-BUI-001-3: svg is a download, never inline', () => {
    const h = contentHeaders(
      row({ path: 'attachments/x/d.svg', mime: 'image/svg+xml' })
    );
    expect(h['Content-Type']).toBe('application/octet-stream');
    expect(h['Content-Disposition']).toBe('attachment; filename="d.svg"');
  });

  test('S13: a log is a download', () => {
    const h = contentHeaders(
      row({ path: 'attachments/x/trace.log', mime: 'text/plain' })
    );
    expect(h['Content-Type']).toBe('application/octet-stream');
    expect(h['Content-Disposition']).toBe('attachment; filename="trace.log"');
  });

  test('BR-BUI-001-3: quotes, backslashes and control characters cannot break the header', () => {
    const h = contentHeaders(row({ path: 'attachments/x/a"b\\c\nd.png' }));
    expect(h['Content-Disposition']).toBe('inline; filename="a_b_c_d.png"');
  });

  test('S14: a non-ASCII name adds filename* and keeps ASCII values', () => {
    const h = contentHeaders(row({ path: 'attachments/x/é.png' }));
    expect(h['Content-Disposition']).toBe(
      'inline; filename="_.png"; filename*=UTF-8\'\'%C3%A9.png'
    );
    for (const v of Object.values(h)) {
      expect(/^[\x20-\x7e]*$/.test(v)).toBe(true);
    }
  });

  test('S14: filename* percent-encodes every byte outside RFC 8187 attr-char', () => {
    const h = contentHeaders(row({ path: "attachments/x/é'()*!.png" }));
    expect(h['Content-Disposition']).toContain(
      "filename*=UTF-8''%C3%A9%27%28%29%2A!.png"
    );
  });
});

describe('attachmentRoute', () => {
  /** @type {string} */
  let base;
  /** @type {string} */
  let root;
  const mockedList = /** @type {import('vitest').Mock} */ (runBdJson);

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bdui-rt-')));
    root = path.join(base, 'ws');
    fs.mkdirSync(path.join(root, 'attachments', 'dir.png'), {
      recursive: true
    });
    fs.writeFileSync(path.join(root, 'attachments', 'a.png'), 'png');
    fs.symlinkSync(
      path.join(root, 'attachments', 'dir.png'),
      path.join(root, 'attachments', 'link-dir.png')
    );
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  /**
   * @param {string[]} paths
   */
  function listRows(paths) {
    mockedList.mockResolvedValue({
      code: 0,
      stdoutJson: paths.map((p) => row({ path: p }))
    });
  }

  /**
   * @param {() => string} getRoot
   * @param {unknown} file
   * @param {string} [id]
   */
  async function call(getRoot, file, id = 'bui-a1') {
    /** @type {{ status: number, body: unknown, headers: Record<string, string>, sets: number, ends: number }} */
    const out = { status: 0, body: undefined, headers: {}, sets: 0, ends: 0 };
    const res = {
      status(/** @type {number} */ n) {
        out.status = n;
        out.sets += 1;
        return res;
      },
      set(
        /** @type {string | Record<string, string>} */ h,
        /** @type {string} */ v
      ) {
        Object.assign(out.headers, typeof h === 'string' ? { [h]: v } : h);
        return res;
      },
      end(/** @type {unknown} */ b) {
        out.ends += 1;
        out.body = b;
      }
    };
    await attachmentRoute(getRoot)(
      /** @type {any} */ ({ params: { id }, query: { path: file } }),
      /** @type {any} */ (res),
      () => {}
    );
    return out;
  }

  test('S2: a listed present file is served with its bytes', async () => {
    listRows(['attachments/a.png']);
    const out = await call(() => root, 'attachments/a.png');
    expect(out.status).toBe(200);
    expect(String(out.body)).toBe('png');
  });

  test('EX3: a repeated path parameter (array) is a 404, not a crash', async () => {
    listRows(['attachments/a.png']);
    const out = await call(() => root, ['attachments/a.png', 'x']);
    expect(out.status).toBe(404);
    expect(out.headers['Cache-Control']).toBe('no-store');
  });

  test('EX4: a listed folder, or a symlink to a folder, is a 404', async () => {
    listRows(['attachments/dir.png', 'attachments/link-dir.png']);
    for (const f of ['attachments/dir.png', 'attachments/link-dir.png']) {
      expect((await call(() => root, f)).status).toBe(404);
    }
  });

  test('EX4: a failing close after a refusal still sends exactly one 404', async () => {
    listRows(['attachments/a.png']);
    const spy = vi.spyOn(fs.promises, 'open').mockResolvedValue(
      /** @type {any} */ ({
        stat: async () => ({ isFile: () => false }),
        close: async () => {
          throw new Error('EIO');
        }
      })
    );
    try {
      const out = await call(() => root, 'attachments/a.png');
      expect(out.status).toBe(404);
      expect(out.ends).toBe(1);
      expect(out.sets).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('BR-BUI-001-2: an invalid id never reaches bdw', async () => {
    mockedList.mockClear();
    const out = await call(() => root, 'attachments/a.png', '--help');
    expect(out.status).toBe(404);
    expect(mockedList).not.toHaveBeenCalled();
  });

  test('E3: the root is read per request, so a new workspace is honoured', async () => {
    listRows(['attachments/a.png']);
    let current = path.join(base, 'elsewhere');
    expect((await call(() => current, 'attachments/a.png')).status).toBe(404);
    current = root;
    expect((await call(() => current, 'attachments/a.png')).status).toBe(200);
  });
});
