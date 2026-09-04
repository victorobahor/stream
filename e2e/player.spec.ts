import { test, expect } from '@playwright/test';
import {
  e2eReachable,
  gotoHome,
  isValidEmbedSrc,
  openFirstMatch,
  waitForPlaybackSurface,
  waitForStreamTabs,
} from './helpers';

test.describe('StreamZone player & embed', () => {
  test.beforeEach(() => {
    test.skip(!e2eReachable, 'Live site unreachable from this runner');
  });

  test('opens player with stream sources and tabs', async ({ page }) => {
    await gotoHome(page);
    await openFirstMatch(page);

    await expect(page.locator('#player-teams')).not.toBeEmpty();
    await expect(page.locator('#stream-count')).toContainText(/stream/i);

    const tabs = await waitForStreamTabs(page);
    expect(await tabs.count()).toBeGreaterThan(0);

    await expect(page.locator('#source-bar .source-chip').first()).toBeVisible();
  });

  test('embed iframe gets a real src before and after the click gate', async ({ page }) => {
    await gotoHome(page);
    await openFirstMatch(page);
    await waitForStreamTabs(page);

    const surface = await waitForPlaybackSurface(page);

    if (surface === 'native') {
      await expect(page.locator('#stream-video')).toBeVisible();
      return;
    }

    const iframe = page.locator('#stream-iframe');
    const gate = page.locator('.player-gate');

    if (surface === 'iframe-gate') {
      const srcBefore = await iframe.getAttribute('src');
      expect(isValidEmbedSrc(srcBefore)).toBe(true);

      await gate.click();
      await expect(gate).toBeHidden();
    }

    await expect(iframe).toBeVisible();
    const srcAfter = await iframe.getAttribute('src');
    expect(isValidEmbedSrc(srcAfter)).toBe(true);
  });

  test('source tabs switch without error state', async ({ page }) => {
    await gotoHome(page);
    await openFirstMatch(page);
    await waitForStreamTabs(page);

    const sources = page.locator('#source-bar .source-chip');
    const sourceCount = await sources.count();
    test.skip(sourceCount < 2, 'Match has only one source');

    await sources.nth(1).click();
    await expect(page.locator('#streams-loading')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#no-streams')).toBeHidden();
    await expect(page.locator('#stream-tabs .stream-tab').first()).toBeVisible({ timeout: 30_000 });
  });

  test('back navigation returns to match list', async ({ page }) => {
    await gotoHome(page);
    await openFirstMatch(page);
    await waitForStreamTabs(page);

    await page.locator('[data-action="showHome"]').first().click();
    await expect(page.locator('#home-view')).toBeVisible();
    await expect(page.locator('#player-view')).toBeHidden();
    await expect(page.locator('.match-card').first()).toBeVisible();
  });
});
