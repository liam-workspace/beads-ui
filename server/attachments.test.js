import { describe, expect, test } from 'vitest';
import {
  classifyListingFailure,
  isBdwBinary,
  isImageMime,
  isValidIssueId
} from './attachments.js';

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
