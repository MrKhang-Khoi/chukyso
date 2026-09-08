import { test, expect } from '@playwright/test';

test.describe('2. Kiểm thử Nghiệp vụ Giáo viên (Nộp bài, Chữ ký số, Danh mục)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Đảm bảo đăng nhập với tài khoản giáo viên cva.ty
    const usernameInput = page.locator('#loginUsername');
    if (await usernameInput.isVisible()) {
      await usernameInput.fill('cva.ty');
      await page.locator('#loginPassword').fill('123456');
      await page.locator('#btnLoginSubmit').click();
      await page.waitForTimeout(1500);
    }
  });

  test('Chuyển đổi mượt mà giữa các danh mục hồ sơ (Không phát sinh lỗi F12)', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('127.0.0.1:18888')) {
        consoleErrors.push(msg.text());
      }
    });

    // Tìm các tab danh mục
    const tabLesson = page.locator('button:has-text("Kế hoạch bài dạy")').first();
    const tabPersonal = page.locator('button:has-text("Giáo án cá nhân")').first();
    const tabReport = page.locator('button:has-text("Báo cáo liên cấp")').first();

    if (await tabLesson.isVisible()) await tabLesson.click();
    await page.waitForTimeout(500);

    if (await tabPersonal.isVisible()) await tabPersonal.click();
    await page.waitForTimeout(500);

    if (await tabReport.isVisible()) await tabReport.click();
    await page.waitForTimeout(500);

    // Quay lại tab chính
    if (await tabLesson.isVisible()) await tabLesson.click();
    await page.waitForTimeout(500);

    expect(consoleErrors).toHaveLength(0);
    await page.screenshot({ path: 'tests/screenshots/02_category_tabs.png' });
  });

  test('Mở và đóng Modal Nộp hồ sơ giáo án mới trơn tru', async ({ page }) => {
    const btnNewDoc = page.locator('#btnActionCreateDoc');
    await expect(btnNewDoc).toBeVisible();
    await btnNewDoc.click();
    await page.waitForTimeout(600);

    // Modal phải hiển thị
    const modalNewDoc = page.locator('#modalNewDoc');
    await expect(modalNewDoc).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/02_new_doc_modal.png' });

    // Đóng modal
    const btnClose = page.locator('#modalNewDoc button:has-text("Đóng"), #modalNewDoc button:has-text("Hủy"), #modalNewDoc button:has-text("Hủy bỏ")').first();
    if (await btnClose.isVisible()) {
      await btnClose.click();
      await page.waitForTimeout(400);
    }
  });

  test('Mở Modal Quản lý Mẫu chữ ký và Con dấu', async ({ page }) => {
    const btnSig = page.locator('button:has-text("Mẫu chữ ký"), button:has-text("Chữ ký tay")').first();
    if (await btnSig.isVisible()) {
      await btnSig.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: 'tests/screenshots/02_signature_pad_modal.png' });

      const btnCloseSig = page.locator('button:has-text("Đóng"), button:has-text("Hủy")').first();
      if (await btnCloseSig.isVisible()) {
        await btnCloseSig.click();
        await page.waitForTimeout(400);
      }
    }
  });

});
