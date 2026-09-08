import { test, expect } from '@playwright/test';

test.describe('1. Kiểm thử Đăng nhập, Phân quyền & Đăng xuất (RBAC)', () => {

  test('Đăng nhập Giáo viên (cva.ty) thành công và hiển thị giao diện giáo viên', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('127.0.0.1:18888')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Nếu đang ở màn hình đăng nhập
    const usernameInput = page.locator('#loginUsername');
    if (await usernameInput.isVisible()) {
      await usernameInput.fill('cva.ty');
      await page.locator('#loginPassword').fill('123456');
      await page.locator('#btnLoginSubmit').click();
      await page.waitForTimeout(1500);
    }

    // Kiểm tra đã vào Dashboard
    await expect(page.locator('#navTabDocs')).toBeVisible();
    await expect(page.locator('text=Hà Văn Tý').first()).toBeVisible();

    expect(consoleErrors, `Lỗi console khi giáo viên đăng nhập: ${consoleErrors.join('; ')}`).toHaveLength(0);
    await page.screenshot({ path: 'tests/screenshots/01_teacher_dashboard.png' });
  });

  test('Đăng nhập Quản trị viên (admin) hiển thị đầy đủ quyền Quản trị', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Đăng xuất nếu đang đăng nhập tài khoản khác
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
    await expect(usernameInput).toBeVisible();
    await usernameInput.fill('admin');
    await page.locator('#loginPassword').fill('admin@123');
    await page.locator('#btnLoginSubmit').click();
    await page.waitForTimeout(1500);

    // Admin phải thấy tab "Giáo viên & Tổ chuyên môn"
    await expect(page.locator('#navTabUsers')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/01_admin_dashboard.png' });
  });

});
