import { test, expect } from '@playwright/test';
import { e2eReachable, gotoHome, waitForHomeReady } from './helpers';

type SlotHealth = {
  title: string;
  hasVideo: boolean;
  hasIframe: boolean;
  paused: boolean;
  readyState: number;
  currentTime: number;
};

async function readSlots(page: import('@playwright/test').Page): Promise<SlotHealth[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.mv-slot')].map(slot => {
      const video = slot.querySelector('video');
      return {
        title: (slot.querySelector('.mv-slot-title')?.textContent || '').trim(),
        hasVideo: !!video,
        hasIframe: !!slot.querySelector('iframe'),
        paused: video ? video.paused : true,
        readyState: video ? video.readyState : 0,
        currentTime: video ? video.currentTime : 0,
      };
    }),
  );
}

function playingNative(slots: SlotHealth[]): SlotHealth[] {
  return slots.filter(s => s.hasVideo && !s.paused && s.readyState >= 2 && s.currentTime > 1);
}

test.describe('Multi View four-pane playback', () => {
  test.beforeEach(() => {
    test.skip(!e2eReachable, 'Live site unreachable from this runner');
  });

  test('2x2 native streams keep advancing without cycling stalls', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoHome(page);
    await waitForHomeReady(page);

    await page.locator('[data-action="showMultiview"]').first().click();
    await expect(page).toHaveTitle(/Multi View/i);
    await page.locator('[data-layout="2x2"]').click();
    await expect(page.locator('.mv-slot')).toHaveCount(4);

    const loadButtons = page.locator('#multiview-match-list button', { hasText: /load stream/i });
    await expect(loadButtons.first()).toBeVisible({ timeout: 30_000 });
    const n = Math.min(4, await loadButtons.count());
    test.skip(n < 4, 'Need four sidebar matches to fill 2x2');

    for (let i = 0; i < 4; i++) {
      await loadButtons.nth(i).click();
      await page.waitForTimeout(500);
    }

    await expect.poll(async () => (await readSlots(page)).filter(s => s.title).length, {
      timeout: 45_000,
    }).toBe(4);

    // Two serialized Playwright mints can take a while; then media should flow.
    await page.waitForTimeout(50_000);
    const first = await readSlots(page);
    await page.waitForTimeout(12_000);
    const second = await readSlots(page);

    const playing = playingNative(second);
    const iframes = second.filter(s => s.hasIframe && !s.hasVideo).length;
    const advanced = second.filter((s, i) => {
      const prev = first[i];
      return s.hasVideo && prev && s.currentTime > prev.currentTime + 2;
    });

    expect(
      playing.length,
      `expected ≥3 native panes playing, got ${JSON.stringify(second)}`,
    ).toBeGreaterThanOrEqual(3);
    expect(advanced.length, 'playing panes should keep advancing, not stall/cycle').toBeGreaterThanOrEqual(2);
    expect(iframes, 'native HLS should not fall back to iframes on most panes').toBeLessThanOrEqual(1);
  });
});
