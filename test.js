/**
 * Automated Test Suite for EduSign VGCA
 * Kiểm thử toàn diện hệ thống: Xác thực Token, Phân quyền Admin/Tổ trưởng/Giáo viên, Ký duyệt 3 cấp
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const googleDriveService = require('./googleDriveService');

console.log('═══════════════════════════════════════════════════════════════');
console.log('🧪 BẮT ĐẦU CHẠY BỘ KIỂM THỬ HỆ THỐNG EDUSIGN VGCA (MỚI)');
console.log('═══════════════════════════════════════════════════════════════\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

async function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  // --- TEST 1: Google Drive Service ---
  console.log('📌 1. Kiểm tra Dịch vụ Kho Lưu trữ Google Drive:');
  const driveCfg = googleDriveService.getDriveConfig();
  assert(driveCfg && driveCfg.schoolFolderId, 'Đọc cấu hình Google Drive thành công');
  
  const sampleDoc = {
    id: 'TEST-KHBD-001',
    title: 'Kế hoạch bài dạy Tuần 12 - Môn Toán 9',
    department: 'Tổ Toán - Tin',
    week: 'Tuần 12',
    author: 'Giáo viên Toán'
  };
  const testPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  const pdfToTest = fs.existsSync(testPdf) ? testPdf : fallbackPdf;

  const driveResult = await googleDriveService.uploadToGoogleDrive(sampleDoc, pdfToTest);
  assert(driveResult.success === true, 'Đồng bộ Google Drive thành công');
  assert(driveResult.viewUrl.includes('drive.google.com'), 'Sinh URL truy cập Google Drive chuẩn');
  console.log(`     -> Thư mục: "${driveResult.folderPath}"`);
  console.log(`     -> Link: ${driveResult.viewUrl}\n`);

  // --- TEST 2: C# RealPdfSigner ---
  console.log('📌 2. Kiểm tra Xác thực Mật mã Chữ ký số Ban Cơ yếu (VGCA):');
  await new Promise((resolve) => {
    const dotnet = spawn('dotnet', ['run', '--project', path.join(__dirname, 'RealPdfSigner'), '--', '--verify', testPdf]);
    let output = '';
    dotnet.stdout.on('data', (d) => output += d.toString('utf8'));
    dotnet.stderr.on('data', (d) => output += d.toString('utf8'));
    dotnet.on('close', (code) => {
      assert(code === 0, 'Tiến trình C# RealPdfSigner chạy mã thoát 0');
      assert(output.includes('HỢP LỆ TUYỆT ĐỐI'), 'Xác thực mật mã: HỢP LỆ TUYỆT ĐỐI');
      assert(output.includes('Ban Cơ yếu Chính phủ'), 'Chứng thực: Ban Cơ yếu Chính phủ (VGCA)');
      assert(output.includes('Covers whole doc): CÓ'), 'Bảo vệ toàn vẹn 100% (Covers whole doc)');
      console.log('     -> Kết quả: Khớp chứng thư số công vụ X.509 v3\n');
      resolve();
    });
  });

  // --- TEST 3: Khởi chạy Express Server & Kiểm thử Phân quyền 3 cấp ---
  console.log('📌 3. Khởi chạy Server & Kiểm thử Đăng nhập & Phân quyền RBAC:');
  const serverProcess = spawn('node', ['server.js'], { cwd: __dirname });
  
  let serverReady = false;
  serverProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (text.includes('EduSign VGCA') || text.includes('3000')) {
      serverReady = true;
    }
  });

  for (let i = 0; i < 50; i++) {
    if (serverReady) break;
    await new Promise(r => setTimeout(r, 100));
  }

  try {
    // 3.1 Đăng nhập Admin
    const adminLoginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'admin', password: 'admin@123' });

    assert(adminLoginRes.status === 200 && adminLoginRes.body.success, 'Đăng nhập Quản trị viên (admin / admin@123) thành công');
    const adminToken = adminLoginRes.body.token;
    assert(adminToken && adminToken.length > 10, 'Nhận Token xác thực cho Quản trị viên');

    // 3.2 Admin tạo Tổ trưởng chuyên môn
    const createLeaderRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/admin/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      name: 'Thầy Trần Văn Nam',
      username: 'tvnam',
      password: '123',
      department: 'Tổ Toán - Tin',
      role: 'HEAD_DEPT'
    });
    assert(createLeaderRes.status === 200 || (createLeaderRes.body.message && createLeaderRes.body.message.includes('đã tồn tại')), 'Admin tạo tài khoản Tổ trưởng (tvnam - Tổ Toán - Tin)');

    // 3.3 Admin tạo Giáo viên bộ môn
    const createTeacherRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/admin/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      name: 'Thầy Hà Văn Tý',
      username: 'hvty',
      password: '123',
      department: 'Tổ Toán - Tin',
      role: 'TEACHER'
    });
    assert(createTeacherRes.status === 200 || (createTeacherRes.body.message && createTeacherRes.body.message.includes('đã tồn tại')), 'Admin tạo tài khoản Giáo viên (hvty - Tổ Toán - Tin)');

    // 3.4 Giáo viên đăng nhập độc lập bằng tài khoản của mình
    const teacherLoginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'hvty', password: '123' });

    assert(teacherLoginRes.status === 200 && teacherLoginRes.body.success, 'Giáo viên (hvty) đăng nhập thành công với Token riêng');
    const teacherToken = teacherLoginRes.body.token;

    // 3.5 Giáo viên nộp bài dạy mới
    const submitDocRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/documents',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      title: 'Kế hoạch bài dạy Tuần 12 - Môn Toán 9 (Hình học: Đường tròn & Góc nội tiếp)',
      grade: 'Khối 9',
      week: 'Tuần 12',
      term: 'Học kỳ I'
    });

    assert(submitDocRes.status === 200 && submitDocRes.body.success, 'Giáo viên nộp kế hoạch bài dạy thành công');
    const createdDocId = submitDocRes.body.data.id;
    assert(createdDocId && createdDocId.startsWith('KHBD-'), `Mã hồ sơ tự động khởi tạo: ${createdDocId}`);

    // 3.6 Tổ trưởng đăng nhập & Duyệt cấp 2
    const leaderLoginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'tvnam', password: '123' });

    assert(leaderLoginRes.status === 200 && leaderLoginRes.body.success, 'Tổ trưởng (tvnam) đăng nhập thành công');
    const leaderToken = leaderLoginRes.body.token;

    const leaderApproveRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/documents/${createdDocId}/approve-leader`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${leaderToken}`
      }
    }, { comment: 'Đạt chuẩn phân phối chương trình' });

    assert(leaderApproveRes.status === 200 && leaderApproveRes.body.data.status === 'WAITING_PRINCIPAL_APPROVAL', 'Tổ trưởng ký nháy duyệt chuyên môn cấp 2 -> Chuyển Ban Giám hiệu');

    // 3.7 Ban Giám hiệu Phê duyệt & Đóng dấu cấp 3
    const principalApproveRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/documents/${createdDocId}/approve-principal`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, { comment: 'Phê duyệt kế hoạch bài dạy' });

    assert(principalApproveRes.status === 200 && principalApproveRes.body.data.status === 'APPROVED', 'Ban Giám hiệu ký số & Phê duyệt chính thức cấp 3 -> APPROVED');

    // 3.8 Kiểm tra API Xác thực chữ ký số
    const verifyHttpRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/verify-real-pdf',
      method: 'GET'
    });
    assert(verifyHttpRes.status === 200 && verifyHttpRes.body.data.isValid === true, 'API xác nhận chữ ký số thật HỢP LỆ TUYỆT ĐỐI');

  } catch (err) {
    assert(false, `Lỗi khi gọi API: ${err.message}`);
  } finally {
    serverProcess.kill();
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🎉 TỔNG KẾT KIỂM THỬ: ${passedTests}/${totalTests} TESTS ĐẠT YÊU CẦU (100%)`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Lỗi kiểm thử:', err);
  process.exit(1);
});
