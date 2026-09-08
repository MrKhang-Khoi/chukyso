import { test, expect } from '@playwright/test';

test('Verify Multi-Party Signing and Session Isolation', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('127.0.0.1:18888')) {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');

  // 1. Dang nhap voi tai khoan giao vien cva.ty
  const usernameInput = page.locator('#loginUsername');
  if (await usernameInput.isVisible()) {
    await usernameInput.fill('cva.ty');
    await page.locator('#loginPassword').fill('123456');
    await page.locator('#btnLoginSubmit').click();
    await page.waitForTimeout(1000);
  }

  // Cho giao dien dashboard hien len
  await expect(page.locator('#navTabDocs')).toBeVisible();
  await expect(page.locator('text=Hà Văn Tý').first()).toBeVisible();

  // 2. Kiem tra luu tru thong tin VGCA sau do Dang xuat (Clean Session Isolation)
  await page.evaluate(() => {
    localStorage.setItem('edusign_vgca_user', JSON.stringify({ account: '042084002100' }));
    window._lastDetectedVgcaCert = { Subject: 'CN=Test' };
  });

  // Nhan nut dang xuat qua ham handleLogout()
  await page.evaluate(() => handleLogout());
  await page.waitForSelector('#loginForm');

  const token = await page.evaluate(() => localStorage.getItem('edusign_token'));
  const vgcaUser = await page.evaluate(() => localStorage.getItem('edusign_vgca_user'));
  const cert = await page.evaluate(() => window._lastDetectedVgcaCert);
  expect(token).toBeNull();
  expect(vgcaUser).toBeNull();
  expect(cert).toBeNull();

  // 3. Dang nhap voi tai khoan Admin / Ban Giam Hieu de kiem tra Tab 2
  await page.locator('#loginUsername').fill('admin');
  await page.locator('#loginPassword').fill('admin@123');
  await page.locator('#btnLoginSubmit').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('#navTabUsers')).toBeVisible();

  // 4. Chuyen sang Tab 2: Ký báo cáo & Luân chuyển
  await page.click('#tabBtnReportDocs');
  await page.waitForTimeout(500);
  const heading = await page.textContent('#docsViewHeading');
  expect(heading).toContain('Ký báo cáo');

  // 5. Mo Modal Ký Chuyen Tiep (Forward Sign)
  await page.evaluate(() => openModal('modalForwardSign'));
  await page.waitForSelector('#modalForwardSign:not(.hidden)');

  // Chon radio FINAL_FINISH (Hoan tat cac cap ky)
  await page.click('input[name="forwardTargetType"][value="FINAL_FINISH"]');
  const btnText = await page.textContent('#btnSubmitForwardSign');
  expect(btnText).toContain('Chốt Hoàn Tất');

  // Chon lai radio NEXT_USER
  await page.click('input[name="forwardTargetType"][value="NEXT_USER"]');
  const btnText2 = await page.textContent('#btnSubmitForwardSign');
  expect(btnText2).toContain('Chuyển Tiếp Ngay');

  await page.click('#modalForwardSign button:has-text("Hủy")');
  await page.waitForTimeout(300);

  // 6. Screenshot minh chung
  await page.screenshot({ path: 'tests/screenshots/test_multi_signing_passed.png', fullPage: true });

  // 7. Bắt sạch lỗi Console F12
  const critical = consoleErrors.filter(e => 
    !e.includes('favicon') && 
    !e.includes('ERR_CONNECTION_REFUSED') && 
    (e.includes('TypeError') || e.includes('ReferenceError') || e.includes('SyntaxError'))
  );
  expect(critical.length).toBe(0);
});
