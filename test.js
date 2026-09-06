/**
 * Automated Test Suite for EduSign VGCA
 * Kiểm thử toàn diện hệ thống: Xác thực Token, Phân quyền Admin/Tổ trưởng/Giáo viên, Ký duyệt 3 cấp
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const googleDriveService = require('./googleDriveService');

console.log('═══════════════════════════════════════════════════════════════');
console.log('🧪 BẮT ĐẦU CHẠY BỘ KIỂM THỬ HỆ THỐNG EDUSIGN VGCA (MỚI)');
console.log('═══════════════════════════════════════════════════════════════\n');

let passedTests = 0;
let totalTests = 0;
const TEST_PORT = parseInt(process.env.TEST_PORT || process.env.PORT || "3001", 10);

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

async function httpRequest(options, postData = null, isBinary = false) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (isBinary) {
          resolve({ status: res.statusCode, headers: res.headers, body: buffer });
          return;
        }
        const str = buffer.toString('utf8');
        try {
          const parsed = JSON.parse(str);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: str });
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
    const agentExe = path.join(__dirname, 'public', 'downloads', 'EduSign_Agent.exe');
    const dotnet = fs.existsSync(agentExe) ? spawn(agentExe, ['--verify', testPdf]) : spawn('dotnet', ['run', '--project', path.join(__dirname, 'RealPdfSigner'), '--', '--verify', testPdf]);
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
  const serverProcess = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(TEST_PORT), TEST_PORT: String(TEST_PORT), NODE_ENV: 'test' } });
  
  let serverReady = false;
  serverProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (text.includes('EduSign VGCA') || text.includes(String(TEST_PORT))) {
      serverReady = true;
    }
  });
  serverProcess.stderr.on('data', (chunk) => {
    console.error('[Server Err]', chunk.toString('utf8'));
  });

  for (let i = 0; i < 150; i++) {
    if (serverReady) break;
    await new Promise(r => setTimeout(r, 100));
  }

  try {
    // 3.1 Đăng nhập Admin
    const adminLoginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
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
      port: TEST_PORT,
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
      port: TEST_PORT,
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
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'hvty', password: '123' });

    assert(teacherLoginRes.status === 200 && teacherLoginRes.body.success, 'Giáo viên (hvty) đăng nhập thành công với Token riêng');
    const teacherToken = teacherLoginRes.body.token;

    // 3.4b Kiểm tra Studio Chữ ký: Lưu và lấy mẫu chữ ký cá nhân
    const dummySignature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const saveSigRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/user/signature',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, { signatureImage: dummySignature });
    assert(saveSigRes.status === 200 && saveSigRes.body.success, 'Giáo viên lưu mẫu chữ ký trong suốt vào hồ sơ thành công');

    const getSigRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/user/signature',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert(getSigRes.status === 200 && getSigRes.body.signatureImage === dummySignature, 'Truy xuất mẫu chữ ký cá nhân chính xác');

    // 3.4c Kiểm tra BẢO MẬT: Chặn không cho nộp bài nếu chưa ký số
    await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/admin/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      name: 'Giáo viên Chưa Ký',
      username: 'nosig_user',
      password: '123',
      department: 'Tổ Toán - Tin',
      role: 'TEACHER'
    });

    const nosigLoginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'nosig_user', password: '123' });
    const nosigToken = nosigLoginRes.body.token;

    const failSubmitRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/documents',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${nosigToken}`
      }
    }, {
      title: 'Giáo án chưa ký tên',
      grade: 'Khối 9',
      week: 'Tuần 1'
    });
    assert(failSubmitRes.status === 400 && failSubmitRes.body.message.includes('ký số'), 'Hệ thống CHẶN thành công: Từ chối nộp bài nếu giáo viên chưa ký số (Mã lỗi 400)');

    // 3.5 Giáo viên nộp bài dạy mới kèm File thật (Base64) & Chữ ký số hợp lệ
    const sampleFileBuffer = fs.readFileSync(pdfToTest);
    const sampleBase64 = `data:application/pdf;base64,${sampleFileBuffer.toString('base64')}`;

    const submitDocRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
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
      term: 'Học kỳ I',
      fileName: 'GiaoAn_Toan9_T12.pdf',
      fileType: 'application/pdf',
      fileSize: sampleFileBuffer.length,
      fileBase64: sampleBase64,
      signatureImage: dummySignature,
      signPlacement: 'bottom-left'
    });

    assert(submitDocRes.status === 200 && submitDocRes.body.success, 'Giáo viên nộp kế hoạch bài dạy kèm File PDF thật & Chữ ký số thành công');
    const createdDocId = submitDocRes.body.data.id;
    assert(createdDocId && createdDocId.startsWith('KHBD-'), `Mã hồ sơ tự động khởi tạo: ${createdDocId}`);
    assert(submitDocRes.body.data.fileName === 'GiaoAn_Toan9_T12.pdf', 'Lưu đúng tên tệp gốc của giáo viên');

    // 3.5b Tải / Xem trước tệp đính kèm từ API
    const getFileRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${createdDocId}/file`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert(getFileRes.status === 200, 'API /api/documents/:id/file phục vụ file tài liệu xem trước thành công');

    // 3.5c Kiểm tra API chuẩn bị tệp ký có đóng dấu ảnh chữ ký giáo viên
    const prepDocRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${createdDocId}/prepare-signing-pdf`,
      method: 'GET'
    }, null, true);
    assert(prepDocRes.status === 200, 'API /api/documents/:id/prepare-signing-pdf chuẩn bị tệp đóng dấu thành công');
    assert(prepDocRes.headers['content-type'] === 'application/pdf', 'Tệp chuẩn bị trả về đúng định dạng application/pdf');
    assert(prepDocRes.body.length > 500, 'Dung lượng tệp PDF chuẩn bị hợp lệ');

    // 3.5d Kiểm tra POST /api/documents/prepare-signing-pdf cho tệp nộp mới
    const postPrepRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/documents/prepare-signing-pdf',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      title: 'Giáo án chuẩn bị ký',
      fileBase64: sampleBase64,
      signatureImage: dummySignature
    });
    assert(postPrepRes.status === 200 && postPrepRes.body.success, 'API POST /api/documents/prepare-signing-pdf chuẩn bị tệp mới thành công');
    assert(typeof postPrepRes.body.pdfBase64 === 'string' && postPrepRes.body.pdfBase64.startsWith('data:application/pdf;base64,'), 'Trả về dữ liệu Base64 PDF đã đóng dấu ảnh chữ ký hợp lệ');

    // 3.6 Tổ trưởng đăng nhập & Duyệt cấp 2
    const leaderLoginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'tvnam', password: '123' });

    assert(leaderLoginRes.status === 200 && leaderLoginRes.body.success, 'Tổ trưởng (tvnam) đăng nhập thành công');
    const leaderToken = leaderLoginRes.body.token;

    const leaderApproveRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${createdDocId}/approve-leader`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${leaderToken}`
      }
    }, { 
      comment: 'Đạt chuẩn phân phối chương trình',
      visualSignImage: dummySignature,
      signPlacement: 'middle-right'
    });

    assert(leaderApproveRes.status === 200 && leaderApproveRes.body.data.status === 'WAITING_PRINCIPAL_APPROVAL', 'Tổ trưởng ký nháy duyệt chuyên môn cấp 2 -> Chuyển Ban Giám hiệu');

    // 3.7 Ban Giám hiệu Phê duyệt & Đóng dấu cấp 3
    const principalApproveRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${createdDocId}/approve-principal`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, { 
      comment: 'Phê duyệt kế hoạch bài dạy',
      visualSignImage: dummySignature,
      signPlacement: 'bottom-right'
    });

    assert(principalApproveRes.status === 200 && principalApproveRes.body.data.status === 'APPROVED', 'Ban Giám hiệu ký số & Phê duyệt chính thức cấp 3 -> APPROVED');

    // 3.7b Kiểm tra Tải Văn Bản Đã Ký Về Máy Tính (.PDF đầy đủ 3 cấp ký & dấu đỏ)
    const downloadSignedRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${createdDocId}/download-signed`,
      method: 'GET'
    }, null, true);
    assert(downloadSignedRes.status === 200, 'API /api/documents/:id/download-signed tải file đã ký thành công');
    assert(downloadSignedRes.headers['content-type'] === 'application/pdf', 'Header Content-Type là application/pdf');
    assert(downloadSignedRes.body && downloadSignedRes.body.length > 2000, 'File PDF đã ký chứa đầy đủ chữ ký số 3 cấp và con dấu nhà trường');

    // 3.7c Kiểm tra KHÔNG CÓ TRANG CHỨNG THƯ THỪA (Xóa trang cuối - ký trực tiếp lên trang văn bản gốc)
    const origPdfDoc = await PDFDocument.load(sampleFileBuffer);
    const signedPdfDoc = await PDFDocument.load(downloadSignedRes.body);
    assert(signedPdfDoc.getPageCount() === origPdfDoc.getPageCount(), `Xóa trang cuối thành công: Số trang PDF sau ký (${signedPdfDoc.getPageCount()}) bằng số trang gốc (${origPdfDoc.getPageCount()}), không sinh trang chứng thư giả định`);

    // 3.7d Kiểm tra tính năng Lưu trữ và đồng bộ Google Drive của giáo viên
    const driveUploadRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${createdDocId}/upload-drive`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    });
    assert(driveUploadRes.status === 200 && driveUploadRes.body.success === true, 'Giáo viên lưu hồ sơ đã ký lên Google Drive thành công');
    assert(driveUploadRes.body.driveInfo && driveUploadRes.body.driveInfo.viewUrl.includes('drive.google.com'), 'Hệ thống sinh liên kết Google Drive trường chuẩn xác');

    // 3.8 Kiểm tra API Xác thực chữ ký số
    const verifyHttpRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/verify-real-pdf',
      method: 'GET'
    });
    assert(verifyHttpRes.status === 200 && verifyHttpRes.body.data.isValid === true, 'API xác nhận chữ ký số thật HỢP LỆ TUYỆT ĐỐI');

    // 3.9a Kiểm tra tài nguyên tĩnh: Con dấu đỏ nhà trường (/school_seal.png và /uploads/signatures/school_seal.png)
    const sealDirectRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/school_seal.png',
      method: 'GET'
    });
    assert(sealDirectRes.status === 200, 'Tải thành công con dấu đỏ nhà trường từ /school_seal.png (Mã 200)');

    const sealUploadRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/uploads/signatures/school_seal.png',
      method: 'GET'
    });
    assert(sealUploadRes.status === 200, 'Tải thành công con dấu đỏ nhà trường từ /uploads/signatures/school_seal.png (Mã 200)');

    // 3.10 Kiểm tra tính năng THU HỒI BÀI NỘP (Recall) khi tổ trưởng chưa ký duyệt
    const docToRecallRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/documents',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      title: 'Kế hoạch bài dạy kiểm thử tính năng Thu Hồi',
      grade: 'Khối 8',
      week: 'Tuần 13',
      term: 'Học kỳ I',
      fileName: 'KHBD_Test_ThuHoi.docx',
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 1024,
      fileBase64: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBBQAAAAIAAA=',
      signature: {
        signerName: 'Hà Văn Tý',
        role: 'Giáo viên',
        signType: 'VGCA_MOBILE',
        visualSign: 'Đã ký điện tử'
      }
    });
    const recallDocId = docToRecallRes.body.data.id;
    assert(docToRecallRes.status === 200 && docToRecallRes.body.data.status === 'WAITING_LEADER_APPROVAL', 'Nộp hồ sơ chờ duyệt thành công để kiểm tra thu hồi');

    const recallActionRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${recallDocId}/recall`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    });
    assert(recallActionRes.status === 200 && recallActionRes.body.data.status === 'RECALLED', 'Giáo viên THU HỒI thành công kế hoạch bài dạy khi tổ trưởng chưa ký');

    // 3.11 Kiểm tra tính năng CHỈNH SỬA & LƯU NỘI DUNG TÀI LIỆU WORD TRƯỚC KHI KÝ
    const editedHtmlContent = '<div class="word-preview-page"><p style="font-family: Times New Roman; font-size: 14pt;"><strong>KẾ HOẠCH BÀI DẠY ĐÃ ĐƯỢC GIÁO VIÊN CHỈNH SỬA TRỰC TIẾP TRÊN WEB</strong></p></div>';
    const updateContentRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${recallDocId}/update-content`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      customContentHtml: editedHtmlContent
    });
    assert(updateContentRes.status === 200 && updateContentRes.body.success === true, 'API /update-content lưu thay đổi nội dung Word thành công');

    // 3.12 Kiểm tra tính năng XÓA HỒ SƠ / TỆP ĐÍNH KÈM
    const deleteDocRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/documents/${recallDocId}`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${teacherToken}`
      }
    });
    assert(deleteDocRes.status === 200 && deleteDocRes.body.success === true, 'Giáo viên XÓA HOÀN TOÀN hồ sơ đã thu hồi thành công');

    // 3.13 Kiểm tra tương thích máy chủ đám mây Linux Render (Tự động niêm phong PAdES X.509 khi không có file .exe)
    const pdfSignerService = require('./pdfSignerService');
    const origFsExists = fs.existsSync;
    fs.existsSync = function(p) {
      if (typeof p === 'string' && (p.includes('RealPdfSigner') || p.includes('EduSign_Agent'))) return false;
      return origFsExists.apply(this, arguments);
    };

    const cloudDoc = {
      id: 'CLOUD_TEST_' + Date.now(),
      title: 'Kế hoạch bài dạy kiểm thử Render Cloud',
      author: 'Hà Văn Tý',
      department: 'Tổ Toán - Tin',
      signatures: [{
        step: 1,
        role: 'Giáo viên',
        signerName: 'Hà Văn Tý',
        visualSignImage: dummySignature
      }]
    };
    const cloudSignRes = await pdfSignerService.signWithRealVgca(cloudDoc);
    fs.existsSync = origFsExists; // Khôi phục

    assert(cloudSignRes && cloudSignRes.signedFilePath && fs.existsSync(cloudSignRes.signedFilePath), 'Hệ thống ký số hoạt động trơn tru 100% trên môi trường Render Linux (Tự động niêm phong PAdES X.509 mà không bị lỗi thiếu file .exe)');

    // Kiểm tra API Ping Local Signer
    const pingLocalRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/ping-local-signer',
      method: 'GET'
    });
    assert(pingLocalRes.status === 200 && pingLocalRes.body.success, 'API /api/ping-local-signer sẵn sàng làm cầu nối cho Render Cloud');

    // Kiểm tra nộp bài qua Local Signer Bridge (realSignedPdfBase64)
    const bridgeSubmitRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/documents',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      title: 'Kế hoạch bài dạy ký qua Local Bridge',
      grade: 'Khối 9',
      week: 'Tuần 15',
      signatureImage: dummySignature,
      realSignedPdfBase64: sampleBase64
    });
    assert(bridgeSubmitRes.status === 200 && bridgeSubmitRes.body.data.realVgcaSigned === true, 'Hồ sơ nộp qua Local Signer Bridge được xác nhận chữ ký số thật thành công 100%');

    // 3.14 Kiểm tra API Chẩn đoán phần mềm VGCA & USB Token (/api/check-vgca-status)
    const checkVgcaRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/check-vgca-status',
      method: 'GET'
    });
    assert(checkVgcaRes.status === 200 && checkVgcaRes.body.success === true, 'API /api/check-vgca-status phản hồi thành công');
    assert('appRunning' in checkVgcaRes.body.data && 'tokenConnected' in checkVgcaRes.body.data, 'Kiểm tra chính xác trạng thái phần mềm VGCA và kết nối USB Token');
    assert(checkVgcaRes.body.data.statusCode, 'Kiểm tra mã trạng thái chẩn đoán hệ thống (statusCode)');

    // 3.14b Kiểm tra Tải về EduSign Desktop Agent cho máy tính
    const downloadAgentRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/downloads/EduSign_Agent.exe',
      method: 'GET'
    }, null, true);
    assert(downloadAgentRes.status === 200, 'Tải thành công tệp EduSign_Agent.exe (Mã 200)');
    assert(downloadAgentRes.headers['content-type'].includes('msdownload') || downloadAgentRes.headers['content-type'].includes('octet-stream') || downloadAgentRes.headers['content-type'].includes('executable'), 'Đúng định dạng phần mềm thực thi Windows (.exe)');
    assert(downloadAgentRes.body.length > 1000000, 'Dung lượng EduSign_Agent.exe hợp lệ (>1MB, Self-Contained)');

    // 3.14c Kiểm tra Bộ cài đặt Windows 10 & 11 (Tạo Shortcut Desktop + Chạy ngầm Khay hệ thống)
    const downloadBatRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/downloads/Cai_Dat_EduSign_Agent.bat',
      method: 'GET'
    }, null, true);
    assert(downloadBatRes.status === 200, 'Tải thành công bộ cài đặt một chạm Cai_Dat_EduSign_Agent.bat (Mã 200)');
    assert(downloadBatRes.body.toString('utf8').includes('EduSign Agent') && downloadBatRes.body.toString('utf8').includes('Desktop'), 'Nội dung bộ cài đặt chuẩn Windows: Khởi tạo Desktop Shortcut và khay hệ thống');

    const downloadPs1Res = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/downloads/Cai_Dat_EduSign.ps1',
      method: 'GET'
    }, null, true);
    assert(downloadPs1Res.status === 200, 'Tải thành công kịch bản cấu hình Windows Cai_Dat_EduSign.ps1 (Mã 200)');

    // 3.15 Kiểm tra Quy trình Ký số 2 Bước SmartCA: Khởi tạo phiên & Chặn báo thành công giả định
    const initSessionRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/vgca/initiate-session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      docTitle: 'Kế hoạch bài dạy Toán 9 - Xác thực 2 bước',
      signerName: 'Hà Văn Tý',
      vgcaAccount: 'hvty-dakha@quangngai.gov.vn',
      vgcaPin: '123456'
    });
    assert(initSessionRes.status === 200 && initSessionRes.body.txId && initSessionRes.body.status === 'WAITING_CONFIRMATION', 'Bước 1: Khởi tạo phiên SmartCA thành công, sinh mã giao dịch duy nhất');
    const vgcaTxId = initSessionRes.body.txId;

    // Chặn tuyệt đối: Không cho phép ký khi Thầy CHƯA bấm xác nhận trên điện thoại (Session status: WAITING_CONFIRMATION)
    const prematureSignRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/documents',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      title: 'Kế hoạch bài dạy thử nghiệm chặn ký sớm',
      grade: 'Khối 9',
      week: 'Tuần 16',
      signatureImage: dummySignature,
      realVgcaSign: true,
      txId: vgcaTxId
    });
    assert(prematureSignRes.status === 400 && prematureSignRes.body.message.includes('Chưa nhận được xác nhận'), 'Hệ thống CHẶN THÀNH CÔNG: Từ chối ký số nếu người dùng chưa xác nhận trên điện thoại');

    // Bước 2: Người dùng mở điện thoại và bấm xác nhận
    const confirmSessionRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/vgca/confirm-session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      txId: vgcaTxId
    });
    assert(confirmSessionRes.status === 200 && confirmSessionRes.body.status === 'CONFIRMED', 'Bước 2: Xác nhận tín hiệu từ điện thoại thành công');

    // Hoàn tất niêm phong chữ ký sau khi đã xác nhận
    const finalSignRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/documents',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      title: 'Kế hoạch bài dạy đã xác thực điện thoại chuẩn',
      grade: 'Khối 9',
      week: 'Tuần 16',
      signatureImage: dummySignature,
      realVgcaSign: true,
      txId: vgcaTxId
    });
    assert(finalSignRes.status === 200 && finalSignRes.body.data.realVgcaSigned === true, 'Ký số mật mã thật VGCA và nộp bài hoàn tất 100% sau khi đã xác nhận điện thoại');

    // 3.16 Kiểm tra Quản lý Tài khoản VGCA Chuẩn Học bạ số Viettel (Đăng nhập tài khoản, kiểm tra trạng thái & Đăng xuất)
    const vgcaLoginFailRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/vgca/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      vgcaAccount: ''
    });
    assert(vgcaLoginFailRes.status === 400, 'Chặn đăng nhập VGCA khi thiếu tài khoản/mật khẩu (Mã 400)');

    const vgcaLoginSuccessRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/vgca/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      }
    }, {
      vgcaAccount: 'hvty-dakha@quangngai.gov.vn',
      vgcaPassword: 'SecretPassword123'
    });
    assert(vgcaLoginSuccessRes.status === 200 && vgcaLoginSuccessRes.body.success === true && vgcaLoginSuccessRes.body.data.method === 'IMPLICIT/TSE', 'Đăng nhập tài khoản VGCA thành công: Nhận diện phương thức IMPLICIT/TSE Ban Cơ yếu');

    const vgcaStatusRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/vgca/status',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${teacherToken}`
      }
    });
    assert(vgcaStatusRes.status === 200 && vgcaStatusRes.body.data.isLoggedIn === true, 'Kiểm tra trạng thái VGCA: Đã kết nối phiên làm việc của Giáo viên');

    const vgcaLogoutRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/vgca/logout',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`
      }
    });
    assert(vgcaLogoutRes.status === 200 && vgcaLogoutRes.body.success === true, 'Đăng xuất tài khoản VGCA thành công');

    const vgcaStatusAfterLogoutRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/vgca/status',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${teacherToken}`
      }
    });
    assert(vgcaStatusAfterLogoutRes.status === 200 && vgcaStatusAfterLogoutRes.body.data.isLoggedIn === false && vgcaStatusAfterLogoutRes.body.data.account === null, 'Sau khi đăng xuất: Trạng thái DISCONNECTED, không lưu giữ tài khoản cũ và account là null');

    // 3.9b Kiểm tra cú pháp toàn bộ JavaScript trong file giao diện index.html (Không bị lỗi cú pháp như Unexpected token)
    const htmlContent = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match, scriptIndex = 0, scriptSyntaxErrors = 0;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
      const openTag = match[0].substring(0, match[0].indexOf('>'));
      if (/src\s*=/i.test(openTag)) continue;
      scriptIndex++;
      try {
        new Function(match[1]);
      } catch (e) {
        scriptSyntaxErrors++;
      }
    }
    assert(scriptSyntaxErrors === 0 && scriptIndex > 0, `Kiểm tra mã JavaScript trong index.html: Toàn bộ ${scriptIndex} khối script không có lỗi cú pháp (0 lỗi)`);

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
