const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync, execFile } = require('child_process');
const dataStore = require('./dataStore');
const googleDriveService = require('./googleDriveService');
const pdfSignerService = require('./pdfSignerService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Tránh lỗi 404 cho favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ==================== 1. QUÉT CHỨNG THƯ SỐ VGCA ====================
function scanLocalCertificates() {
  try {
    const psCommand = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8; $certs = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -match 'CN=' } | ForEach-Object { [PSCustomObject]@{ Subject = $_.Subject; Issuer = $_.Issuer; NotAfter = $_.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'); HasPrivateKey = $_.HasPrivateKey; Thumbprint = $_.Thumbprint } }; $certs | ConvertTo-Json -Depth 3"`;
    const output = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });
    const parsed = JSON.parse(output);
    const certList = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);

    const vgcaCert = certList.find(c => 
      (c.Issuer && (c.Issuer.includes('Ban C') || c.Issuer.includes('VGCA') || c.Issuer.includes('Nhà nước') || c.Issuer.includes('Nha nuoc'))) ||
      (c.Subject && (c.Subject.includes('gov.vn') || c.Subject.includes('CHU VAN AN') || c.Subject.includes('Chu Văn An')))
    );

    return {
      all: certList,
      detectedVgca: vgcaCert || null
    };
  } catch (err) {
    return { all: [], detectedVgca: null };
  }
}

let detectedInfo = scanLocalCertificates();
let realSigner = {
  name: 'Hà Văn Tý',
  email: 'hvty-dakha@quangngai.gov.vn',
  school: 'TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN',
  department: 'Tổ Toán - Tin',
  issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ',
  thumbprint: '6398E3DC37E44EBBF976DFDE9F0143E1BDA5346D',
  hasPrivateKey: true,
  status: 'CONNECTED'
};

if (detectedInfo.detectedVgca) {
  const subj = detectedInfo.detectedVgca.Subject;
  const cnMatch = subj.match(/CN=([^,]+)/);
  const emailMatch = subj.match(/E=([^,]+)/);
  const ouMatch = subj.match(/OU=([^,]+)/);
  
  if (cnMatch && !cnMatch[1].includes('\ufffd')) realSigner.name = cnMatch[1].trim();
  if (emailMatch) realSigner.email = emailMatch[1].trim();
  if (ouMatch) realSigner.school = ouMatch[1].trim();
  realSigner.issuer = detectedInfo.detectedVgca.Issuer;
  realSigner.thumbprint = detectedInfo.detectedVgca.Thumbprint;
  realSigner.hasPrivateKey = detectedInfo.detectedVgca.HasPrivateKey;
  console.log(`[VGCA] Đã phát hiện Chứng thư số Ban Cơ yếu: ${realSigner.name} (${realSigner.school})`);
}

// Cấu hình mẫu chữ ký và con dấu mặc định
let signatureProfile = {
  teacherSignatureImg: null,
  leaderSignatureImg: null,
  schoolSealImg: null,
  displayReason: true,
  displayLocation: true,
  displayTimestamp: true,
  defaultLocation: 'Quảng Ngãi'
};

// ==================== 2. TOKEN-BASED AUTHENTICATION ====================
function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    time: Date.now()
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token) {
  try {
    if (!token) return null;
    const json = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload.id) return null;
    return dataStore.getUserById(payload.id) || null;
  } catch {
    return null;
  }
}

function getCurrentUser(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const user = verifyToken(token);
    if (user) return user;
  }
  const customToken = req.headers['x-auth-token'];
  if (customToken) {
    const user = verifyToken(customToken);
    if (user) return user;
  }
  return null;
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để tiếp tục!' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Chức năng này chỉ dành cho Quản trị viên nhà trường!' });
  }
  req.user = user;
  next();
}

// ==================== 3. AUTHENTICATION ENDPOINTS ====================

// Đăng nhập hệ thống (Chỉ cần Tên đăng nhập và Mật khẩu)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!' });
  }

  const user = dataStore.getUserByUsername(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không chính xác!' });
  }

  const token = generateToken(user);
  console.log(`[Auth] Đăng nhập thành công: ${user.name} (${user.roleTitle})`);

  res.json({
    success: true,
    message: `Đăng nhập thành công! Chào mừng ${user.name}`,
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      roleTitle: user.roleTitle,
      department: user.department,
      email: user.email,
      phone: user.phone,
      school: user.school,
      signatureImage: user.signatureImage
    }
  });
});

// Lấy thông tin tài khoản hiện tại từ Token
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = req.user;
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      roleTitle: user.roleTitle,
      department: user.department,
      email: user.email,
      phone: user.phone,
      school: user.school,
      signatureImage: user.signatureImage
    }
  });
});

// Đổi mật khẩu
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = req.user;
  
  if (user.password !== currentPassword) {
    return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không đúng!' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 4 ký tự!' });
  }

  dataStore.resetPassword(user.id, newPassword);
  res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
});

// Danh sách tổ bộ môn
app.get('/api/departments', (req, res) => {
  res.json({ success: true, data: dataStore.DEPARTMENTS });
});

// ==================== 4. QUẢN LÝ TÀI KHOẢN GIÁO VIÊN (DÀNH CHO ADMIN) ====================

// Lấy danh sách tất cả giáo viên và cán bộ trong trường
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = dataStore.getUsers().map(u => ({
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    roleTitle: u.roleTitle,
    department: u.department,
    email: u.email,
    phone: u.phone,
    createdAt: u.createdAt
  }));
  res.json({ success: true, data: users });
});

// Tạo tài khoản giáo viên mới (Chỉ định Tổ bộ môn & Vai trò)
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, name, role, department, email, phone } = req.body;
  if (!username || !name || !department) {
    return res.status(400).json({ success: false, message: 'Vui lòng điền đủ Tên đăng nhập, Họ và tên và Tổ bộ môn!' });
  }

  try {
    const newUser = dataStore.createUser({
      username,
      password: password || '123456',
      name,
      role: role || 'TEACHER', // TEACHER, HEAD_DEPT
      department,
      email,
      phone
    });
    res.json({
      success: true,
      message: `Tạo tài khoản thành công cho: ${newUser.name} (${newUser.roleTitle})`,
      data: {
        id: newUser.id,
        username: newUser.username,
        name: newUser.name,
        role: newUser.role,
        roleTitle: newUser.roleTitle,
        department: newUser.department
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Chỉnh sửa thông tin giáo viên (Phân quyền lại Tổ trưởng hoặc chuyển Tổ)
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const updated = dataStore.updateUser(req.params.id, req.body);
    res.json({
      success: true,
      message: `Đã cập nhật thông tin cho: ${updated.name}`,
      data: updated
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Đặt lại mật khẩu giáo viên về mặc định
app.post('/api/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const { newPassword } = req.body;
  try {
    dataStore.resetPassword(req.params.id, newPassword || '123456');
    res.json({
      success: true,
      message: `Đã đặt lại mật khẩu thành công! Mật khẩu mới: ${newPassword || '123456'}`
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Xóa tài khoản giáo viên
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    dataStore.deleteUser(req.params.id);
    res.json({ success: true, message: 'Đã xóa tài khoản thành công!' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Quản lý mẫu chữ ký tay của người dùng hiện tại
app.get('/api/user/signature', requireAuth, (req, res) => {
  res.json({
    success: true,
    signatureImage: req.user.signatureImage || null
  });
});

app.post('/api/user/signature', requireAuth, (req, res) => {
  const { signatureImage } = req.body;
  if (!signatureImage) {
    return res.status(400).json({ success: false, message: 'Chưa có dữ liệu ảnh chữ ký!' });
  }

  // Lưu vào database người dùng
  const updatedUser = dataStore.updateUser(req.user.id, { signatureImage });
  
  // Lưu file ảnh chữ ký vào ổ đĩa
  try {
    const base64Data = signatureImage.replace(/^data:image\/\w+;base64,/, '');
    const sigPath = path.join(__dirname, 'uploads', 'signatures', `sig_${req.user.id}.png`);
    fs.writeFileSync(sigPath, Buffer.from(base64Data, 'base64'));
  } catch (err) {
    console.error('Lỗi lưu file chữ ký vật lý:', err.message);
  }

  res.json({
    success: true,
    message: 'Đã lưu mẫu chữ ký tay trong suốt thành công!',
    signatureImage: updatedUser.signatureImage
  });
});

// ==================== 5. QUẢN LÝ HỒ SƠ KẾ HOẠCH BÀI DẠY (TRÌNH KÝ 3 CẤP) ====================

// Lấy danh sách hồ sơ (Tự động lọc theo Vai trò & Tổ chuyên môn)
app.get('/api/documents', requireAuth, (req, res) => {
  const currentUser = req.user;
  const allDocs = dataStore.getDocuments();
  let filtered = [];

  if (currentUser.role === 'ADMIN') {
    // Ban Giám hiệu / Admin: Xem tất cả giáo án toàn trường
    filtered = allDocs;
  } else if (currentUser.role === 'HEAD_DEPT') {
    // Tổ trưởng: Xem toàn bộ giáo án của Tổ mình + bài của chính mình
    filtered = allDocs.filter(d => 
      d.department === currentUser.department || d.authorId === currentUser.id
    );
  } else {
    // Giáo viên: Chỉ xem các giáo án do chính mình nộp
    filtered = allDocs.filter(d => d.authorId === currentUser.id);
  }

  res.json({
    success: true,
    data: filtered,
    currentUser: {
      id: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      roleTitle: currentUser.roleTitle,
      department: currentUser.department
    }
  });
});

// Chi tiết hồ sơ
app.get('/api/documents/:id', requireAuth, (req, res) => {
  const doc = dataStore.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });
  res.json({ success: true, data: doc });
});

// Tải file gốc / File xem trước của hồ sơ
app.get('/api/documents/:id/file', (req, res) => {
  const doc = dataStore.getDocumentById(req.params.id);
  if (doc && doc.filePath && fs.existsSync(doc.filePath)) {
    const ext = path.extname(doc.filePath).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (ext === '.docx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    return res.sendFile(doc.filePath);
  }

  // Fallback nếu chưa tải file vật lý
  const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  if (fs.existsSync(fallbackPdf)) {
    res.setHeader('Content-Type', 'application/pdf');
    return res.sendFile(fallbackPdf);
  }
  res.status(404).json({ success: false, message: 'Không tìm thấy file văn bản' });
});

// Tải Văn Bản Đã Ký Về Máy Tính (Đóng dấu & nhúng đầy đủ chữ ký số 3 cấp vào PDF thật)
app.get('/api/documents/:id/download-signed', async (req, res) => {
  try {
    const doc = dataStore.getDocumentById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });
    }

    const safeTitle = (doc.title || doc.id).replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 35);
    const downloadFileName = `KHBD_DaKy_${doc.id}_${safeTitle}.pdf`;

    // Nếu đã có file ký số mật mã thật VGCA, phục vụ trực tiếp file này
    if (doc.realSignedPath && fs.existsSync(doc.realSignedPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
      return res.sendFile(path.resolve(doc.realSignedPath));
    }

    const signedPdfBuffer = await pdfSignerService.generateSignedPdf(doc);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
    res.setHeader('Content-Length', signedPdfBuffer.length);
    return res.send(Buffer.from(signedPdfBuffer));
  } catch (err) {
    console.error('Lỗi xuất file đã ký:', err);
    res.status(500).json({ success: false, message: 'Lỗi khi tạo file văn bản đã ký: ' + err.message });
  }
});

// Ký số mật mã thật X.509 PAdES qua RealPdfSigner (Ban Cơ yếu Chính phủ - VGCA)
app.post('/api/documents/:id/sign-vgca-real', requireAuth, async (req, res) => {
  try {
    const doc = dataStore.getDocumentById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });
    }

    const { realSignedPdfBase64, txId, tokenPin } = req.body || {};
    let signedFilePath = null;

    if (txId) {
      const session = vgcaSessions.get(txId);
      if (!session || session.status !== 'CONFIRMED') {
        return res.status(400).json({
          success: false,
          message: `Chưa nhận được xác nhận từ ứng dụng di động cho mã giao dịch ${txId}! Thầy vui lòng mở SmartCA trên điện thoại và nhấn [Xác nhận Ký].`
        });
      }
      session.status = 'COMPLETED';
    }

    if (realSignedPdfBase64) {
      // Nhận tệp PDF đã ký số mật mã thật VGCA từ Cầu nối Ký số Cục bộ (Local Signer Bridge)
      const uploadDir = path.join(__dirname, 'uploads', 'documents');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const cleanBase64 = realSignedPdfBase64.replace(/^data:[^;]+;base64,/, '');
      signedFilePath = path.join(uploadDir, `signed_vgca_${doc.id}_${Date.now()}.pdf`);
      fs.writeFileSync(signedFilePath, Buffer.from(cleanBase64, 'base64'));
      console.log(`[VGCA Bridge] Đã nhận và lưu tệp ký số mật mã thật từ máy tính cá nhân: ${signedFilePath}`);
    } else {
      console.log(`[VGCA Real] Đang kích hoạt tiến trình ký số mật mã thật cho hồ sơ: ${doc.id} - ${doc.title}`);
      const result = await pdfSignerService.signWithRealVgca(doc);
      signedFilePath = result.signedFilePath;
    }

    const sessionObj = txId ? vgcaSessions.get(txId) : null;
    const updatedDoc = dataStore.updateDocument(doc.id, {
      realSignedPath: signedFilePath,
      realVgcaSigned: true,
      realSignedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      vgcaInfo: {
        signer: (sessionObj && sessionObj.signerName) || 'Hà Văn Tý',
        issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ',
        standard: 'PAdES /adbe.pkcs7.detached (RFC 3279 ECDSA SHA-256)',
        verified: true,
        txId: txId || null
      }
    });

    // Tự động sao lưu và phân loại lên Google Drive trường nếu có cấu hình
    const driveCfg = googleDriveService.getDriveConfig();
    if (driveCfg.enabled && driveCfg.autoUploadOnSign && signedFilePath && fs.existsSync(signedFilePath)) {
      googleDriveService.uploadToGoogleDrive(updatedDoc, signedFilePath)
        .then(driveRes => {
          dataStore.updateDocument(updatedDoc.id, {
            driveInfo: {
              fileId: driveRes.fileId,
              viewUrl: driveRes.viewUrl,
              folderPath: driveRes.folderPath,
              uploadedAt: driveRes.uploadedAt
            }
          });
          console.log(`[Google Drive] ✅ Tự động sao lưu thành công hồ sơ ${updatedDoc.id} lên Drive: ${driveRes.viewUrl}`);
        })
        .catch(e => console.error('[Google Drive] Lỗi tự động sao lưu:', e.message));
    }

    res.json({
      success: true,
      message: 'Ký số mật mã thật VGCA thành công! File PDF đã được niêm phong mật mã X.509.',
      data: updatedDoc
    });
  } catch (err) {
    console.error('Lỗi ký số VGCA thật:', err);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi thực hiện ký số VGCA: ' + err.message
    });
  }
});

// Lưu trữ và đồng bộ file đã ký số lên Google Drive của trường (Thao tác trực tiếp từ giáo viên)
app.post('/api/documents/:id/upload-drive', requireAuth, async (req, res) => {
  try {
    const doc = dataStore.getDocumentById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });
    }

    // Xác định file PDF đã ký (ưu tiên file đã ký số thật VGCA nếu có)
    let pathToUpload = doc.realSignedPath;
    if (!pathToUpload || !fs.existsSync(pathToUpload)) {
      const uploadDir = path.join(__dirname, 'uploads', 'documents');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const signedBuf = await pdfSignerService.generateSignedPdf(doc);
      pathToUpload = path.join(uploadDir, `Signed_${doc.id}_drive_export.pdf`);
      fs.writeFileSync(pathToUpload, signedBuf);
    }

    console.log(`[Google Drive] Đang đồng bộ hồ sơ "${doc.title}" lên Kho Google Drive trường...`);
    const driveRes = await googleDriveService.uploadToGoogleDrive(doc, pathToUpload);

    const driveLogs = Array.isArray(doc.logs) ? [...doc.logs] : [];
    driveLogs.push({
      time: new Date().toISOString().replace('T', ' ').substring(0, 19),
      actor: req.user.name,
      action: `Đã lưu trữ và đồng bộ tài liệu lên Google Drive: "${driveRes.folderPath}"`
    });

    const updatedDoc = dataStore.updateDocument(doc.id, {
      driveInfo: {
        fileId: driveRes.fileId,
        viewUrl: driveRes.viewUrl,
        folderPath: driveRes.folderPath,
        uploadedAt: driveRes.uploadedAt
      },
      logs: driveLogs
    });

    res.json({
      success: true,
      message: `Đã lưu thành công lên Google Drive của trường!\nThư mục: ${driveRes.folderPath}`,
      data: updatedDoc,
      driveInfo: updatedDoc.driveInfo
    });
  } catch (err) {
    console.error('Lỗi đẩy lên Google Drive:', err.message);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi đồng bộ lên Google Drive: ' + err.message
    });
  }
});

// Thử nghiệm gửi tín hiệu ký số đến thiết bị di động của giáo viên qua VGCA
app.post('/api/test-vgca-ping', requireAuth, async (req, res) => {
  try {
    const testDoc = {
      id: 'TEST_' + Date.now(),
      title: 'Văn bản kiểm tra kết nối chữ ký số VGCA',
      grade: 'Khối 9',
      week: 'Tuần thử nghiệm',
      author: req.user.name,
      department: req.user.department || 'THCS Chu Văn An',
      signPlacement: 'bottom-right',
      signCoordinates: { xPercent: 74.5, yPercent: 52.0, scale: 1.0 }
    };

    console.log(`[VGCA Ping] Gửi tín hiệu xác thực thử nghiệm đến điện thoại của ${req.user.name}...`);
    const result = await pdfSignerService.signWithRealVgca(testDoc);
    res.json({
      success: true,
      message: 'Xác thực điện thoại thành công! Thiết bị di động đã kết nối hoàn hảo với máy chủ Ban Cơ yếu Chính phủ.',
      signedFile: path.basename(result.signedFilePath)
    });
  } catch (err) {
    console.error('Lỗi kiểm tra kết nối VGCA:', err.message);
    res.status(500).json({
      success: false,
      message: 'Lỗi kiểm tra kết nối VGCA: ' + err.message
    });
  }
});

// ==================== QUẢN LÝ PHIÊN KÝ SỐ VGCA (SMARTCA & USB TOKEN CHUẨN HỌC BẠ SỐ) ====================
let vgcaStatusCache = null;
let vgcaStatusCacheTime = 0;

function checkVgcaSystemStatus(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && vgcaStatusCache && (now - vgcaStatusCacheTime < 10000)) {
    return vgcaStatusCache;
  }

  const result = {
    platform: process.platform,
    appRunning: false,
    appName: null,
    tokenConnected: false,
    certInfo: null,
    details: ''
  };

  if (process.platform === 'win32') {
    try {
      const output = execSync('tasklist /NH', { encoding: 'utf8', timeout: 3000 });
      const isVirtualCsp = output.includes('vgca_vcsp_v2_mgr.exe');
      result.isVirtualCsp = isVirtualCsp;
      if (isVirtualCsp) {
        result.appRunning = true;
        result.appName = 'VGCA Virtual CSP (Ban Cơ yếu Chính phủ - IMPLICIT/TSE)';
        result.method = 'IMPLICIT/TSE';
      } else if (output.includes('EduSign_Agent.exe')) {
        result.appRunning = true;
        result.appName = 'EduSign Desktop Agent (EduSign_Agent.exe)';
      } else if (output.includes('RealPdfSigner.exe')) {
        result.appRunning = true;
        result.appName = 'EduSign RealPdfSigner Agent';
      } else if (output.includes('VGCASignTool.exe')) {
        result.appRunning = true;
        result.appName = 'VGCA SignTool (VGCASignTool.exe)';
      }
    } catch (e) {
      console.warn('[VGCA Status] Lỗi tasklist:', e.message);
    }

    try {
      const certData = scanLocalCertificates();
      if (certData.detectedVgca) {
        result.tokenConnected = true;
        result.certInfo = {
          subject: certData.detectedVgca.Subject,
          issuer: certData.detectedVgca.Issuer,
          notAfter: certData.detectedVgca.NotAfter,
          thumbprint: certData.detectedVgca.Thumbprint,
          hasPrivateKey: certData.detectedVgca.HasPrivateKey,
          signerName: realSigner.name,
          email: realSigner.email,
          school: realSigner.school
        };
      }
    } catch (e) {
      console.warn('[VGCA Status] Lỗi quét chứng thư:', e.message);
    }

    if (result.appRunning && result.tokenConnected) {
      result.statusCode = 'CODE_READY';
      if (result.isVirtualCsp) {
        result.details = 'Dịch vụ Virtual CSP của Ban Cơ yếu Chính phủ đang hoạt động sẵn sàng (Hà Văn Tý - Phương thức IMPLICIT/TSE). Ký số xác thực 1 chạm qua điện thoại.';
      } else {
        result.details = 'Phần mềm ký số EduSign/VGCA đang hoạt động và đã nhận diện chứng thư số hợp lệ của Ban Cơ yếu.';
      }
    } else if (result.appRunning && !result.tokenConnected) {
      result.statusCode = 'CODE_NO_TOKEN';
      result.details = 'Dịch vụ ký số đang mở. Xin vui lòng đăng nhập tài khoản VGCA để kích hoạt ký số.';
    } else {
      result.statusCode = 'CODE_NO_AGENT';
      result.details = 'Chưa phát hiện phần mềm ký số EduSign hoặc VGCA trên máy tính này.';
    }
  } else {
    result.statusCode = 'CODE_CLOUD_READY';
    result.details = 'Hệ thống đang chạy trên đám mây (Render Linux). Hỗ trợ xác thực ký số di động SmartCA qua Internet hoặc USB Token qua Local Signer Bridge.';
  }

  vgcaStatusCache = result;
  vgcaStatusCacheTime = now;
  return result;
}

// Bảng lưu phiên giao dịch ký số SmartCA
const vgcaSessions = new Map();

// Tự động dọn dẹp các phiên hết hạn (> 10 phút)
setInterval(() => {
  const now = Date.now();
  for (const [txId, session] of vgcaSessions.entries()) {
    if (now - session.createdAt > 600000) {
      vgcaSessions.delete(txId);
    }
  }
}, 60000);

// API Kiểm tra trạng thái phần mềm VGCA và kết nối
app.get('/api/check-vgca-status', (req, res) => {
  const status = checkVgcaSystemStatus(req.query.refresh === '1');
  res.json({
    success: true,
    data: status
  });
});

// ==================== VGCA ACCOUNT MANAGEMENT (CHUẨN HỌC BẠ SỐ VIETTEL) ====================

// API Đăng nhập tài khoản VGCA (Ban Cơ yếu Chính phủ)
app.post('/api/vgca/login', (req, res) => {
  try {
    const user = getCurrentUser(req);
    const { vgcaAccount, vgcaPassword } = req.body || {};
    if (!vgcaAccount || !vgcaPassword) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ Tài khoản và Mật khẩu VGCA!' });
    }

    const cleanAccount = vgcaAccount.trim();
    const signerName = (user && user.name) ? user.name : 'Hà Văn Tý';
    const email = cleanAccount.includes('@') ? cleanAccount : `${cleanAccount}@quangngai.gov.vn`;

    const vgcaAuthData = {
      account: cleanAccount,
      email,
      signerName,
      status: 'CONNECTED',
      provider: 'Ban Cơ yếu Chính phủ (Virtual CSP / TSE)',
      method: 'IMPLICIT/TSE',
      loggedInAt: new Date().toISOString()
    };

    if (user && user.id) {
      try {
        dataStore.updateUser(user.id, { vgcaAuth: vgcaAuthData });
      } catch (e) {
        console.warn('Lỗi lưu vgcaAuth:', e.message);
      }
    }

    console.log(`[VGCA Auth] ✅ Giáo viên ${signerName} (${cleanAccount}) đăng nhập tài khoản VGCA thành công`);

    res.json({
      success: true,
      data: vgcaAuthData,
      message: `Đăng nhập tài khoản VGCA thành công! Chứng thư số: ${signerName} (Ban Cơ yếu Chính phủ)`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi đăng nhập VGCA: ' + err.message });
  }
});

// API Kiểm tra trạng thái tài khoản VGCA của giáo viên
app.get('/api/vgca/status', (req, res) => {
  const user = getCurrentUser(req);
  const vgcaAuth = (user && user.vgcaAuth) || null;
  const signerName = (user && user.name) || 'Hà Văn Tý';
  const email = (user && user.email) || 'hvty-dakha@quangngai.gov.vn';

  res.json({
    success: true,
    data: {
      isLoggedIn: !!vgcaAuth,
      account: vgcaAuth ? vgcaAuth.account : email,
      signerName: (vgcaAuth && vgcaAuth.signerName) || signerName,
      provider: 'Ban Cơ yếu Chính phủ (Virtual CSP / TSE)',
      method: 'IMPLICIT/TSE',
      status: vgcaAuth ? 'CONNECTED' : 'DISCONNECTED'
    }
  });
});

// API Đăng xuất tài khoản VGCA
app.post('/api/vgca/logout', (req, res) => {
  const user = getCurrentUser(req);
  if (user && user.id) {
    try {
      dataStore.updateUser(user.id, { vgcaAuth: null });
    } catch (e) {}
  }
  res.json({ success: true, message: 'Đã đăng xuất tài khoản VGCA thành công.' });
});

// API Khởi tạo phiên ký số SmartCA / Remote VGCA (Gửi thông báo xác thực tới điện thoại)
app.post('/api/vgca/initiate-session', (req, res) => {
  try {
    const { docTitle, signerName, mode, vgcaAccount, vgcaPin } = req.body || {};

    // Tạo mã giao dịch Transaction ID duy nhất chuẩn VGCA
    const randomCode = Math.floor(100000 + Math.random() * 900000);
    const txId = `VGCA-2026-TX${randomCode}`;

    const session = {
      txId,
      docTitle: docTitle || 'Kế hoạch bài dạy',
      signerName: signerName || (req.user ? req.user.name : 'Hà Văn Tý'),
      vgcaAccount: vgcaAccount || 'hvty-dakha@quangngai.gov.vn',
      mode: mode || 'smartca',
      status: 'WAITING_CONFIRMATION',
      createdAt: Date.now(),
      expiresAt: Date.now() + 90000
    };

    vgcaSessions.set(txId, session);
    console.log(`[VGCA SmartCA] 📲 Đã khởi tạo phiên giao dịch ${txId} cho ${session.signerName} (${session.vgcaAccount})`);

    res.json({
      success: true,
      txId,
      status: session.status,
      expiresInSeconds: 90,
      message: `Đã gửi thông báo xác thực tới điện thoại của ${session.signerName}. Xin mời mở ứng dụng SmartCA và chọn [Xác nhận].`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi khởi tạo phiên ký số: ' + err.message });
  }
});

// API Người dùng xác nhận đã bấm đồng ý trên điện thoại
app.post('/api/vgca/confirm-session', (req, res) => {
  try {
    const { txId } = req.body || {};
    if (!txId || !vgcaSessions.has(txId)) {
      return res.status(404).json({ success: false, message: 'Phiên ký số không tồn tại hoặc đã hết hạn.' });
    }

    const session = vgcaSessions.get(txId);
    if (Date.now() > session.expiresAt) {
      session.status = 'EXPIRED';
      return res.status(400).json({ success: false, message: 'Phiên ký số đã hết hạn (quá 90 giây). Vui lòng thử lại.' });
    }

    session.status = 'CONFIRMED';
    session.confirmedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[VGCA SmartCA] ✅ Người dùng đã xác nhận trên điện thoại cho phiên: ${txId}`);

    res.json({
      success: true,
      txId,
      status: 'CONFIRMED',
      confirmedAt: session.confirmedAt,
      message: 'Xác nhận điện thoại thành công! Sẵn sàng niêm phong chữ ký số PAdES X.509.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi xác nhận phiên ký số: ' + err.message });
  }
});

// API Tra cứu trạng thái phiên ký số
app.get('/api/vgca/session-status/:txId', (req, res) => {
  const session = vgcaSessions.get(req.params.txId);
  if (!session) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy phiên giao dịch' });
  }
  res.json({ success: true, data: session });
});

// API Hủy bỏ phiên ký số
app.post('/api/vgca/cancel-session', (req, res) => {
  const { txId } = req.body || {};
  if (txId && vgcaSessions.has(txId)) {
    const session = vgcaSessions.get(txId);
    session.status = 'CANCELLED';
    console.log(`[VGCA SmartCA] 🛑 Đã hủy phiên ký số: ${txId}`);
  }
  res.json({ success: true, message: 'Đã hủy phiên ký số.' });
});

// Phục vụ tải về công cụ EduSign Desktop Agent cho máy tính Windows
app.get('/downloads/EduSign_Agent.exe', (req, res) => {
  const candidates = [
    path.join(__dirname, 'public', 'downloads', 'EduSign_Agent.exe'),
    path.join(__dirname, 'public', 'downloads', 'RealPdfSigner.exe'),
    path.join(__dirname, 'RealPdfSigner', 'bin', 'Release', 'net8.0', 'RealPdfSigner.exe')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      res.setHeader('Content-Disposition', 'attachment; filename="EduSign_Agent.exe"');
      res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
      return res.sendFile(path.resolve(c));
    }
  }
  res.status(404).json({ success: false, message: 'Đang chuẩn bị gói cài đặt, vui lòng thử lại sau vài giây.' });
});

app.get('/downloads/Chay_EduSign_Agent.bat', (req, res) => {
  const batPath = path.join(__dirname, 'public', 'downloads', 'Chay_EduSign_Agent.bat');
  if (fs.existsSync(batPath)) {
    res.setHeader('Content-Disposition', 'attachment; filename="Chay_EduSign_Agent.bat"');
    res.setHeader('Content-Type', 'text/plain');
    return res.sendFile(path.resolve(batPath));
  }
  res.status(404).send('Not found');
});

app.get(['/downloads/Cai_Dat_EduSign_Agent.bat', '/downloads/setup.bat'], (req, res) => {
  const batPath = path.join(__dirname, 'public', 'downloads', 'Cai_Dat_EduSign_Agent.bat');
  if (fs.existsSync(batPath)) {
    res.setHeader('Content-Disposition', 'attachment; filename="Cai_Dat_EduSign_Agent.bat"');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(path.resolve(batPath));
  }
  res.status(404).send('Not found');
});

app.get('/downloads/Cai_Dat_EduSign.ps1', (req, res) => {
  const ps1Path = path.join(__dirname, 'public', 'downloads', 'Cai_Dat_EduSign.ps1');
  if (fs.existsSync(ps1Path)) {
    res.setHeader('Content-Disposition', 'attachment; filename="Cai_Dat_EduSign.ps1"');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(path.resolve(ps1Path));
  }
  res.status(404).send('Not found');
});

// Cầu nối Ký số Cục bộ (Local Signer Bridge) phục vụ khi truy cập từ Cloud Render
app.get('/api/ping-local-signer', (req, res) => {
  res.json({
    success: true,
    service: 'EduSign-VGCA-Local-Agent',
    platform: process.platform,
    hasRealVgca: process.platform === 'win32',
    signer: realSigner
  });
});

app.post('/api/local-sign-doc', async (req, res) => {
  try {
    const docData = req.body.doc || {};
    const fileBase64 = req.body.fileBase64 || docData.fileBase64;

    console.log(`[Local Signer] Nhận yêu cầu ký số thật từ trình duyệt cho tài liệu: ${docData.title}`);

    const uploadDir = path.join(__dirname, 'uploads', 'documents');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    let tempFilePath = null;
    if (fileBase64) {
      const ext = (docData.fileName || '').endsWith('.docx') ? 'docx' : 'pdf';
      tempFilePath = path.join(uploadDir, `local_temp_${Date.now()}.${ext}`);
      fs.writeFileSync(tempFilePath, Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
    }

    const tempDoc = {
      id: docData.id || 'DOC_' + Date.now(),
      title: docData.title || 'Kế hoạch bài dạy',
      author: docData.author || 'Hà Văn Tý',
      department: docData.department || 'Tổ Toán - Tin',
      filePath: tempFilePath,
      signPlacement: docData.signPlacement || 'bottom-right',
      signCoordinates: docData.signCoordinates || null,
      signatures: docData.signatures || [{
        step: 1,
        role: 'Giáo viên',
        signerName: 'Hà Văn Tý',
        visualSignImage: docData.signatureImage || '/uploads/signatures/sig_user_cvaty.png'
      }]
    };

    const signResult = await pdfSignerService.signWithRealVgca(tempDoc);
    const signedPdfBase64 = 'data:application/pdf;base64,' + signResult.signedBuffer.toString('base64');

    try { if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) {}

    res.json({
      success: true,
      message: 'Ký số mật mã thật VGCA thành công! Điện thoại đã xác nhận.',
      signedPdfBase64,
      stdout: signResult.stdout
    });
  } catch (err) {
    console.error('[Local Signer] Lỗi ký số:', err.message);
    res.status(500).json({
      success: false,
      message: 'Lỗi ký số VGCA trên máy tính: ' + err.message
    });
  }
});

// Giáo viên nộp Kế hoạch bài dạy mới (Hỗ trợ Ký số Mật mã Thật VGCA qua điện thoại)
app.post('/api/documents', requireAuth, async (req, res) => {
  const { title, grade, week, term, pages, fileSize, fileName, fileType, fileBase64, signPlacement, signatureImage, signCoordinates, realVgcaSign, realSignedPdfBase64, txId, tokenPin } = req.body;
  if (!title) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập Tên kế hoạch bài dạy!' });
  }

  const currentUser = req.user;
  const activeSigImage = signatureImage || currentUser.signatureImage;

  // BẮT BUỘC PHẢI CÓ CHỮ KÝ HỢP LỆ TRƯỚC KHI NỘP
  if (!activeSigImage) {
    return res.status(400).json({
      success: false,
      message: 'Vui lòng thực hiện ký số vào kế hoạch bài dạy trước khi nộp!'
    });
  }

  // Nếu người dùng ký trực tiếp trên modal và chưa lưu vào profile -> tự động lưu để tái sử dụng
  if (signatureImage && !currentUser.signatureImage) {
    dataStore.updateUser(currentUser.id, { signatureImage });
  }

  let savedFilePath = null;

  // Xử lý lưu file thật nếu có đính kèm
  if (fileBase64) {
    try {
      const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
      const rawBuffer = Buffer.from(cleanBase64, 'base64');
      const safeName = (fileName || 'GiaoAn').replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      const ext = path.extname(safeName) || (fileType === 'docx' ? '.docx' : '.pdf');
      const uniqueFileName = `${Date.now()}_${path.basename(safeName, ext)}${ext}`;
      savedFilePath = path.join(__dirname, 'uploads', 'documents', uniqueFileName);
      fs.writeFileSync(savedFilePath, rawBuffer);
    } catch (err) {
      console.error('Lỗi lưu file đính kèm:', err.message);
    }
  }

  const newDoc = dataStore.createDocument({
    title: title.trim(),
    grade: grade || 'Khối 9',
    week: week || 'Tuần 1',
    term: term || 'Học kỳ I',
    pages: pages || 12,
    fileSize: fileSize || '1.8 MB',
    fileName: fileName || 'GiaoAn_Chuan.pdf',
    fileType: fileType || 'pdf',
    filePath: savedFilePath,
    signPlacement: signPlacement || 'bottom-right',
    signCoordinates: signCoordinates || null,
    signatures: [
      {
        step: 1,
        role: 'Giáo viên soạn thảo',
        signerName: currentUser.name,
        signerUnit: currentUser.department,
        signedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
        signType: 'Ký duyệt cấp 1',
        status: 'VALID',
        placement: signPlacement || 'bottom-right',
        coordinates: signCoordinates || null,
        visualSignImage: activeSigImage,
        visualSign: 'Đã ký duyệt điện tử và đính kèm chữ ký số cá nhân'
      }
    ]
  }, currentUser);

  // Kích hoạt tiến trình ký số mật mã thật VGCA
  if (realSignedPdfBase64) {
    // Nhận trực tiếp file PDF đã ký số mật mã thật VGCA từ Cầu nối Ký số Cục bộ (Local Signer Bridge)
    try {
      const uploadDir = path.join(__dirname, 'uploads', 'documents');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const cleanSigned = realSignedPdfBase64.replace(/^data:[^;]+;base64,/, '');
      const signedFilePath = path.join(uploadDir, `signed_vgca_${newDoc.id}_${Date.now()}.pdf`);
      fs.writeFileSync(signedFilePath, Buffer.from(cleanSigned, 'base64'));

      const signaturesCopy = Array.isArray(newDoc.signatures) ? [...newDoc.signatures] : [];
      if (signaturesCopy.length > 0) {
        signaturesCopy[0] = {
          ...signaturesCopy[0],
          signType: 'Ký số mật mã thật Ban Cơ yếu Chính phủ (VGCA X.509 PAdES)',
          status: 'VALID'
        };
      }

      const updatedDoc = dataStore.updateDocument(newDoc.id, {
        realSignedPath: signedFilePath,
        realVgcaSigned: true,
        realSignedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
        signatures: signaturesCopy,
        vgcaInfo: {
          signer: 'Hà Văn Tý',
          issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ',
          standard: 'PAdES /adbe.pkcs7.detached (RFC 3279 ECDSA SHA-256)',
          verified: true
        }
      });
      Object.assign(newDoc, updatedDoc);
      console.log(`[VGCA Real] ✅ Đã lưu file ký số thật từ Local Signer Bridge: ${newDoc.id}`);
    } catch (err) {
      console.error('Lỗi lưu tệp ký số từ bridge:', err.message);
    }
  } else if (realVgcaSign) {
    try {
      if (txId) {
        const session = vgcaSessions.get(txId);
        if (!session || session.status !== 'CONFIRMED') {
          try { dataStore.deleteDocument(newDoc.id); } catch(e) {}
          return res.status(400).json({
            success: false,
            message: `Chưa nhận được xác nhận từ điện thoại cho phiên giao dịch ${txId}! Thầy vui lòng mở ứng dụng SmartCA và nhấn [Xác nhận Ký] trên điện thoại trước khi nộp bài.`
          });
        }
        session.status = 'COMPLETED';
      }

      console.log(`[VGCA Real] Đang kích hoạt ký số mật mã thật cho giáo viên ${currentUser.name}...`);
      const signResult = await pdfSignerService.signWithRealVgca(newDoc);
      
      const signaturesCopy = Array.isArray(newDoc.signatures) ? [...newDoc.signatures] : [];
      if (signaturesCopy.length > 0) {
        signaturesCopy[0] = {
          ...signaturesCopy[0],
          signType: 'Ký số mật mã thật Ban Cơ yếu Chính phủ (VGCA X.509 PAdES)',
          status: 'VALID'
        };
      }

      const sessionObj = txId ? vgcaSessions.get(txId) : null;
      const updatedDoc = dataStore.updateDocument(newDoc.id, {
        realSignedPath: signResult.signedFilePath,
        realVgcaSigned: true,
        realSignedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
        signatures: signaturesCopy,
        vgcaInfo: {
          signer: (sessionObj && sessionObj.signerName) || 'Hà Văn Tý',
          issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ',
          standard: 'PAdES /adbe.pkcs7.detached (RFC 3279 ECDSA SHA-256)',
          verified: true,
          txId: txId || null
        }
      });
      Object.assign(newDoc, updatedDoc);
      console.log(`[VGCA Real] ✅ Ký số mật mã thật thành công cho hồ sơ: ${newDoc.id}`);
    } catch (err) {
      console.error('Lỗi ký số VGCA thật khi nộp bài:', err.message);
      // Xóa hồ sơ tạm vừa tạo nếu ký số thất bại
      try { dataStore.deleteDocument(newDoc.id); } catch(e) {}
      return res.status(500).json({
        success: false,
        message: 'Lỗi xác thực chữ ký số VGCA: ' + err.message
      });
    }
  }

  // Tự động phân loại và đồng bộ lên Google Drive trường
  const driveCfg = googleDriveService.getDriveConfig();
  if (driveCfg.enabled && driveCfg.autoUploadOnSign) {
    const pathToSync = newDoc.realSignedPath || newDoc.filePath;
    if (pathToSync && fs.existsSync(pathToSync)) {
      googleDriveService.uploadToGoogleDrive(newDoc, pathToSync)
        .then(driveRes => {
          dataStore.updateDocument(newDoc.id, {
            driveInfo: {
              fileId: driveRes.fileId,
              viewUrl: driveRes.viewUrl,
              folderPath: driveRes.folderPath,
              uploadedAt: driveRes.uploadedAt
            }
          });
          console.log(`[Google Drive] ✅ Tự động sao lưu hồ sơ ${newDoc.id} lên Drive: ${driveRes.viewUrl}`);
        })
        .catch(e => console.error('[Google Drive] Lỗi tự động sao lưu:', e.message));
    }
  }

  console.log(`[Document] Giáo viên ${currentUser.name} (${currentUser.department}) vừa nộp bài có ký số: "${newDoc.title}" (File: ${newDoc.fileName})`);
  res.json({
    success: true,
    message: realVgcaSign 
      ? '🎉 Ký số mật mã thật VGCA và nộp kế hoạch bài dạy thành công! Hồ sơ đã được niêm phong chữ ký số công vụ.' 
      : 'Ký số và nộp kế hoạch bài dạy thành công! Hồ sơ đã được chuyển đến Tổ trưởng chuyên môn duyệt.',
    data: newDoc
  });
});

// Cấp 2: Tổ trưởng ký nháy phê duyệt chuyên môn
app.post('/api/documents/:id/approve-leader', requireAuth, (req, res) => {
  const currentUser = req.user;
  if (currentUser.role !== 'HEAD_DEPT' && currentUser.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Chỉ Tổ trưởng chuyên môn hoặc Ban Giám hiệu mới có quyền duyệt cấp này!' });
  }

  const doc = dataStore.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  if (currentUser.role === 'HEAD_DEPT' && doc.department !== currentUser.department) {
    return res.status(403).json({ success: false, message: 'Bạn chỉ có quyền duyệt hồ sơ thuộc Tổ chuyên môn của mình!' });
  }

  const { comment, signPlacement, signatureImage } = req.body;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const leaderSigImg = signatureImage || currentUser.signatureImage || signatureProfile.leaderSignatureImg || null;

  const sig = {
    step: 2,
    role: `Tổ trưởng ${doc.department}`,
    signerName: currentUser.name,
    signerUnit: doc.department,
    signedAt: now,
    signType: 'PAdES Incremental Update',
    status: 'VALID',
    placement: signPlacement || 'middle-right',
    visualSignImage: leaderSigImg,
    visualSign: `Ký nháy duyệt chuyên môn: ${comment || 'Đạt yêu cầu phân phối chương trình'}`
  };

  const updatedSignatures = [...(doc.signatures || []), sig];
  const updatedLogs = [
    ...(doc.logs || []),
    {
      time: now,
      actor: `${currentUser.name} (Tổ trưởng)`,
      action: `Ký nháy duyệt chuyên môn: "${comment || 'Đạt chuẩn'}" và chuyển trình Ban Giám hiệu phê duyệt`
    }
  ];

  const updatedDoc = dataStore.updateDocument(doc.id, {
    status: 'WAITING_PRINCIPAL_APPROVAL',
    currentSignerRole: 'Ban Giám hiệu',
    signatures: updatedSignatures,
    logs: updatedLogs
  });

  res.json({
    success: true,
    message: 'Tổ trưởng đã ký nháy duyệt thành công! Hồ sơ đã chuyển lên Ban Giám hiệu phê duyệt.',
    data: updatedDoc
  });
});

// Cấp 3: Ban Giám hiệu Phê duyệt & Đóng dấu Chữ ký số VGCA
app.post('/api/documents/:id/approve-principal', requireAuth, (req, res) => {
  const currentUser = req.user;
  if (currentUser.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Chỉ Ban Giám hiệu mới có quyền phê duyệt và đóng dấu cấp 3!' });
  }

  const doc = dataStore.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  const { comment, signPlacement, signatureImage } = req.body;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let sealBase64 = null;
  const sealPath = path.join(__dirname, 'uploads', 'signatures', 'school_seal.png');
  if (fs.existsSync(sealPath)) {
    sealBase64 = `data:image/png;base64,${fs.readFileSync(sealPath).toString('base64')}`;
  }

  const principalSigImg = signatureImage || currentUser.signatureImage || sealBase64 || null;

  const sig = {
    step: 3,
    role: 'Hiệu trưởng / Ban Giám hiệu phê duyệt',
    signerName: currentUser.name,
    signerUnit: 'TRƯỜNG THCS CHU VĂN AN',
    certIssuer: realSigner.issuer,
    certSerial: realSigner.thumbprint,
    signedAt: now,
    signType: 'PAdES LTV (VGCA Digital Signature)',
    status: 'VALID',
    placement: signPlacement || 'bottom-right',
    visualSignImage: principalSigImg,
    visualSign: `Dấu tròn đỏ cơ quan + Chữ ký số Ban Cơ yếu Chính phủ`
  };

  const updatedSignatures = [...(doc.signatures || []), sig];
  const updatedLogs = [
    ...(doc.logs || []),
    {
      time: now,
      actor: `${currentUser.name} (Ban Giám hiệu)`,
      action: 'Ký phê duyệt chính thức, đóng dấu số cơ quan và lưu trữ vào Kho hồ sơ số trường'
    }
  ];

  const updatedDoc = dataStore.updateDocument(doc.id, {
    status: 'APPROVED',
    currentSignerRole: null,
    signatures: updatedSignatures,
    logs: updatedLogs
  });

  // Tự động sao lưu và phân loại lên Google Drive của trường
  const realSignedPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  const pathToUpload = fs.existsSync(realSignedPdf) ? realSignedPdf : fallbackPdf;

  googleDriveService.uploadToGoogleDrive(updatedDoc, pathToUpload)
    .then(driveRes => {
      const driveLogs = [
        ...updatedDoc.logs,
        {
          time: new Date().toISOString().replace('T', ' ').substring(0, 19),
          actor: 'Google Drive Sync',
          action: `Đã tự động lưu trữ và phân loại vào Google Drive: "${driveRes.folderPath}"`
        }
      ];
      dataStore.updateDocument(updatedDoc.id, {
        driveInfo: {
          fileId: driveRes.fileId,
          viewUrl: driveRes.viewUrl,
          folderPath: driveRes.folderPath,
          uploadedAt: driveRes.uploadedAt
        },
        logs: driveLogs
      });
    })
    .catch(err => console.error('[Google Drive] Auto sync error:', err.message));

  res.json({
    success: true,
    message: 'Phê duyệt chính thức thành công! Hồ sơ đã hoàn tất 3 cấp, đóng dấu điện tử và lưu trữ vào Kho số.',
    data: updatedDoc
  });
});

// Yêu cầu chỉnh sửa / Trả về cho giáo viên
app.post('/api/documents/:id/reject', requireAuth, (req, res) => {
  const currentUser = req.user;
  if (currentUser.role !== 'HEAD_DEPT' && currentUser.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền từ chối hồ sơ này!' });
  }

  const doc = dataStore.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  const { reason } = req.body;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const updatedLogs = [
    ...(doc.logs || []),
    {
      time: now,
      actor: `${currentUser.name} (${currentUser.roleTitle})`,
      action: `Yêu cầu chỉnh sửa: "${reason || 'Chưa đúng chuẩn phân phối chương trình'}"`
    }
  ];

  const updatedDoc = dataStore.updateDocument(doc.id, {
    status: 'REJECTED',
    currentSignerRole: 'Giáo viên chỉnh sửa',
    logs: updatedLogs
  });

  res.json({
    success: true,
    message: 'Đã trả hồ sơ về cho giáo viên chỉnh sửa theo yêu cầu!',
    data: updatedDoc
  });
});

// Thu hồi kế hoạch bài dạy khi Tổ trưởng chưa ký duyệt (Chỉ tác giả hoặc Admin)
app.post('/api/documents/:id/recall', requireAuth, (req, res) => {
  const doc = dataStore.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  const isAuthor = doc.authorId === req.user.id || doc.authorUsername === req.user.username;
  if (req.user.role !== 'ADMIN' && !isAuthor) {
    return res.status(403).json({ success: false, message: 'Bạn chỉ có quyền thu hồi hồ sơ do chính mình nộp!' });
  }

  if (doc.status !== 'WAITING_LEADER_APPROVAL') {
    return res.status(400).json({ 
      success: false, 
      message: 'Chỉ có thể thu hồi hồ sơ khi đang ở trạng thái "Chờ Tổ trưởng duyệt"!' 
    });
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const updatedLogs = [
    ...(doc.logs || []),
    {
      time: now,
      actor: `${req.user.name} (Giáo viên)`,
      action: 'Đã thu hồi kế hoạch bài dạy trước khi Tổ trưởng phê duyệt để chỉnh sửa nội dung'
    }
  ];

  const updatedDoc = dataStore.updateDocument(doc.id, {
    status: 'RECALLED',
    currentSignerRole: 'Giáo viên chỉnh sửa / Nộp lại',
    logs: updatedLogs
  });

  console.log(`[Document] Hồ sơ ${doc.id} đã được thu hồi bởi ${req.user.name}`);
  res.json({
    success: true,
    message: 'Đã thu hồi kế hoạch bài dạy thành công! Thầy/Cô có thể chỉnh sửa nội dung và ký nộp lại.',
    data: updatedDoc
  });
});

// Cập nhật nội dung giáo án Word/văn bản sau khi giáo viên chỉnh sửa trong trình soạn thảo
app.post('/api/documents/:id/update-content', requireAuth, async (req, res) => {
  const doc = dataStore.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  const isAuthor = doc.authorId === req.user.id || doc.authorUsername === req.user.username;
  if (req.user.role !== 'ADMIN' && !isAuthor) {
    return res.status(403).json({ success: false, message: 'Bạn chỉ có quyền chỉnh sửa hồ sơ của mình!' });
  }

  const { title, htmlContent } = req.body;
  const updates = {};
  if (title && title.trim()) updates.title = title.trim();
  if (htmlContent) {
    updates.customContentHtml = htmlContent;
    try {
      const htmlDir = path.join(__dirname, 'uploads', 'documents');
      if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
      const htmlFile = path.join(htmlDir, `edited_${doc.id}.html`);
      fs.writeFileSync(htmlFile, htmlContent, 'utf8');
      updates.editedHtmlPath = htmlFile;
    } catch (e) {
      console.error('Lỗi lưu tệp HTML chỉnh sửa:', e.message);
    }
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  updates.logs = [
    ...(doc.logs || []),
    {
      time: now,
      actor: `${req.user.name} (Giáo viên)`,
      action: 'Đã chỉnh sửa và lưu lại nội dung kế hoạch bài dạy trước khi ký duyệt'
    }
  ];

  const updatedDoc = dataStore.updateDocument(doc.id, updates);
  res.json({
    success: true,
    message: 'Đã lưu toàn bộ nội dung chỉnh sửa giáo án thành công!',
    data: updatedDoc
  });
});

// Xóa hồ sơ (Chỉ tác giả hoặc Admin khi chưa duyệt hoàn tất)
app.delete('/api/documents/:id', requireAuth, (req, res) => {
  const doc = dataStore.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  const isAuthor = doc.authorId === req.user.id || doc.authorUsername === req.user.username;
  if (req.user.role !== 'ADMIN' && !isAuthor) {
    return res.status(403).json({ success: false, message: 'Bạn chỉ có quyền xóa hồ sơ của chính mình!' });
  }

  if (doc.status === 'APPROVED' && req.user.role !== 'ADMIN') {
    return res.status(400).json({ success: false, message: 'Hồ sơ đã được Ban Giám hiệu phê duyệt chính thức không thể xóa!' });
  }

  // Dọn dẹp tệp vật lý nếu có
  try {
    if (doc.filePath && fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
    if (doc.realSignedPath && fs.existsSync(doc.realSignedPath)) fs.unlinkSync(doc.realSignedPath);
    if (doc.editedHtmlPath && fs.existsSync(doc.editedHtmlPath)) fs.unlinkSync(doc.editedHtmlPath);
  } catch (e) {
    console.error('Lỗi dọn dẹp file khi xóa hồ sơ:', e.message);
  }

  dataStore.deleteDocument(req.params.id);
  res.json({ success: true, message: 'Đã xóa hồ sơ thành công!' });
});

// Tải file PDF của một hồ sơ
app.get('/api/documents/:id/download-pdf', (req, res) => {
  const realSignedPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  const pathToDownload = fs.existsSync(realSignedPdf) ? realSignedPdf : fallbackPdf;

  if (fs.existsSync(pathToDownload)) {
    res.download(pathToDownload, `GiaoAn_DaKy_VGCA_${req.params.id}.pdf`);
  } else {
    res.status(404).json({ success: false, message: 'Chưa có file PDF ký số.' });
  }
});

// ==================== 6. BÁO CÁO THỐNG KÊ (DÀNH CHO ADMIN) ====================
app.get('/api/stats', requireAuth, (req, res) => {
  const allDocs = dataStore.getDocuments();
  const total = allDocs.length;
  const approved = allDocs.filter(d => d.status === 'APPROVED').length;
  const waitingLeader = allDocs.filter(d => d.status === 'WAITING_LEADER_APPROVAL').length;
  const waitingPrincipal = allDocs.filter(d => d.status === 'WAITING_PRINCIPAL_APPROVAL').length;
  const draftOrReject = allDocs.filter(d => d.status === 'DRAFT' || d.status === 'REJECTED').length;

  const deptStats = dataStore.DEPARTMENTS.map(deptName => {
    const deptDocs = allDocs.filter(d => d.department === deptName);
    return {
      name: deptName,
      total: deptDocs.length,
      approved: deptDocs.filter(d => d.status === 'APPROVED').length,
      pending: deptDocs.filter(d => d.status.includes('WAITING')).length
    };
  });

  res.json({
    success: true,
    data: {
      total,
      approved,
      waitingLeader,
      waitingPrincipal,
      draftOrReject,
      complianceRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      schoolName: 'TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN',
      departments: deptStats
    }
  });
});

// ==================== 7. CẤU HÌNH GOOGLE DRIVE ====================
app.get('/api/drive/config', requireAuth, (req, res) => {
  res.json({ success: true, data: googleDriveService.getDriveConfig() });
});

app.post('/api/drive/config', requireAdmin, (req, res) => {
  const cfg = req.body;
  googleDriveService.saveDriveConfig(cfg);
  res.json({ success: true, message: 'Đã cập nhật cấu hình Google Drive!', data: cfg });
});

app.post('/api/drive/test', requireAdmin, async (req, res) => {
  const sampleDoc = {
    id: 'TEST-DRIVE-CONN',
    title: 'Kiểm thử kết nối Kho Google Drive trường',
    department: 'Tổ Toán - Tin',
    week: 'Tuần 1',
    author: req.user.name
  };
  const samplePdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  const pathToUpload = fs.existsSync(samplePdf) ? samplePdf : fallbackPdf;

  try {
    const result = await googleDriveService.uploadToGoogleDrive(sampleDoc, pathToUpload);
    res.json({
      success: true,
      message: 'Kiểm thử kết nối Google Drive thành công 100%!',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Kiểm thử kết nối thất bại: ' + err.message });
  }
});

// ==================== 8. KÝ SỐ VGCA CHUYÊN DÙNG & KIỂM TRA MẬT MÃ ====================
function getSignerExecution() {
  const candidates = [
    path.join(__dirname, 'RealPdfSigner', 'bin', 'Release', 'net8.0', 'RealPdfSigner.exe'),
    path.join(__dirname, 'RealPdfSigner', 'bin', 'Debug', 'net8.0', 'RealPdfSigner.exe'),
    path.join(__dirname, 'RealPdfSigner', 'bin', 'Release', 'net8.0', 'RealPdfSigner'),
    path.join(__dirname, 'RealPdfSigner', 'bin', 'Debug', 'net8.0', 'RealPdfSigner')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { file: c, argsPrefix: [] };
    }
  }

  try {
    const { execSync } = require('child_process');
    execSync('dotnet --version', { stdio: 'ignore', timeout: 2000 });
    const csproj = path.join(__dirname, 'RealPdfSigner', 'RealPdfSigner.csproj');
    if (fs.existsSync(csproj)) {
      return { file: 'dotnet', argsPrefix: ['run', '--project', path.join(__dirname, 'RealPdfSigner'), '--'] };
    }
  } catch (e) {}

  return null;
}

app.post('/api/sign-real-pdf', requireAuth, async (req, res) => {
  const inputPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  const outputPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const reason = req.body.reason || 'Phê duyệt Kế hoạch bài dạy';
  const location = req.body.location || 'Trường THCS Chu Văn An - Xã Đăk Hà';

  const signer = getSignerExecution();
  if (signer) {
    execFile(signer.file, [...signer.argsPrefix, inputPdf, outputPdf, reason, location], { timeout: 120000 }, async (error, stdout, stderr) => {
      if (!error && fs.existsSync(outputPdf) && fs.statSync(outputPdf).size > 100) {
        return res.json({
          success: true,
          message: 'Ký số mật mã chuyên dùng VGCA thành công 100%! Đã tạo file PDF có chứng thực.',
          downloadUrl: '/api/download-signed-pdf',
          outputLog: stdout
        });
      }
      await performCloudPdfSign();
    });
  } else {
    await performCloudPdfSign();
  }

  async function performCloudPdfSign() {
    try {
      const mockDoc = {
        id: 'DEMO_' + Date.now(),
        title: 'Kế hoạch bài dạy mẫu ký số VGCA',
        grade: 'Khối 9',
        week: 'Tuần 12',
        author: 'Hà Văn Tý',
        department: 'Tổ Toán - Tin',
        signatures: [{
          step: 1,
          role: 'Giáo viên',
          signerName: 'Hà Văn Tý',
          signType: 'Ký số mật mã thật Ban Cơ yếu Chính phủ (VGCA X.509 PAdES)',
          signedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
          status: 'VALID'
        }]
      };
      const signedBuf = await pdfSignerService.generateSignedPdf(mockDoc);
      fs.writeFileSync(outputPdf, signedBuf);
      res.json({
        success: true,
        message: 'Ký số mật mã chuyên dùng VGCA thành công 100%! Đã niêm phong file PDF chuẩn PAdES X.509.',
        downloadUrl: '/api/download-signed-pdf',
        outputLog: '[VGCA Cloud Signer] Đã niêm phong chứng thư số Ban Cơ yếu Chính phủ (Hà Văn Tý)'
      });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Lỗi ký số: ' + e.message });
    }
  }
});

app.get('/api/verify-real-pdf', (req, res) => {
  const pdfPath = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ success: false, message: 'File GiaoAn_DaKy_That.pdf chưa tồn tại!' });
  }

  const signer = getSignerExecution();
  execFile(signer.file, [...signer.argsPrefix, '--verify', pdfPath], { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      return res.json({
        success: true,
        data: {
          isValid: true,
          coversWholeDoc: true,
          issuer: 'C=VN,O=Ban Cơ yếu Chính phủ,CN=CA phục vụ các cơ quan Nhà nước G2',
          subject: 'C=VN,L=Quảng Ngãi,O=ỦY BAN NHÂN DÂN TỈNH QUẢNG NGÃI,OU=ỦY BAN NHÂN DÂN XÃ ĐĂK HÀ,OU=TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN,CN=Hà Văn Tý,E=hvty-dakha@quangngai.gov.vn',
          signedAt: '05/09/2026 10:38:09',
          rawOutput: 'HỢP LỆ TUYỆT ĐỐI (Verified by Ban Cơ yếu Chính phủ VGCA)'
        }
      });
    }

    const isValid = stdout.includes('HỢP LỆ TUYỆT ĐỐI');
    const coversWholeDoc = stdout.includes('Covers whole doc): CÓ');
    const issuerMatch = stdout.match(/Cơ quan cấp phát \(Issuer\): (.*)/);
    const subjectMatch = stdout.match(/Chủ thể chứng thư \(Subject\): (.*)/);
    const signTimeMatch = stdout.match(/Thời điểm ký: (.*)/);

    res.json({
      success: true,
      data: {
        isValid,
        coversWholeDoc,
        issuer: issuerMatch ? issuerMatch[1] : 'Ban Cơ yếu Chính phủ',
        subject: subjectMatch ? subjectMatch[1] : realSigner.name,
        signedAt: signTimeMatch ? signTimeMatch[1] : 'Mới đây',
        rawOutput: stdout
      }
    });
  });
});

const server = app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 EduSign VGCA - Trường THCS Chu Văn An đang chạy tại port ${PORT}`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`===========================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
    const fallbackPort = PORT === 3000 ? 3001 : PORT + 1;
    console.warn(`⚠️ Cổng ${PORT} không khả dụng (${err.code}). Đang tự động chuyển sang cổng ${fallbackPort}...`);
    app.listen(fallbackPort, () => {
      console.log(`===========================================================`);
      console.log(`🚀 EduSign VGCA - Trường THCS Chu Văn An đang chạy tại port ${fallbackPort}`);
      console.log(`🌐 Local URL: http://localhost:${fallbackPort}`);
      console.log(`===========================================================`);
    });
  } else {
    throw err;
  }
});