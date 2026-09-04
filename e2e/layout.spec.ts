import { test, expect } from '@playwright/test';
import { e2eReachable, gotoHome, waitForHomeReady } from './helpers';

test.describe('responsive layout', () => {
  test.beforeEach(() => {
    test.skip(!e2eReachable, 'Live site unreachable from this runner');
  });

  test('home does not overflow the mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHome(page);
    await waitForHomeReady(page);

    const metrics = await page.evaluate(() => {
      const card = document.querySelector('.match-card');
      const menuBtn = document.querySelector('.mobile-menu-btn');
      return {
        inner: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        headerW: document.getElementById('main-header')?.getBoundingClientRect().width ?? 0,
        cardW: card?.getBoundingClientRect().width ?? 0,
        menuDisplay: menuBtn ? getComputedStyle(menuBtn).display : 'none',
      };
    });

    expect(metrics.menuDisplay).toBe('flex');
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner + 1);
    expect(metrics.headerW).toBeLessThanOrEqual(metrics.inner + 1);
    expect(metrics.cardW).toBeGreaterThan(200);
    expect(metrics.cardW).toBeLessThanOrEqual(metrics.inner);
  });

  test('Multi View grid snaps to the remaining desktop window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoHome(page);
    await waitForHomeReady(page);

    await page.locator('[data-action="showMultiview"]').first().click();
    await expect(page.locator('#multiview-view')).toBeVisible();
    await expect(page.locator('.mv-slot').first()).toBeVisible();

    const metrics = await page.evaluate(() => {
      const grid = document.getElementById('multiview-grid-container');
      const slot = document.querySelector('.mv-slot');
      const footer = document.querySelector('.site-footer');
      const box = (el: Element | null) => el?.getBoundingClientRect();
      const gridBox = box(grid);
      const slotBox = box(slot);
      return {
        innerH: window.innerHeight,
        scrollOverflow: document.documentElement.scrollHeight - window.innerHeight,
        gridBottom: gridBox?.bottom ?? 0,
        slotBottom: slotBox?.bottom ?? 0,
        slotHeight: slotBox?.height ?? 0,
        footerDisplay: footer ? getComputedStyle(footer).display : 'none',
      };
    });

    expect(metrics.footerDisplay).toBe('none');
    expect(metrics.scrollOverflow).toBeLessThanOrEqual(8);
    expect(metrics.gridBottom).toBeGreaterThan(600);
    expect(metrics.gridBottom).toBeLessThanOrEqual(metrics.innerH + 8);
    expect(metrics.slotBottom).toBeLessThanOrEqual(metrics.innerH + 8);
    expect(metrics.slotHeight).toBeGreaterThan(200);
  });
});
