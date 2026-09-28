import { test, expect, type Page } from '@playwright/test';
import { resolvePlaylist } from '../../embed-proxy/hlsNative.mjs';

const embed = 'https://embed.st/embed/delta/test/1';
const playlist = 'https://lb1.strmd.st/delta/playlist.m3u8';
const manifest = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nsegment.ts\n';

async function provider(page: Page, urls = [playlist]) {
  await page.route(embed, route => route.fulfill({
    contentType: 'text/html',
    body: `<script>
      const urls = ${JSON.stringify(urls)};
      let index = 0;
      setInterval(() => { fetch(urls[Math.min(index++, urls.length - 1)]).catch(() => {}); }, 100);
    </script>`,
  }));
}

test('repeated Delta HTTP 500s report the provider error without a full timeout', async ({ page }) => {
  await provider(page);
  let requests = 0;
  await page.route(playlist, route => {
    requests++;
    return route.fulfill({ status: 500, body: 'runtime error: invalid memory address or nil pointer dereference' });
  });
  const listeners = page.listenerCount('response');
  const start = Date.now();
  await expect(resolvePlaylist(page, embed, { timeoutMs: 10_000 })).rejects.toMatchObject({
    statusCode: 502, code: 'HLS_UPSTREAM_ERROR', upstreamStatus: 500,
  });
  expect(Date.now() - start).toBeLessThan(5_000);
  expect(requests).toBeGreaterThanOrEqual(3);
  expect(page.listenerCount('response')).toBe(listeners);
});

test('a transient provider error can recover to a real HLS playlist', async ({ page }) => {
  await provider(page);
  let requests = 0;
  await page.route(playlist, route => route.fulfill(++requests === 1
    ? { status: 503, body: 'Try again' }
    : { contentType: 'application/vnd.apple.mpegurl', body: manifest }));
  const result = await resolvePlaylist(page, embed, { timeoutMs: 5_000 });
  expect(result.url).toBe(playlist);
  expect(result.body.toString()).toBe(manifest);
});

test('HTML disguised as a playlist and an ad playlist cannot win capture', async ({ page }) => {
  const ad = 'https://ads.example/playlist.m3u8';
  await provider(page, [ad, playlist, playlist]);
  await page.route(ad, route => route.fulfill({ body: manifest }));
  let requests = 0;
  await page.route(playlist, route => route.fulfill(++requests === 1
    ? { contentType: 'text/html', body: '<html>Stream offline</html>' }
    : { contentType: 'application/vnd.apple.mpegurl', body: manifest }));
  const result = await resolvePlaylist(page, embed, { timeoutMs: 5_000 });
  expect(result.url).toBe(playlist);
  expect(result.body.toString()).toBe(manifest);
});

test('an unavailable embed page fails immediately with its HTTP status', async ({ page }) => {
  await page.route(embed, route => route.fulfill({ status: 404, body: 'Stream ended' }));
  await expect(resolvePlaylist(page, embed, { timeoutMs: 5_000 })).rejects.toMatchObject({
    statusCode: 502, code: 'HLS_UPSTREAM_ERROR', upstreamStatus: 404,
  });
});

test('an embed that never produces a playlist has a bounded deadline', async ({ page }) => {
  await page.route(embed, route => route.fulfill({ contentType: 'text/html', body: '<p>Offline</p>' }));
  const listeners = page.listenerCount('response');
  await expect(resolvePlaylist(page, embed, { timeoutMs: 500 })).rejects.toMatchObject({
    statusCode: 504, code: 'HLS_RESOLVE_TIMEOUT',
  });
  expect(page.listenerCount('response')).toBe(listeners);
});
