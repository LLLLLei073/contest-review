import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const site = process.argv[2];
if (!site || !/^https?:\/\//.test(site)) throw new Error('Usage: node scripts/verify-site.mjs <site-url>');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const response = await page.goto(site, { waitUntil: 'networkidle', timeout: 60000 });
  if (response.status() !== 200) throw new Error('Site returned ' + response.status());
  await page.getByRole('heading', { name: '把错题，解成自己的。' }).waitFor();
  await page.getByRole('link', { name: '绑定 Codeforces', exact: true }).first().click();
  await page.getByLabel('Codeforces Handle').fill('tourist');
  await page.getByRole('button', { name: '绑定用户名' }).click();
  await page.getByText('已绑定', { exact: true }).waitFor({ timeout: 75000 });
  // Respect Codeforces' minimum interval between public API requests.
  await page.waitForTimeout(2200);
  const sample = await page.evaluate(async () => {
    const response = await fetch('https://codeforces.com/api/user.status?handle=tourist&from=1&count=5', {
      credentials: 'omit',
    });
    const data = await response.json();
    return { http: response.status, status: data.status, count: data.result?.length };
  });
  if (sample.status !== 'OK') throw new Error('Live CF submission read failed: ' + JSON.stringify(sample));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('已绑定', { exact: true }).waitFor();
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  mkdirSync('test-results-pages', { recursive: true });
  await page.screenshot({ path: 'test-results-pages/live-site.png', fullPage: true });
  const result = {
    site,
    http: response.status(),
    title: await page.title(),
    boundHandle: await page.locator('.profile-chip').innerText(),
    cf: sample,
    errors,
  };
  writeFileSync('test-results-pages/live-site.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
} finally {
  await context.close();
  await browser.close();
}
