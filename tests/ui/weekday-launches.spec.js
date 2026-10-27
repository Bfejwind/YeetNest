import { test, expect } from '@playwright/test';
test('weekday panel renders without a wallet and loads rotating template artwork', async ({page}) => {
  const errors = []; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Creator Studio',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Weekday launches'})).toBeVisible();
  await expect(page.getByText(/Two coins each Monday.*9:25/)).toBeVisible();
  await expect(page.locator('#weekday-animals')).toBeChecked();
  await expect(page.getByRole('button',{name:'Edit template',exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'Edit template',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Save weekday template'})).toBeVisible();
  await expect(page.locator('[name=name]')).not.toHaveValue('');
  await expect(page.locator('#upload-preview img')).toHaveAttribute('src', /^\/weekday-animals\/.+\.png$/);
  await expect.poll(()=>page.locator('#upload-preview img').evaluate(img=>img.complete && img.naturalWidth > 0)).toBe(true);
  expect(errors).toEqual([]);
});
