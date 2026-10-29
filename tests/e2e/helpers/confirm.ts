import type { Page } from '@playwright/test';

// 应用内确认框（替代原生 confirm，避免 Electron/Windows 输入失效 bug）。
const box = (page: Page) => page.getByRole('dialog', { name: '操作确认' });

export async function acceptConfirm(page: Page) {
  await box(page).getByRole('button', { name: '确定', exact: true }).click();
}

export async function dismissConfirm(page: Page) {
  await box(page).getByRole('button', { name: '取消', exact: true }).click();
}
