import { test, expect } from '@playwright/test';
import { e2eReachable, gotoHome, waitForHomeReady } from './helpers';

test.describe('StreamZone live smoke', () => {
  test.beforeEach(() => {
    test.skip(!e2eReachable, 'Live site unreachable from this runner');
  });

  test('home page loads catalog and sports bar', async ({ page }) => {
    await gotoHome(page);

    await expect(page).toHaveTitle(/StreamZone/i);
    await expect(page.locator('.logo-text')).toBeVisible();
    await expect(page.locator('#nav-live')).toHaveClass(/active/);

    const cards = await waitForHomeReady(page);
    expect(await cards.count()).toBeGreaterThan(0);

    const matchCount = await page.locator('#match-count').textContent();
    expect(matchCount).toMatch(/\d+/);

    const sportChips = page.locator('#sports-bar .sport-chip');
    expect(await sportChips.count()).toBeGreaterThan(1);
    await expect(page.locator('#sports-bar .sport-chip[data-sport-id="football"]')).toBeVisible();
  });

  test('sport filter and search narrow results', async ({ page }) => {
    await gotoHome(page);
    await waitForHomeReady(page);

    await page.locator('#sports-bar .sport-chip[data-sport-id="football"]').click();
    await expect(page).toHaveTitle(/Football/i);
    await expect(page.locator('#section-title')).toContainText(/Football/i);

    const footballCards = page.locator('.match-card');
    await expect(footballCards.first()).toBeVisible({ timeout: 30_000 });
    const footballCount = await footballCards.count();
    expect(footballCount).toBeGreaterThan(0);

    await page.locator('#search-input').fill('Stuttgart');
    await expect(page.locator('#match-count')).toHaveText(/1 result/i, { timeout: 15_000 });
    await expect(page.locator('.match-card')).toHaveCount(1);
    await expect(page.locator('.match-card').first()).toContainText(/Stuttgart/i);
  });

  test('category tabs load All matches catalog', async ({ page }) => {
    await gotoHome(page);
    await waitForHomeReady(page);

    await page.locator('#nav-all').click();
    await expect(page).toHaveTitle(/All matches/i);
    await expect(page.locator('#match-count')).not.toHaveText(/Loading/i, { timeout: 45_000 });

    await page.locator('#sports-bar .sport-chip', { hasText: 'All Sports' }).click();
    await expect(page.locator('#match-count')).toContainText(/of \d+ results/i, { timeout: 45_000 });

    const cards = page.locator('.match-card');
    expect(await cards.count()).toBeGreaterThan(10);
  });

  test('Multi View loads sidebar and slots', async ({ page }) => {
    await gotoHome(page);
    await waitForHomeReady(page);

    await page.locator('[data-action="showMultiview"]').first().click();
    await expect(page).toHaveTitle(/Multi View/i);
    await expect(page.locator('#multiview-view')).toBeVisible();

    await expect(page.locator('.mv-slot').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#multiview-match-list > *').first()).toBeVisible({ timeout: 30_000 });

    const sidebarItems = page.locator('#multiview-match-list > *');
    expect(await sidebarItems.count()).toBeGreaterThan(0);
  });

  test('upstream APIs respond from the browser', async ({ page }) => {
    await gotoHome(page);

    const apiStatus = await page.evaluate(async () => {
      const [sportsrc, streamed] = await Promise.all([
        fetch('/api/sportsrc/matches?category=live').then(r => r.status).catch(() => 0),
        fetch('https://streamed.pk/api/matches/live').then(r => r.status).catch(() => 0),
      ]);
      return { sportsrc, streamed };
    });

    expect(apiStatus.sportsrc).toBe(200);
    expect(apiStatus.streamed).toBe(200);
  });
});
