import { test, expect } from '@playwright/test';

test.describe('4. Kiểm thử Giao diện Responsive Mobile (Di động)', () => {

  test.use({ viewport: { width: 390, height: 844 } }); // Kích thước iPhone 14 chuẩn

  test('Giao diện hiển thị chuẩn xác trên màn hình điện thoại, không bị tràn viền ngang', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('127.0.0.1:18888')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Kiểm tra không bị tràn chiều ngang (Horizontal overflow bug)
    const isOverflown = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(isOverflown, 'Giao diện bị tràn viền ngang trên điện thoại!').toBeFalsy();

    // Chụp ảnh giao diện di động
    await page.screenshot({ path: 'tests/screenshots/04_mobile_view.png', fullPage: false });
    expect(consoleErrors).toHaveLength(0);
  });

});
