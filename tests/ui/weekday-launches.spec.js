import { test, expect } from '@playwright/test';
test('weekday panel renders without a wallet and loads rotating template artwork', async ({page}) => {
  const errors = []; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Creator Studio',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Daily launches'})).toBeVisible();
  await expect(page.getByText(/Five coins every day.*9:15/)).toBeVisible();
  await expect(page.locator('#weekday-animals')).toBeChecked();
  await expect(page.getByRole('button',{name:'Edit template',exact:true})).toHaveCount(5);
  await page.getByRole('button',{name:'Edit template',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Save daily template'})).toBeVisible();
  await expect(page.locator('[name=name]')).not.toHaveValue('');
  await expect(page.locator('#upload-preview img')).toHaveAttribute('src', /^\/weekday-animals\/.+\.png$/);
  await expect.poll(()=>page.locator('#upload-preview img').evaluate(img=>img.complete && img.naturalWidth > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('server automation mode hides browser scheduling controls',async({page})=>{
 await page.route('**/api/status',route=>route.fulfill({json:{serverAutomation:true,uploads:true,network:'mainnet-beta',launchProtocol:'pump'}}));
 const status=page.waitForResponse(response=>response.url().endsWith('/api/status'));
 await page.goto('/');
 await status;
 await page.getByRole('button',{name:'Creator Studio',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Daily launches / server automation'})).toBeVisible();
 await expect(page.locator('#weekday-toggle')).toHaveCount(0);
 await expect(page.getByText(/No token purchases/)).toBeVisible();
});
