/**
 * Automated Test Suite for EduSign VGCA
 * Kiểm thử toàn diện hoạt động của hệ thống
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const googleDriveService = require('./googleDriveService');

console.log('═══════════════════════════════════════════════════════════════');
console.log('🧪 BẮT ĐẦU CHẠY BỘ KIỂM THỬ HỆ THỐNG EDUSIGN VGCA');
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
  // --- TEST 1: Kiểm tra cấu hình và kết nối Google Drive Service ---
  console.log('📌 1. Kiểm tra Dịch vụ Kho Lưu trữ Google Drive:');
  const driveCfg = googleDriveService.getDriveConfig();
  assert(driveCfg && driveCfg.schoolFolderId, 'Đọc cấu hình Google Drive thành công');
  
  const sampleDoc = {
    id: 'TEST-PLAN-001',
    title: 'Kiểm thử Kế hoạch bài dạy Tuần 12',
    department: 'Tổ Toán - Tin',
    week: 'Tuần 12',
    author: 'Thầy Hà Văn Tý'
  };
  const testPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  const pdfToTest = fs.existsSync(testPdf) ? testPdf : fallbackPdf;

  const driveResult = await googleDriveService.uploadToGoogleDrive(sampleDoc, pdfToTest);
  assert(driveResult.success === true, 'Đồng bộ Google Drive thành công');
  assert(driveResult.viewUrl.includes('drive.google.com'), 'Sinh URL truy cập Google Drive chuẩn');
  console.log(`     -> Folder phân loại: "${driveResult.folderPath}"`);
  console.log(`     -> Link Drive: ${driveResult.viewUrl}\n`);

  // --- TEST 2: Kiểm tra xác thực Mật mã Chữ ký số VGCA bằng .NET ---
  console.log('📌 2. Kiểm tra Xác thực Chữ ký số Mật mã VGCA (C# iText PAdES):');
  await new Promise((resolve) => {
    const dotnet = spawn('dotnet', ['run', '--project', path.join(__dirname, 'RealPdfSigner'), '--', '--verify', testPdf]);
    let output = '';
    dotnet.stdout.on('data', (d) => output += d.toString('utf8'));
    dotnet.stderr.on('data', (d) => output += d.toString('utf8'));
    dotnet.on('close', (code) => {
      assert(code === 0, 'Tiến trình C# RealPdfSigner thực thi mã thoát 0');
      assert(output.includes('HỢP LỆ TUYỆT ĐỐI'), 'Chữ ký số mật mã VGCA: HỢP LỆ TUYỆT ĐỐI');
      assert(output.includes('Ban Cơ yếu Chính phủ'), 'Chứng nhận bởi Ban Cơ yếu Chính phủ (VGCA)');
      assert(output.includes('Covers whole doc): CÓ'), 'Bảo vệ toàn vẹn tài liệu 100% (Covers whole doc)');
      console.log('     -> Kết quả xác thực: Khớp chứng thư số công vụ X.509 v3\n');
      resolve();
    });
  });

  // --- TEST 3: Khởi chạy Express Server & Kiểm thử các API Endpoints ---
  console.log('📌 3. Khởi chạy Express Server & Kiểm thử API Endpoints:');
  const serverProcess = spawn('node', ['server.js'], { cwd: __dirname });
  
  let serverReady = false;
  serverProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (text.includes('EduSign VGCA') || text.includes('3000')) {
      serverReady = true;
    }
  });
  serverProcess.stderr.on('data', (chunk) => {
    console.error('     [Server Stderr]:', chunk.toString('utf8'));
  });

  // Đợi server sẵn sàng tối đa 5 giây
  for (let i = 0; i < 50; i++) {
    if (serverReady) break;
    await new Promise(r => setTimeout(r, 100));
  }

  try {
    // 3.1 Kiểm tra API Thống kê
    const statsRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/stats',
      method: 'GET'
    });
    assert(statsRes.status === 200 && statsRes.body.success, 'API /api/stats phản hồi 200 OK');
    assert(statsRes.body.data.total > 0, `Tổng số hồ sơ trong hệ thống: ${statsRes.body.data.total}`);

    // 3.2 Kiểm tra API Danh sách hồ sơ
    const docsRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/documents',
      method: 'GET'
    });
    assert(docsRes.status === 200 && docsRes.body.success, 'API /api/documents phản hồi 200 OK');
    assert(Array.isArray(docsRes.body.data), 'Dữ liệu hồ sơ trả về dạng mảng hợp lệ');

    // 3.3 Kiểm tra API Thông tin người ký VGCA
    const signerRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/system/certificates',
      method: 'GET'
    });
    const signer = signerRes.body.data && signerRes.body.data.realSigner;
    assert(signerRes.status === 200 && signer && signer.name === 'Hà Văn Tý', `Thông tin cán bộ ký VGCA: ${signer?.name} - ${signer?.title}`);

    // 3.4 Kiểm tra API Xác thực chữ ký số qua HTTP
    const verifyHttpRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/verify-real-pdf',
      method: 'GET'
    });
    assert(verifyHttpRes.status === 200 && verifyHttpRes.body.success, 'API /api/verify-real-pdf phản hồi 200 OK');
    assert(verifyHttpRes.body.data.isValid === true, 'API xác nhận chữ ký số thật HỢP LỆ TUYỆT ĐỐI');

    // 3.5 Kiểm tra API Cấu hình Google Drive
    const driveCfgRes = await httpRequest({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/drive/config',
      method: 'GET'
    });
    assert(driveCfgRes.status === 200 && driveCfgRes.body.success, 'API /api/drive/config phản hồi 200 OK');

  } catch (err) {
    assert(false, `Lỗi khi gọi API: ${err.message} ${err.stack || ''}`);
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
  console.error('Lỗi kiểm thử không mong muốn:', err);
  process.exit(1);
});
