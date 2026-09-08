import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function fixtures(page: Page, options: { failPrimary?: boolean; failAll?: boolean; emptyFallback?: boolean } = {}) {
  let nextId = 0;
  let opening = 0;
  let peakOpens = 0;
  let delayedSegments = 0;
  let failedSegments = 0;
  const closed: string[] = [];
  const requests: string[] = [];
  const attempts = new Map<string, number>();
  const catalog = Array.from({ length: 4 }, (_, i) => ({
    id: `match-${i}`, title: `Test Home ${i} vs Test Away ${i}`, category: 'football',
    date: Date.now() - 10_000, popular: true,
    sources: [{ source: 'admin', id: `match-${i}` }],
  }));
  page.on('request', request => requests.push(request.url()));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path.endsWith('/sports')) return json([{ id: 'football', name: 'Football' }]);
    if (path.includes('/matches/')) return json(catalog);
    if (path.includes('/stream/')) {
      const id = path.split('/').pop();
      const sportsrc = path.startsWith('/api/sportsrc/');
      if (sportsrc && options.emptyFallback) return json([]);
      return json([{ id, streamNo: 1, language: 'English', hd: true, source: sportsrc ? 'sportsrc' : 'admin',
        embedUrl: sportsrc ? `https://embed.streamapi.cc/sport/${id}/` : `https://embed.st/embed/admin/${id}/1` }]);
    }
    if (path === '/api/hls/open') {
      const embed = url.searchParams.get('u') || '';
      opening++;
      peakOpens = Math.max(peakOpens, opening);
      await new Promise(r => setTimeout(r, 150));
      opening--;
      if (options.failAll || (options.failPrimary && embed.includes('embed.st/'))) {
        return route.fulfill({ status: 422, json: { error: 'No playable source' } });
      }
      const sessionId = (++nextId).toString(16).padStart(24, '0');
      return json({ sessionId, masterUrl: `/api/hls/${sessionId}/master.m3u8` });
    }
    if (path.endsWith('/close')) {
      closed.push(path.split('/')[3]);
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/master.m3u8')) {
      return route.fulfill({ contentType: 'application/vnd.apple.mpegurl',
        body: await readFile(resolve('test-results/hls-fixture/master.m3u8')) });
    }
    const segment = path.match(/segment-(\d+)\.ts$/);
    if (segment) {
      const key = path;
      const count = (attempts.get(key) || 0) + 1;
      attempts.set(key, count);
      if (Number(segment[1]) === 8 && count === 1) {
        failedSegments++;
        return route.fulfill({ status: 503, body: 'Temporary media outage' });
      }
      if (Number(segment[1]) % 7 === 0) {
        delayedSegments++;
        await new Promise(r => setTimeout(r, 600));
      }
      return route.fulfill({ contentType: 'video/mp2t',
        body: await readFile(resolve('test-results/hls-fixture', `segment-${segment[1]}.ts`)) });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');
  await expect(page.locator('.match-card')).toHaveCount(4);
  return { closed, requests, metrics: () => ({ peakOpens, delayedSegments, failedSegments }) };
}

async function fillFour(page: Page) {
  await page.locator('[data-action="showMultiview"]').first().click();
  await page.locator('[data-layout="2x2"]').click();
  for (let i = 0; i < 4; i++) {
    await page.locator('#multiview-match-list button', { hasText: 'Load Stream' }).nth(i).click();
  }
}
async function health(page: Page) {
  return page.locator('.mv-video').evaluateAll(videos => videos.map(el => {
    const v = el as HTMLVideoElement;
    return { time: v.currentTime, paused: v.paused, ready: v.readyState };
  }));
}

test('four actual videos tolerate delayed segments and 503s without ads or restarts', async ({ page, context }, info) => {
  const fixture = await fixtures(page);
  await fillFour(page);
  for (const i of [1, 3]) await page.locator('.mv-slot').nth(i).locator('select').first().selectOption('sportsrc');
  await expect.poll(async () => (await health(page)).filter(v => v.time > 1 && !v.paused).length).toBe(4);
  let previous = await health(page);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(5_000);
    const current = await health(page);
    expect(current).toHaveLength(4);
    for (let slot = 0; slot < 4; slot++) {
      expect(current[slot].time - previous[slot].time).toBeGreaterThan(4);
      expect(current[slot].paused).toBe(false);
    }
    samples.push(current);
    previous = current;
  }
  expect(fixture.metrics().peakOpens).toBeLessThanOrEqual(2);
  expect(fixture.metrics().delayedSegments).toBeGreaterThan(0);
  expect(fixture.metrics().failedSegments).toBeGreaterThanOrEqual(4);
  expect(context.pages()).toHaveLength(1);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(fixture.requests.some(url => /\/__embed|\/__ad_sink|https:\/\/embed\./.test(url))).toBe(false);
  await info.attach('playback-metrics', { body: JSON.stringify({ samples, ...fixture.metrics() }, null, 2), contentType: 'application/json' });
  // Closing one slot must preserve the other three media elements and sessions.
  const sibling = page.locator('.mv-video').nth(1);
  const handle = await sibling.elementHandle();
  const before = await sibling.evaluate(v => (v as HTMLVideoElement).currentTime);
  await page.locator('.mv-slot').first().locator('[data-slot-action="clear"]').click();
  await page.waitForTimeout(2_000);
  expect(await handle!.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(before + 1);
  await page.locator('[data-action="showHome"]').first().click();
  await expect.poll(() => fixture.closed.length).toBeGreaterThanOrEqual(4);
  await page.locator('[data-action="showMultiview"]').first().click();
  await expect.poll(async () => (await health(page)).filter(v => v.time > 1 && !v.paused).length).toBe(3);
});

test('a failed provider moves to SportSRC; an unavailable match never opens ad frames', async ({ page, context }) => {
  await fixtures(page, { failPrimary: true });
  await fillFour(page);
  await expect.poll(async () => (await health(page)).filter(v => v.time > 1).length).toBe(4);
  for (let i = 0; i < 4; i++) await expect(page.locator('.mv-slot').nth(i).locator('select').first()).toHaveValue('sportsrc');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(context.pages()).toHaveLength(1);
});

test('unavailable sources show a retry action instead of falling back to ads', async ({ page, context }) => {
  await fixtures(page, { failAll: true });
  await fillFour(page);
  await expect(page.getByRole('button', { name: 'Retry stream' })).toHaveCount(4);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(context.pages()).toHaveLength(1);
});

test('the main player switches providers and closes playback on back navigation', async ({ page }) => {
  const fixture = await fixtures(page);
  await page.locator('.match-card').first().click();
  await expect.poll(() => page.locator('#stream-video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
  await page.locator('#source-bar .source-chip', { hasText: 'SportSRC' }).click();
  await expect(page.locator('#player-loading')).toBeHidden();
  await expect.poll(() => page.locator('#stream-video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.locator('[data-action="showHome"]').first().click();
  await expect(page.locator('#player-view')).toBeHidden();
  await expect.poll(() => fixture.closed.length).toBeGreaterThanOrEqual(2);
});

test('an empty fallback catalog preserves all selected matches for retry', async ({ page }) => {
  await fixtures(page, { failPrimary: true, emptyFallback: true });
  await fillFour(page);
  await expect(page.getByRole('button', { name: 'Retry stream' })).toHaveCount(4);
  await expect(page.locator('.mv-slot-title')).toHaveCount(4);
  await expect(page.locator('.mv-slot.empty')).toHaveCount(0);
});
