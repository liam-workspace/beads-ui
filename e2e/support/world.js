import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { given, hubCalls, resetWorld } from '../../test/fake-bdw.fixture.js';

/** @typedef {import('../../test/fake-bdw.fixture.js').World} World */
/** @typedef {'bdw' | 'bd'} Flavour */

/** Ports of the two servers, the same fallbacks as `playwright.config.js`. */
export const PORTS = {
  bdw: Number(process.env.E2E_WEB_PORT || 5174),
  bd: Number(process.env.E2E_API_PORT || 3001)
};

/**
 * Folder holding one server's fake world.
 *
 * @param {Flavour} flavour
 * @param {number} port
 * @returns {string}
 */
export function worldDir(flavour, port) {
  return process.env.E2E_WORLD_DIR
    ? path.join(process.env.E2E_WORLD_DIR, flavour)
    : path.join(os.tmpdir(), 'beads-ui-e2e-' + port);
}

/**
 * Rebuild a server's world handle from its folder without rewriting files.
 *
 * @param {Flavour} flavour
 * @returns {World}
 */
export function worldFor(flavour) {
  const root = worldDir(flavour, PORTS[flavour]);
  return {
    root,
    ws: path.join(root, 'ws'),
    bin: path.join(root, 'bin', flavour),
    statePath: path.join(root, 'state.json')
  };
}

/**
 * Back to the Background: the two issues and no attachments.
 *
 * @param {Flavour} flavour
 */
export function resetBackground(flavour) {
  resetWorld(worldFor(flavour));
}

/**
 * Load a named Given-state on one server.
 *
 * @param {Flavour} flavour
 * @param {string} name
 */
export function givenState(flavour, name) {
  given(worldFor(flavour), name);
}

/**
 * Open an issue in the dialog and wait for its attachments section.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 * @param {Flavour} [flavour]
 */
export async function openIssue(page, id, flavour = 'bdw') {
  await page.goto(
    'http://127.0.0.1:' + PORTS[flavour] + '/#/issues?issue=' + id
  );
  await page.getByTestId('attachments').waitFor();
}

/**
 * Every `hub` call one server's fake bdw recorded.
 *
 * @param {Flavour} flavour
 * @returns {string[]}
 */
export function hubCallsFor(flavour) {
  return hubCalls(worldFor(flavour));
}
