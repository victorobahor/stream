import { test, expect } from '@playwright/test';
import {
  e2eReachable,
  gotoHome,
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

  test('plays native video without creating iframe players or popup windows', async ({ page, context }) => {
    await gotoHome(page);
    await openFirstMatch(page);
    await waitForStreamTabs(page);
    await waitForPlaybackSurface(page);
    const video = page.locator('#stream-video');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(context.pages()).toHaveLength(1);
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
