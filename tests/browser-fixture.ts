import type { Page } from '@playwright/test';
import { fixtureResult } from './cf-fixtures';
export async function mockCodeforces(page: Page) {
  await page.route('https://codeforces.com/api/**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        status: 'OK',
        result: fixtureResult(url.pathname.split('/').at(-1)!, Object.fromEntries(url.searchParams)),
      }),
    });
  });
}
