import { test, expect } from '@playwright/test';

test('shared popup close stays inside the window and visible after scrolling', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: [] }));
  await page.goto('/');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const opener of ['Launch a coin', 'Connect wallet']) {
      await page.getByRole('button', { name: opener, exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.evaluate(element => {
        const filler = document.createElement('div');
        filler.style.height = '2000px';
        element.append(filler);
        element.scrollTop = element.scrollHeight;
      });
      const close = dialog.getByRole('button', { name: 'Close', exact: true });
      await expect(close).toBeVisible();
      const bounds = await dialog.boundingBox(), button = await close.boundingBox();
      expect(button.y).toBeGreaterThanOrEqual(bounds.y);
      expect(button.y).toBeLessThan(bounds.y + 60);
      expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      await close.click();
      await expect(dialog).toHaveCount(0);
    }
  }
});
