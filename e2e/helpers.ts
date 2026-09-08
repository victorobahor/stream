import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const LIVE_URL = process.env.BASE_URL ?? 'https://stream.vicktalk.online';

const flagPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.reachable');
export const e2eReachable = fs.existsSync(flagPath) ? fs.readFileSync(flagPath, 'utf8').trim() === '1' : true;

/** Navigate to home with a fast, resilient wait strategy. */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
}

/** Wait until the home match grid finishes loading (success or empty, not error). */
export async function waitForHomeReady(page: Page): Promise<Locator> {
  const matchCount = page.locator('#match-count');
  await expect(page.locator('#skeleton-grid')).toBeHidden({ timeout: 120_000 });
  await expect(matchCount).not.toHaveText(/Loading/i, { timeout: 120_000 });
  await expect(page.locator('#error-state')).toBeHidden();

  const cards = page.locator('#matches-grid .match-card');
  const empty = page.locator('#empty-state:not(.hidden)');

  await expect
    .poll(async () => (await cards.count()) > 0 || (await empty.isVisible()), {
      timeout: 45_000,
      message: 'Expected match cards or empty state',
    })
    .toBe(true);

  return cards;
}

/** Open the first visible match card and wait for the player view. */
export async function openFirstMatch(page: Page): Promise<void> {
  const cards = await waitForHomeReady(page);
  await expect(cards.first()).toBeVisible();
  await cards.first().click();
  await expect(page.locator('#player-view')).toBeVisible();
  await expect(page.locator('#streams-loading')).toBeHidden({ timeout: 45_000 });
}

/** Wait for stream tabs to render in the player view. */
export async function waitForStreamTabs(page: Page): Promise<Locator> {
  const tabs = page.locator('#stream-tabs .stream-tab');
  await expect(tabs.first()).toBeVisible({ timeout: 30_000 });
  return tabs;
}

/** A visible iframe is no longer a successful playback surface. */
export async function waitForPlaybackSurface(page: Page): Promise<'native'> {
  await expect(page.locator('#stream-video')).toBeVisible({ timeout: 150_000 });
  await expect.poll(() => page.locator('#stream-video').evaluate(video =>
    (video as HTMLVideoElement).readyState), { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('iframe')).toHaveCount(0);
  return 'native';
}
