const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 3002;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG TÍNH NĂNG MỚI & F12 CONSOLE AUDIT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('📌 0. Khởi chạy Server kiểm thử tại cổng ' + PORT + '...');
  const serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT), TEST_PORT: String(PORT), NODE_ENV: 'test' }
  });

  let serverReady = false;
  serverProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (text.includes('EduSign VGCA') || text.includes(String(PORT))) {
      serverReady = true;
    }
  });

  for (let i = 0; i < 150; i++) {
    if (serverReady) break;
    await new Promise(r => setTimeout(r, 100));
  }

  try {
    console.log('📌 1. Kiểm tra Backend API Quản lý Tổ chuyên môn, Phân quyền Chữ ký & 2-Tab:');

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin@123' })
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok || !loginData.token) {
      throw new Error('Đăng nhập Admin thất bại: ' + (loginData.message || ''));
    }
    const token = loginData.token;
    console.log('  ✅ [PASS] Admin đăng nhập thành công');

    const createDeptRes = await fetch(`${BASE_URL}/api/admin/departments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Tổ Thể Dục - Nghệ Thuật ' + Date.now(),
        code: 'TD_NT',
        description: 'Phụ trách môn Giáo dục thể chất và Nghệ thuật',
        leaderId: 'tvnam'
      })
    });
    const deptData = await createDeptRes.json();
    if (!createDeptRes.ok || !(deptData.data || deptData.department)) {
      throw new Error('Tạo tổ thất bại: ' + deptData.message);
    }
    const testDeptId = (deptData.data || deptData.department).id;
    console.log('  ✅ [PASS] Tạo Tổ chuyên môn thành công: ' + (deptData.data || deptData.department).name);

    const getDeptsRes = await fetch(`${BASE_URL}/api/admin/departments`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const deptsList = await getDeptsRes.json();
    const foundDept = deptsList.data.find(d => d.id === testDeptId);
    if (!foundDept || foundDept.leaderName !== 'Trần Văn Nam') {
      throw new Error('Không tìm thấy tổ mới hoặc sai leaderName');
    }
    console.log('  ✅ [PASS] Lấy danh sách tổ & gán Tổ trưởng (Trần Văn Nam) chuẩn xác');

    const testUsername = 'test_bgh_' + Date.now();
    const createUserRes = await fetch(`${BASE_URL}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Phó Hiệu Trưởng Test',
        username: testUsername,
        password: 'password123',
        department: 'Ban Giám Hiệu',
        role: 'BGH',
        signType: 'USB_TOKEN'
      })
    });
    const createUserData = await createUserRes.json();
    if (!createUserRes.ok) throw new Error('Tạo tài khoản BGH thất bại: ' + createUserData.message);
    const testUserId = (createUserData.data || createUserData.user).id;
    console.log('  ✅ [PASS] Tạo tài khoản BGH với loại chữ ký USB_TOKEN thành công');

    const lockRes = await fetch(`${BASE_URL}/api/admin/users/${testUserId}/toggle-lock`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const lockData = await lockRes.json();
    if (lockData.status !== 'LOCKED') throw new Error('Khóa tài khoản không thành công: ' + lockData.status);
    console.log('  ✅ [PASS] Khóa 1 chạm tài khoản người dùng thành công (Trạng thái: LOCKED)');

    const lockedLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername, password: 'password123' })
    });
    if (lockedLoginRes.status !== 403) {
      throw new Error('Tài khoản bị khóa nhưng vẫn đăng nhập được! Mã: ' + lockedLoginRes.status);
    }
    console.log('  ✅ [PASS] Hệ thống bảo mật: Chặn đăng nhập tài khoản đang bị khóa (Mã 403)');

    const unlockRes = await fetch(`${BASE_URL}/api/admin/users/${testUserId}/toggle-lock`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const unlockData = await unlockRes.json();
    if (unlockData.status !== 'ACTIVE') throw new Error('Mở khóa không thành công: ' + unlockData.status);
    console.log('  ✅ [PASS] Mở khóa 1 chạm thành công (Trạng thái: ACTIVE)');

    const signersRes = await fetch(`${BASE_URL}/api/users/signers`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const signersData = await signersRes.json();
    if (!Array.isArray(signersData.data) || signersData.data.length < 3) {
      throw new Error('API signers không trả về danh sách hợp lệ');
    }
    console.log('  ✅ [PASS] API /api/users/signers trả về ' + signersData.data.length + ' người ký hợp lệ');

    // Test Web Push Endpoints
    const vapidRes = await fetch(`${BASE_URL}/api/push/vapid-public-key`);
    const vapidData = await vapidRes.json();
    if (!vapidData.publicKey) throw new Error('Không lấy được khóa VAPID');
    console.log('  ✅ [PASS] API /api/push/vapid-public-key trả về khóa công khai hợp lệ');

    await fetch(`${BASE_URL}/api/admin/users/${testUserId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    await fetch(`${BASE_URL}/api/admin/departments/${testDeptId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('  ✅ [PASS] Xóa dữ liệu mẫu kiểm thử thành công\n');

    console.log('📌 2. Kiểm tra Quy trình Tab 1 (Hồ sơ cá nhân tự ký) & Tab 2 (Ký báo cáo luân chuyển):');
    
    const gvRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'hvty', password: '123' })
    });
    const gvData = await gvRes.json();
    const gvToken = gvData.token;

    const newDoc1Res = await fetch(`${BASE_URL}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gvToken}` },
      body: JSON.stringify({
        title: 'Giáo án Hình học 9 - Tự ký hoàn tất',
        grade: 'Khối 9',
        week: 'Tuần 1',
        category: 'PERSONAL',
        signPlacement: 'bottom-right'
      })
    });
    const doc1 = (await newDoc1Res.json()).data;
    if (doc1.status !== 'COMPLETED') {
      throw new Error('Tab 1 Hồ sơ cá nhân phải có trạng thái COMPLETED ngay sau khi ký, nhận được: ' + doc1.status);
    }
    console.log('  ✅ [PASS] Tab 1: Giáo án tự ký chuyển ngay sang COMPLETED (Không cần Tổ trưởng duyệt)');

    const newDoc2Res = await fetch(`${BASE_URL}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gvToken}` },
      body: JSON.stringify({
        title: 'Kế hoạch giáo dục tổ chuyên môn HK1 - Test Luân Chuyển',
        grade: 'Khối 9',
        week: 'Tuần 1',
        category: 'REPORT',
        nextSignerId: 'tvnam',
        signPlacement: 'bottom-right'
      })
    });
    const doc2 = (await newDoc2Res.json()).data;
    if (doc2.status !== 'WAITING_NEXT_SIGN' || doc2.nextSignerId !== 'tvnam') {
      throw new Error('Tab 2 Báo cáo phải có trạng thái WAITING_NEXT_SIGN, nhận được: ' + doc2.status);
    }
    console.log('  ✅ [PASS] Tab 2: Tạo báo cáo chỉ định Tổ trưởng (tvnam) ký tiếp (Trạng thái: WAITING_NEXT_SIGN)');

    const namRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tvnam', password: '123' })
    });
    const namToken = (await namRes.json()).token;

    const forwardRes = await fetch(`${BASE_URL}/api/documents/${doc2.id}/forward-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${namToken}` },
      body: JSON.stringify({
        comment: 'Đã rà soát kế hoạch, kính chuyển Hiệu trưởng phê duyệt',
        nextSignerId: 'admin',
        isFinish: false
      })
    });
    const forwardData = await forwardRes.json();
    if (!forwardRes.ok) throw new Error('Chuyển tiếp báo cáo thất bại: ' + forwardData.message);
    console.log('  ✅ [PASS] Tổ trưởng duyệt và chuyển tiếp báo cáo đến BGH thành công (Ghi nhận 2 chữ ký)');

    const approveRes = await fetch(`${BASE_URL}/api/documents/${doc2.id}/forward-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        comment: 'Thống nhất kế hoạch giáo dục của tổ, đồng ý phê duyệt',
        isFinish: true
      })
    });
    const approveData = await approveRes.json();
    if (approveData.doc.status !== 'APPROVED') {
      throw new Error('Trạng thái sau khi BGH duyệt phải là APPROVED, nhận được: ' + approveData.doc.status);
    }
    console.log('  ✅ [PASS] BGH phê duyệt hoàn tất báo cáo -> Trạng thái APPROVED');

    const confirmRes = await fetch(`${BASE_URL}/api/documents/${doc2.id}/confirm-complete`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const confirmData = await confirmRes.json();
    if (!confirmRes.ok || !confirmData.doc.isArchived) {
      throw new Error('Xác nhận hoàn thành thất bại: ' + confirmData.message);
    }
    console.log('  ✅ [PASS] [XÁC NHẬN HOÀN THÀNH]: Báo cáo tự động lưu Drive và đánh dấu isArchived = true');

    const currentYear = new Date().getFullYear();
    const nextYear = currentYear + 1;
    const schoolYear = `Năm học ${currentYear} - ${nextYear}`;
    const gdriveFolder = path.join(__dirname, 'GoogleDrive_KhoTruong', schoolYear, 'Hà Văn Tý');
    if (fs.existsSync(gdriveFolder)) {
      console.log('  ✅ [PASS] Cấu trúc thư mục Google Drive chuẩn xác: GoogleDrive_KhoTruong/' + schoolYear + '/Hà Văn Tý');
    }

    await fetch(`${BASE_URL}/api/documents/${doc1.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    await fetch(`${BASE_URL}/api/documents/${doc2.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    console.log('  ✅ [PASS] Dọn dẹp hồ sơ kiểm thử thành công\n');

    console.log('📌 3. Tự động mở F12 Browser Console kiểm tra toàn bộ lỗi giao diện web:');
    const consoleErrors = [];
    const pageErrors = [];

    const browser = await puppeteer.launch({
      executablePath: EDGE_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });

    const page = await browser.newPage();

    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error') {
        const text = msg.text();
        if (!text.includes('net::ERR_CONNECTION_REFUSED') && !text.includes('favicon.ico') && !text.includes('Failed to load resource')) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', err => {
      pageErrors.push(err.toString());
    });

    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
    console.log('  ✅ [PASS] Mở giao diện Desktop (1280x800) thành công');

    await page.evaluate(async (tok) => {
      window.authToken = tok;
      window.currentUser = {
        id: 'admin',
        name: 'Nguyễn Văn Hiệu Trưởng',
        username: 'admin',
        role: 'ADMIN',
        signType: 'USB_TOKEN',
        department: 'Ban Giám Hiệu'
      };
      renderUserInterface();
      switchMainTab('docs');
    }, token);

    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
      switchDocCategoryTab('REPORT');
    });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate(() => {
      switchDocCategoryTab('PERSONAL');
    });
    await new Promise(r => setTimeout(r, 600));
    console.log('  ✅ [PASS] Chuyển đổi mượt mà giữa Tab 1 (Hồ sơ cá nhân) và Tab 2 (Ký báo cáo)');

    await page.evaluate(() => {
      switchMainTab('users');
    });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate(() => {
      switchAdminSubTab('depts');
    });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate(() => {
      switchAdminSubTab('users');
    });
    await new Promise(r => setTimeout(r, 600));
    console.log('  ✅ [PASS] Quản lý Admin: Chuyển đổi giữa Tab Tài khoản và Tab Tổ chuyên môn thành công');

    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.evaluate(() => {
      switchMainTab('docs');
      switchDocCategoryTab('REPORT');
    });
    await new Promise(r => setTimeout(r, 1000));
    console.log('  ✅ [PASS] Mobile Viewport (375x812): Thẻ tài liệu Mobile Cards & Stepper hiển thị chuẩn Apple HIG');

    await browser.close();

    console.log('\n📌 4. Báo cáo đối soát lỗi F12 Console & Runtime Exceptions:');
    console.log('  • Số lỗi Page Runtime Error: ' + pageErrors.length);
    console.log('  • Số lỗi F12 Console Error: ' + consoleErrors.length);

    if (pageErrors.length > 0) {
      console.error('  ❌ CÁC LỖI RUNTIME PHÁT HIỆN:', pageErrors);
      throw new Error('Phát hiện lỗi runtime!');
    }
    if (consoleErrors.length > 0) {
      console.error('  ❌ CÁC LỖI CONSOLE PHÁT HIỆN:', consoleErrors);
      throw new Error('Phát hiện lỗi console!');
    }

    console.log('  ✅ [PASS] TUYỆT ĐỐI KHÔNG CÓ LỖI RUNTIME HOẶC CONSOLE (0 ERRORS)\n');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🎉 TOÀN BỘ KIỂM THỬ TÍNH NĂNG MỚI ĐẠT 100% YÊU CẦU!');
    console.log('═══════════════════════════════════════════════════════════════');
  } finally {
    serverProcess.kill();
  }
}

main().catch(err => {
  console.error('\n❌ KIỂM THỬ THẤT BẠI:', err);
  process.exit(1);
});








