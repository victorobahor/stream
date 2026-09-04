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

const EMBED_SRC =
  /^(\/__embed\?|https:\/\/(?:www\.)?(?:embed\.st|embed\.streamapi\.cc|embed\.sportsrc\.org|football77\.org))/;

/** True when iframe has a real embed URL (not the cleared about:blank placeholder). */
export function isValidEmbedSrc(src: string | null): boolean {
  if (!src || src === 'about:blank') return false;
  return EMBED_SRC.test(src);
}

/**
 * Player picks native HLS when possible; otherwise iframe + click gate.
 * Returns which playback path is active after settling.
 */
export async function waitForPlaybackSurface(
  page: Page,
): Promise<'native' | 'iframe-gate' | 'iframe-ready'> {
  const video = page.locator('#stream-video:not(.hidden)');
  const gate = page.locator('.player-gate');
  const iframe = page.locator('#stream-iframe');

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await video.isVisible()) return 'native';
    if (await gate.isVisible()) {
      const src = await iframe.getAttribute('src');
      if (isValidEmbedSrc(src)) return 'iframe-gate';
    }
    if (await iframe.isVisible()) {
      const src = await iframe.getAttribute('src');
      if (isValidEmbedSrc(src)) return 'iframe-ready';
    }
    await page.waitForTimeout(500);
  }

  throw new Error('Timed out waiting for native HLS or iframe embed surface');
}
