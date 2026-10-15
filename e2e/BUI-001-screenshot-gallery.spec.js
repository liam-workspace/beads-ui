// BUI-001 Screenshot gallery. Run by step 9 against the two real servers
// (bdw and bd) that playwright.config.js starts; the FE lane only type-checks it.
//
// Excluded by the BP Won't line "editing or annotating images": it has no item
// and no test.
import { expect, test } from '@playwright/test';
import {
  givenState,
  hubCallsFor,
  openIssue,
  resetBackground,
  tile
} from './support/world.js';

test.describe('BUI-001 Screenshot gallery', () => {
  test.beforeEach(() => {
    // Background: the UI server runs bdw in a hub workspace.
    resetBackground('bdw');
  });

  test('The gallery shows every file the listing returns', async ({ page }) => {
    givenState('bdw', 'three-files');
    await openIssue(page, 'bui-a1');
    await expect(page.getByTestId('attachment-tile')).toHaveCount(3);
    await expect(page.getByTestId('attachments-title')).toHaveText(
      'Attachments (3)'
    );
  });

  test('An image opens at full size in the viewer', async ({ page }) => {
    givenState('bdw', 'one-image');
    await openIssue(page, 'bui-a1');
    const open_tile = tile(page, 'login.png').getByRole('button');
    await open_tile.click();
    const viewer = page.getByTestId('attachment-viewer');
    await expect(viewer).toBeVisible();
    await expect(page.getByTestId('attachment-viewer-path')).toContainText(
      'attachments/fix-bui-a1/login.png'
    );
    // The image decodes after the viewer opens: wait for it, do not sample once
    await expect
      .poll(() =>
        page
          .getByTestId('attachment-viewer-image')
          .evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth)
      )
      .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(page.locator('#issue-dialog')).toHaveAttribute('open', '');
    await expect(open_tile).toBeFocused();
  });

  test('Before and after screenshots show side by side', async ({ page }) => {
    givenState('bdw', 'before-after');
    await openIssue(page, 'bui-a1');
    const pair = page.getByTestId('attachment-pair');
    await expect(pair.locator('figcaption')).toHaveText(['Before', 'After']);
    await expect(
      page.getByTestId('attachment-tile').filter({ hasText: /before|after/ })
    ).toHaveCount(0);
  });

  test('Only one of before and after shows as an ordinary tile', async ({
    page
  }) => {
    givenState('bdw', 'before-only');
    await openIssue(page, 'bui-a1');
    await expect(
      page.locator(
        '[data-testid="attachment-tile"][data-path="attachments/fix-bui-a1/before.png"]'
      )
    ).toHaveCount(1);
    await expect(page.getByTestId('attachment-pair')).toHaveCount(0);
  });

  test('A listed file is served to the browser', async ({ page }) => {
    givenState('bdw', 'one-image');
    await openIssue(page, 'bui-a1');
    const src = await tile(page, 'login.png')
      .locator('img')
      .getAttribute('src');
    expect(src).toBeTruthy();
    const res = await page.request.get(String(src));
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  });

  test('A file not listed for the issue is refused', async ({ page }) => {
    givenState('bdw', 'other-issue');
    await openIssue(page, 'bui-a1');
    const res = await page.request.get(
      '/api/attachments/bui-a1?path=' +
        encodeURIComponent('attachments/fix-bui-b2/secret.png')
    );
    expect(res.status()).toBe(404);
    expect((await res.body()).length).toBe(0);
  });

  test('A path outside the workspace is refused', async ({ page }) => {
    givenState('bdw', 'one-image');
    await openIssue(page, 'bui-a1');
    const res = await page.request.get(
      '/api/attachments/bui-a1?path=' + encodeURIComponent('../../.ssh/id_rsa')
    );
    expect(res.status()).toBe(404);
    expect((await res.body()).length).toBe(0);
  });

  test('A missing mentioned file shows a broken-file marker', async ({
    page
  }) => {
    givenState('bdw', 'missing');
    /** @type {string[]} */
    const requested = [];
    page.on('request', (req) => requested.push(req.url()));
    await openIssue(page, 'bui-a1');
    const marker = tile(page, 'gone.png').getByTestId('attachment-missing');
    await expect(marker).toBeVisible();
    await expect(marker).toContainText('File not found');
    expect(requested.filter((u) => u.includes('gone.png'))).toEqual([]);
  });

  test('Next and Previous move through the images', async ({ page }) => {
    givenState('bdw', 'abc');
    await openIssue(page, 'bui-a1');
    await tile(page, 'a.png').getByRole('button').click();
    const path = page.getByTestId('attachment-viewer-path');
    await expect(path).toContainText('a.png');
    await page.keyboard.press('ArrowRight');
    await expect(path).toContainText('b.png');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(path).toContainText('c.png');
  });

  test('An issue without files shows the empty state', async ({ page }) => {
    givenState('bdw', 'none');
    await openIssue(page, 'bui-a1');
    await expect(page.getByText('No attachments.')).toBeVisible();
  });

  test('A listing error is shown with Retry', async ({ page }) => {
    givenState('bdw', 'fails');
    await openIssue(page, 'bui-a1');
    await expect(
      page.getByText('Could not list attachments: database locked')
    ).toBeVisible();
    const calls_before = hubCallsFor('bdw').length;
    givenState('bdw', 'three-files');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('attachment-tile')).toHaveCount(3);
    // Changing the fake's state also moves the issue's updated_at, which lists
    // again by itself (BR-BUI-001-6), so Retry adds at least one listing
    expect(hubCallsFor('bdw').length).toBeGreaterThan(calls_before);
  });

  test('A workspace without bdw shows why there is no gallery', async ({
    page
  }) => {
    resetBackground('bd');
    givenState('bd', 'three-files');
    await openIssue(page, 'bui-a1', 'bd');
    await expect(
      page.getByText('Attachments need bdw in a hub workspace.')
    ).toBeVisible();
  });

  test('A non-image file downloads from its tile', async ({ page }) => {
    givenState('bdw', 'log');
    await openIssue(page, 'bui-a1');
    const download = page.waitForEvent('download');
    await tile(page, 'trace.log').getByRole('link').click();
    expect((await download).suggestedFilename()).toBe('trace.log');
  });

  test('An SVG file is offered as a download, not shown inline', async ({
    page
  }) => {
    givenState('bdw', 'svg');
    await openIssue(page, 'bui-a1');
    const chart = tile(page, 'chart.svg');
    await expect(chart.locator('img')).toHaveCount(0);
    const href = await chart.getByRole('link').getAttribute('href');
    const res = await page.request.get(String(href));
    expect(res.headers()['content-disposition']).toMatch(/^attachment/);
  });
});
