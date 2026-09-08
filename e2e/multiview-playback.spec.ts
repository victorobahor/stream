import { test, expect, type Page } from '@playwright/test';
import { e2eReachable, gotoHome, waitForHomeReady } from './helpers';

async function readSlots(page: Page) {
  return page.locator('.mv-slot').evaluateAll(slots => slots.map(slot => {
    const video = slot.querySelector('video');
    return {
      title: slot.querySelector('.mv-slot-title')?.textContent || '',
      source: slot.querySelector('select')?.value || '',
      hasIframe: !!slot.querySelector('iframe'),
      paused: video?.paused ?? true,
      readyState: video?.readyState ?? 0,
      currentTime: video?.currentTime ?? 0,
      buffered: video?.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0,
    };
  }));
}

test('four native streams keep advancing with both providers and no ad frames', async ({ page, context }, info) => {
  test.setTimeout(300_000);
  test.skip(!e2eReachable, 'Site unreachable from this runner');
  await gotoHome(page);
  const category = process.env.PLAYBACK_CATEGORY || 'today';
  if (!['live', 'today', 'all', 'popular'].includes(category)) throw new Error('Invalid PLAYBACK_CATEGORY');
  await page.locator(`#nav-${category}`).click();
  await waitForHomeReady(page);
  await page.locator('[data-action="showMultiview"]').first().click();
  await page.locator('[data-layout="2x2"]').click();
  const titles = process.env.PLAYBACK_MATCHES?.split('|').map(s => s.trim()).filter(Boolean);
  if (titles && titles.length !== 4) throw new Error('PLAYBACK_MATCHES must contain four | separated titles');
  const buttons = page.locator('#multiview-match-list button', { hasText: /load stream/i });
  await expect(buttons.first()).toBeVisible();
  test.skip(!titles && await buttons.count() < 4, 'Need four available matches');
  for (let i = 0; i < 4; i++) {
    if (titles) {
      await page.locator('#multiview-search').fill(titles[i]);
      await expect(page.locator('#multiview-match-list')).toContainText(titles[i]);
      await expect(buttons).toHaveCount(1);
      await buttons.first().click();
    } else { await buttons.nth(i).click(); }
  }
  for (const i of [1, 3]) {
    const source = page.locator('.mv-slot').nth(i).locator('select').first();
    await expect(source).toBeVisible();
    // Force SportSRC on two panes so the live test cannot silently cover only Streamed.
    await expect(source.locator('option[value="sportsrc"]')).toHaveCount(1);
    await source.selectOption('sportsrc');
  }
  await expect.poll(async () => (await readSlots(page)).filter(s => !s.paused && s.currentTime > 1).length,
    { timeout: 150_000, message: 'All four native panes must actually play' }).toBe(4);
  let previous = await readSlots(page);
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5_000);
    const current = await readSlots(page);
    samples.push(current);
    for (let slot = 0; slot < 4; slot++) {
      expect(current[slot].currentTime - previous[slot].currentTime,
        `Slot ${slot + 1} stopped advancing: ${JSON.stringify(current[slot])}`).toBeGreaterThan(4);
      expect(current[slot].hasIframe).toBe(false);
      expect(current[slot].paused).toBe(false);
    }
    previous = current;
  }
  expect(context.pages()).toHaveLength(1);
  await expect(page.locator('iframe')).toHaveCount(0);
  await info.attach('four-stream-health', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
  await info.attach('four-streams', { body: await page.screenshot(), contentType: 'image/png' });
  await page.locator('[data-action="showHome"]').first().click();
});
