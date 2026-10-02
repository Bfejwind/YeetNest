import { test, expect } from '@playwright/test';

test('market board, leaderboard, profile and local discussion work without pretending shared state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.terminal-column')).toHaveCount(3);
  await expect(page.locator('.terminal-coin')).toHaveCount(8);
  await page.getByLabel('Search terminal').fill('Corporate Cat');
  await expect(page.locator('.terminal-coin')).toHaveCount(1);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'yeetnest-terminal-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await expect(page.locator('.ranking-row')).toHaveCount(8);
  await page.getByLabel('Rank tokens').selectOption('cap');
  await expect(page.locator('.ranking-row').first()).toContainText('Corporate Cat');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByLabel('Display name').fill('Yeet Tester');
  await page.getByLabel('Bio').fill('<script>not HTML</script>');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Yeet Tester');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.locator('.coin').first().click();
  await expect(page.locator('.discussion')).toContainText('Browser-local demo');
  await page.getByLabel('Comment', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.locator('.discussion-post p')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.discussion-post strong')).toHaveText('Yeet Tester');
  await expect(page.locator('.discussion-post img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Report comment', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('No moderation service');
  await page.getByRole('button', { name: 'Delete local comment', exact: true }).click();
  await expect(page.locator('.discussion-post')).toHaveCount(0);
  expect(errors).toEqual([]);
});
