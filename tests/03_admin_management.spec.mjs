import { test, expect } from '@playwright/test';

test.describe('3. Kiểm thử Quản trị viên (Danh sách Giáo viên, Tổ chuyên môn, Đám mây)', () => {

  test('Quản trị viên đăng nhập và truy cập module Giáo viên & Tổ chuyên môn', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('127.0.0.1:18888')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Đăng xuất nếu cần
    const userMenuBtn = page.locator('#btnUserMenuToggle');
    if (await userMenuBtn.isVisible()) {
      await userMenuBtn.click();
      await page.waitForTimeout(300);
      const logoutBtn = page.locator('button:has-text("Đăng xuất"), a:has-text("Đăng xuất")').first();
      if (await logoutBtn.isVisible()) {
        await logoutBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // Đăng nhập Admin
    const usernameInput = page.locator('#loginUsername');
    if (await usernameInput.isVisible()) {
      await usernameInput.fill('admin');
      await page.locator('#loginPassword').fill('admin@123');
      await page.locator('#btnLoginSubmit').click();
      await page.waitForTimeout(1500);
    }

    // Bấm tab "Giáo viên & Tổ chuyên môn"
    const navUsers = page.locator('#navTabUsers');
    await expect(navUsers).toBeVisible();
    await navUsers.click();
    await page.waitForTimeout(1000);

    // Bảng danh sách người dùng phải hiển thị
    await page.screenshot({ path: 'tests/screenshots/03_admin_users_table.png' });

    // Chuyển sang tab con Tổ chuyên môn nếu có
    const subTabDept = page.locator('button:has-text("Tổ chuyên môn"), a:has-text("Tổ chuyên môn")').first();
    if (await subTabDept.isVisible()) {
      await subTabDept.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: 'tests/screenshots/03_admin_departments_table.png' });
    }

    expect(consoleErrors, `Lỗi console khi quản trị viên thao tác: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });

});
