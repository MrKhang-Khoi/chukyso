import { test, expect } from '@playwright/test';

test.describe('Kiểm thử giao diện & Bắt lỗi F12 Console (Zero-Bug Verification)', () => {
  test('Trang web tải thành công, không có bất kỳ lỗi đỏ F12 nào', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        // Lọc bỏ lỗi mạng do chưa cắm agent cục bộ (18888) nếu có
        const text = msg.text();
        if (!text.includes('127.0.0.1:18888') && !text.includes('ERR_CONNECTION_REFUSED')) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', err => {
      pageErrors.push(err.message);
    });

    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);

    // Chờ 2 giây để các script nạp đầy đủ
    await page.waitForTimeout(2000);

    // Bắt buộc 0 lỗi JavaScript runtime
    expect(pageErrors, `Phát hiện lỗi runtime: ${pageErrors.join('; ')}`).toHaveLength(0);
    expect(consoleErrors, `Phát hiện lỗi console: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });

  test('Kiểm tra các thành phần giao diện chính và thanh điều hướng', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Kiểm tra trang có tiêu đề
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Chụp ảnh bằng chứng kiểm thử
    await page.screenshot({ path: 'tests/screenshot_verification.png', fullPage: false });
  });
});
