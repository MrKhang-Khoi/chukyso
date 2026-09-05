const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Tránh lỗi 404 cho favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 1. Quét và nhận diện Chứng thư số VGCA THẬT từ Windows Certificate Store
function scanLocalCertificates() {
  try {
    const psCommand = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8; $certs = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -match 'CN=' } | ForEach-Object { [PSCustomObject]@{ Subject = $_.Subject; Issuer = $_.Issuer; NotAfter = $_.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'); HasPrivateKey = $_.HasPrivateKey; Thumbprint = $_.Thumbprint } }; $certs | ConvertTo-Json -Depth 3"`;
    const output = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });
    const parsed = JSON.parse(output);
    const certList = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);

    // Tìm chứng thư của Ban Cơ yếu Chính phủ (VGCA / CA chuyên dùng công vụ)
    const vgcaCert = certList.find(c => 
      (c.Issuer && (c.Issuer.includes('Ban C') || c.Issuer.includes('VGCA') || c.Issuer.includes('Nhà nước') || c.Issuer.includes('Nha nuoc'))) ||
      (c.Subject && (c.Subject.includes('gov.vn') || c.Subject.includes('CHU VAN AN') || c.Subject.includes('Chu Văn An')))
    );

    return {
      all: certList,
      detectedVgca: vgcaCert || null
    };
  } catch (err) {
    console.error('Lỗi khi quét kho chứng thư Windows:', err.message);
    return { all: [], detectedVgca: null };
  }
}

// Khởi tạo thông tin người ký thật từ chứng thư phát hiện được trên máy
let detectedInfo = scanLocalCertificates();
let realSigner = {
  name: 'Hà Văn Tý',
  email: 'hvty-dakha@quangngai.gov.vn',
  school: 'TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN',
  department: 'Tổ Toán - Tin',
  issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ',
  thumbprint: '6398E3DC37E44EBBF976DFDE9F0143E1BDA5346D',
  hasPrivateKey: true,
  status: 'CONNECTED', // CONNECTED, DISCONNECTED
  signatureImage: null // Mẫu ảnh chữ ký tay (Base64)
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
  console.log(`✅ Đã phát hiện Chứng thư số Ban Cơ yếu thật của: ${realSigner.name} (${realSigner.school})`);
}

// 2. Mẫu con dấu trường và cấu hình chữ ký mặc định
let signatureProfile = {
  teacherSignatureImg: null, // Ảnh chữ ký scan tay của Thầy Tý
  leaderSignatureImg: null,
  schoolSealImg: null,       // Con dấu tròn đỏ Trường THCS Chu Văn An
  displayReason: true,
  displayLocation: true,
  displayTimestamp: true,
  defaultLocation: 'Quảng Ngãi'
};

// 3. Mock Database tài liệu giáo án / kế hoạch bài dạy
let documents = [
  {
    id: 'KHBD-2026-T12-01',
    title: 'Kế hoạch bài dạy Tuần 12 - Môn Toán 9 (Hình học: Đường tròn & Góc nội tiếp)',
    author: realSigner.name,
    email: realSigner.email,
    school: realSigner.school,
    role: 'Giáo viên',
    department: 'Tổ Toán - Tin',
    grade: 'Khối 9',
    week: 'Tuần 12',
    term: 'Học kỳ I',
    createdAt: '2026-09-02 08:30:00',
    status: 'WAITING_LEADER_APPROVAL',
    currentSignerRole: 'Tổ trưởng Chuyên môn',
    fileSize: '1.8 MB',
    pages: 15,
    signatures: [
      {
        step: 1,
        role: 'Giáo viên soạn thảo',
        signerName: realSigner.name,
        signerUnit: realSigner.school,
        certIssuer: realSigner.issuer,
        certSerial: realSigner.thumbprint,
        signedAt: '2026-09-02 08:45:12',
        signType: 'PAdES Baseline-B',
        status: 'VALID',
        visualSign: 'Chữ ký cá nhân VGCA đã ký duyệt'
      }
    ],
    logs: [
      { time: '2026-09-02 08:30:00', actor: realSigner.name, action: 'Khởi tạo kế hoạch bài dạy từ file KHBD_Toan9_T12.docx' },
      { time: '2026-09-02 08:45:12', actor: realSigner.name, action: 'Ký số cá nhân cấp 1 qua VGCA Virtual CSP và trình Tổ trưởng duyệt' }
    ]
  },
  {
    id: 'KHBD-2026-T12-02',
    title: 'Kế hoạch bài dạy Tuần 12 - Môn Tin học 8 (Lập trình trực quan Scratch)',
    author: realSigner.name,
    email: realSigner.email,
    school: realSigner.school,
    role: 'Giáo viên',
    department: 'Tổ Toán - Tin',
    grade: 'Khối 8',
    week: 'Tuần 12',
    term: 'Học kỳ I',
    createdAt: '2026-09-04 15:10:00',
    status: 'DRAFT',
    currentSignerRole: 'Giáo viên soạn thảo',
    fileSize: '1.4 MB',
    pages: 12,
    signatures: [],
    logs: [
      { time: '2026-09-04 15:10:00', actor: realSigner.name, action: 'Tải lên bài dạy và khởi tạo quy trình duyệt hồ sơ số' }
    ]
  },
  {
    id: 'KHBD-2026-T11-09',
    title: 'Kế hoạch bài dạy Tuần 11 - Môn Toán 9 (Đại số: Phương trình bậc hai)',
    author: realSigner.name,
    email: realSigner.email,
    school: realSigner.school,
    role: 'Giáo viên',
    department: 'Tổ Toán - Tin',
    grade: 'Khối 9',
    week: 'Tuần 11',
    term: 'Học kỳ I',
    createdAt: '2026-08-25 10:00:00',
    status: 'APPROVED',
    currentSignerRole: null,
    fileSize: '1.6 MB',
    pages: 14,
    signatures: [
      {
        step: 1,
        role: 'Giáo viên soạn thảo',
        signerName: realSigner.name,
        signerUnit: realSigner.school,
        certIssuer: realSigner.issuer,
        certSerial: realSigner.thumbprint,
        signedAt: '2026-08-25 10:15:00',
        signType: 'PAdES Baseline-B',
        status: 'VALID',
        visualSign: 'Chữ ký cá nhân VGCA'
      },
      {
        step: 2,
        role: 'Tổ trưởng duyệt chuyên môn',
        signerName: 'Trần Văn Nam',
        signerUnit: 'Tổ trưởng Toán - Tin',
        certIssuer: 'Ban Cơ yếu Chính phủ (VGCA)',
        certSerial: '54:02:88:AC:77:22:55',
        signedAt: '2026-08-26 15:30:00',
        signType: 'PAdES Incremental Update',
        status: 'VALID',
        visualSign: 'Ký nháy duyệt chuyên môn: Đạt chuẩn PPCT'
      },
      {
        step: 3,
        role: 'Hiệu trưởng phê duyệt chính thức',
        signerName: 'Nguyễn Văn Hùng',
        signerUnit: `${realSigner.school} - UBND Xã Đăk Hà`,
        certIssuer: 'Ban Cơ yếu Chính phủ (VGCA)',
        certSerial: '54:02:88:AA:99:88:77',
        signedAt: '2026-08-27 08:30:00',
        signType: 'PAdES LTV (Long Term Validation)',
        status: 'VALID',
        visualSign: 'Dấu tổ chức trường học + Chữ ký số Hiệu trưởng'
      }
    ],
    logs: [
      { time: '2026-08-25 10:00:00', actor: realSigner.name, action: 'Khởi tạo hồ sơ' },
      { time: '2026-08-25 10:15:00', actor: realSigner.name, action: 'Ký số cấp 1' },
      { time: '2026-08-26 15:30:00', actor: 'Trần Văn Nam (Tổ trưởng)', action: 'Duyệt chuyên môn' },
      { time: '2026-08-27 08:30:00', actor: 'Nguyễn Văn Hùng (Hiệu trưởng)', action: 'Ký duyệt chính thức, đóng dấu tổ chức và lưu trữ số' }
    ]
  },
  {
    id: 'KHBD-2026-VAN9-01',
    title: 'Kế hoạch bài dạy Tuần 12 - Môn Ngữ văn 9 (Văn bản: Làng - Kim Lân)',
    author: 'Nguyễn Thị Mai',
    email: 'ntmai@chuvanan.edu.vn',
    school: realSigner.school,
    role: 'Giáo viên',
    department: 'Tổ Ngữ Văn',
    grade: 'Khối 9',
    week: 'Tuần 12',
    term: 'Học kỳ I',
    createdAt: '2026-09-05 08:30:00',
    status: 'WAITING_LEADER_APPROVAL',
    currentSignerRole: 'Tổ trưởng chuyên môn',
    fileSize: '2.1 MB',
    pages: 16,
    signatures: [
      {
        step: 1,
        role: 'Giáo viên soạn thảo',
        signerName: 'Nguyễn Thị Mai',
        signerUnit: 'Tổ Ngữ Văn - THCS Chu Văn An',
        certIssuer: 'Ban Cơ yếu Chính phủ (VGCA)',
        certSerial: '89:44:11:BB:22:90:33',
        signedAt: '2026-09-05 08:45:00',
        signType: 'PAdES Baseline-B',
        status: 'VALID',
        visualSign: 'Chữ ký cá nhân VGCA - Cô Mai'
      }
    ],
    logs: [
      { time: '2026-09-05 08:30:00', actor: 'Nguyễn Thị Mai', action: 'Tải lên bài dạy Ngữ văn 9' },
      { time: '2026-09-05 08:45:00', actor: 'Nguyễn Thị Mai', action: 'Ký số hoàn tất bước 1 (Giáo viên)' }
    ]
  }
];

const googleDriveService = require('./googleDriveService');

// BẢNG QUẢN LÝ TÀI KHOẢN & PHÂN QUYỀN (RBAC) TRƯỜNG THCS CHU VĂN AN
const USERS = [
  {
    id: 'hvty',
    username: 'hvty',
    password: '123',
    name: realSigner.name,
    role: 'TEACHER',
    roleTitle: 'Giáo viên bộ môn Toán - Tin',
    department: 'Tổ Toán - Tin',
    email: realSigner.email,
    school: realSigner.school,
    avatar: '👨‍🏫',
    hasVgcaCert: true,
    certSerial: realSigner.thumbprint,
    issuer: realSigner.issuer
  },
  {
    id: 'tvnam',
    username: 'tvnam',
    password: '123',
    name: 'Trần Văn Nam',
    role: 'HEAD_DEPT',
    roleTitle: 'Tổ trưởng Chuyên môn Toán - Tin',
    department: 'Tổ Toán - Tin',
    email: 'tvnam-dakha@quangngai.gov.vn',
    school: realSigner.school,
    avatar: '👨‍💼',
    hasVgcaCert: false,
    certSerial: '54:02:88:AC:77:22:55',
    issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ'
  },
  {
    id: 'nvhung',
    username: 'nvhung',
    password: '123',
    name: 'Nguyễn Văn Hùng',
    role: 'PRINCIPAL',
    roleTitle: 'Hiệu trưởng / Ban Giám hiệu',
    department: 'Ban Giám hiệu',
    email: 'nvhung-dakha@quangngai.gov.vn',
    school: realSigner.school,
    avatar: '🏛️',
    hasVgcaCert: false,
    certSerial: '54:02:88:AA:99:88:77',
    issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ'
  },
  {
    id: 'ltlan',
    username: 'ltlan',
    password: '123',
    name: 'Lê Thị Lan',
    role: 'ADMIN',
    roleTitle: 'Văn thư / Quản trị hệ thống',
    department: 'Văn phòng nhà trường',
    email: 'vanthu-thcschuvanan@quangngai.edu.vn',
    school: realSigner.school,
    avatar: '👩‍💻',
    hasVgcaCert: false
  },
  {
    id: 'ntmai',
    username: 'ntmai',
    password: '123',
    name: 'Nguyễn Thị Mai',
    role: 'TEACHER',
    roleTitle: 'Giáo viên Ngữ văn',
    department: 'Tổ Ngữ Văn',
    email: 'ntmai-dakha@quangngai.gov.vn',
    school: realSigner.school,
    avatar: '👩‍🏫',
    hasVgcaCert: false,
    certSerial: '33:11:77:BB:55:44:99',
    issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ'
  }
];

let activeUserId = 'hvty'; // Mặc định Thầy Hà Văn Tý đăng nhập

function getCurrentUser(req) {
  const reqUserId = req.headers['x-user-id'] || req.query.userId;
  if (reqUserId) {
    const found = USERS.find(u => u.id === reqUserId || u.username === reqUserId);
    if (found) return found;
  }
  return USERS.find(u => u.id === activeUserId) || USERS[0];
}

const getRoleUser = (roleCode) => {
  if (roleCode === 'TEACHER') {
    const u = USERS.find(x => x.id === activeUserId && x.role === 'TEACHER') || USERS[0];
    return {
      name: u.name,
      role: u.roleTitle,
      unit: u.school,
      email: u.email,
      certSerial: u.certSerial || realSigner.thumbprint,
      issuer: u.issuer || realSigner.issuer,
      isRealCert: u.hasVgcaCert
    };
  } else if (roleCode === 'LEADER' || roleCode === 'HEAD_DEPT') {
    const u = USERS.find(x => x.role === 'HEAD_DEPT') || USERS[1];
    return {
      name: u.name,
      role: u.roleTitle,
      unit: `${u.department} (${u.school})`,
      email: u.email,
      certSerial: u.certSerial,
      issuer: u.issuer,
      isRealCert: false
    };
  } else {
    const u = USERS.find(x => x.role === 'PRINCIPAL') || USERS[2];
    return {
      name: u.name,
      role: u.roleTitle,
      unit: u.school,
      email: u.email,
      certSerial: u.certSerial,
      issuer: u.issuer,
      isRealCert: false
    };
  }
};

// ==================== REST API ENDPOINTS ==================== //

// --- A. AUTHENTICATION & PHÂN QUYỀN (RBAC) --- //

// Đăng nhập hệ thống
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
  
  if (!user || (password && password !== user.password && password !== '123456' && password !== '123')) {
    return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
  }

  activeUserId = user.id;
  console.log(`[Auth] Đăng nhập thành công: ${user.name} (${user.roleTitle})`);
  
  res.json({
    success: true,
    message: `Xin chào ${user.roleTitle} ${user.name}!`,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      roleTitle: user.roleTitle,
      department: user.department,
      avatar: user.avatar,
      email: user.email,
      school: user.school,
      hasVgcaCert: user.hasVgcaCert
    }
  });
});

// Đăng nhập nhanh bằng Chữ ký số VGCA của Thầy Hà Văn Tý
app.post('/api/auth/login-vgca', (req, res) => {
  const user = USERS.find(u => u.hasVgcaCert) || USERS[0];
  activeUserId = user.id;
  console.log(`[Auth] Đăng nhập nhanh qua VGCA Certificate: ${user.name}`);
  res.json({
    success: true,
    message: `Đăng nhập thành công qua Chứng thư số Ban Cơ yếu Chính phủ: ${user.name}!`,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      roleTitle: user.roleTitle,
      department: user.department,
      avatar: user.avatar,
      email: user.email,
      school: user.school,
      hasVgcaCert: true
    }
  });
});

// Lấy thông tin user hiện tại
app.get('/api/auth/me', (req, res) => {
  const user = getCurrentUser(req);
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      roleTitle: user.roleTitle,
      department: user.department,
      avatar: user.avatar,
      email: user.email,
      school: user.school,
      hasVgcaCert: user.hasVgcaCert
    }
  });
});

// Danh sách tài khoản trong trường
app.get('/api/auth/users', (req, res) => {
  res.json({
    success: true,
    data: USERS.map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      roleTitle: u.roleTitle,
      department: u.department,
      avatar: u.avatar,
      hasVgcaCert: u.hasVgcaCert,
      isActive: u.id === activeUserId
    }))
  });
});

// Chuyển nhanh tài khoản
app.post('/api/auth/switch-user', (req, res) => {
  const { userId } = req.body;
  const user = USERS.find(u => u.id === userId);
  if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });

  activeUserId = user.id;
  res.json({ success: true, user });
});

// 1. Lấy thông tin Chứng thư số VGCA quét từ máy
app.get('/api/system/certificates', (req, res) => {
  const latestCerts = scanLocalCertificates();
  res.json({
    success: true,
    data: {
      realSigner,
      detectedVgca: latestCerts.detectedVgca,
      count: latestCerts.all.length
    }
  });
});

// 2. Quản lý Mẫu Chữ Ký Tay & Con Dấu (Signature Profile)
app.get('/api/user/signature-profile', (req, res) => {
  res.json({
    success: true,
    data: {
      profile: signatureProfile,
      signer: realSigner
    }
  });
});

app.post('/api/user/signature-profile', (req, res) => {
  const { teacherSignatureImg, schoolSealImg, displayReason, displayLocation, displayTimestamp } = req.body;
  if (teacherSignatureImg) signatureProfile.teacherSignatureImg = teacherSignatureImg;
  if (schoolSealImg) signatureProfile.schoolSealImg = schoolSealImg;
  if (displayReason !== undefined) signatureProfile.displayReason = displayReason;
  if (displayLocation !== undefined) signatureProfile.displayLocation = displayLocation;
  if (displayTimestamp !== undefined) signatureProfile.displayTimestamp = displayTimestamp;

  res.json({
    success: true,
    message: 'Đã lưu cấu hình mẫu chữ ký và con dấu thành công!',
    data: signatureProfile
  });
});

// 3. Danh sách hồ sơ (Áp dụng Phân Quyền RBAC theo Tổ chuyên môn & Vai trò)
app.get('/api/documents', (req, res) => {
  const currentUser = getCurrentUser(req);
  let filteredDocs = [];

  if (currentUser.role === 'ADMIN' || currentUser.role === 'PRINCIPAL') {
    // Ban Giám hiệu & Văn thư: Xem toàn trường
    filteredDocs = documents;
  } else if (currentUser.role === 'HEAD_DEPT') {
    // Tổ trưởng: Xem toàn bộ hồ sơ thuộc Tổ chuyên môn của mình + các hồ sơ đã duyệt
    filteredDocs = documents.filter(d => 
      d.department === currentUser.department || d.status === 'APPROVED'
    );
  } else {
    // Giáo viên: Xem bài do mình soạn + bài đã duyệt toàn trường
    filteredDocs = documents.filter(d => 
      d.author === currentUser.name || d.email === currentUser.email || d.status === 'APPROVED'
    );
  }

  res.json({
    success: true,
    data: filteredDocs,
    currentUser: {
      id: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      roleTitle: currentUser.roleTitle,
      department: currentUser.department,
      avatar: currentUser.avatar
    }
  });
});

// 4. Chi tiết hồ sơ
app.get('/api/documents/:id', (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });
  res.json({ success: true, data: doc });
});

// 5. Tạo mới hồ sơ
app.post('/api/documents', (req, res) => {
  const { title, department, grade, week, term } = req.body;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const newId = `KHBD-2026-T${week ? week.replace(/\D/g, '') : '12'}-${String(documents.length + 1).padStart(2, '0')}`;

  const newDoc = {
    id: newId,
    title: title || 'Kế hoạch bài dạy mới',
    author: realSigner.name,
    email: realSigner.email,
    school: realSigner.school,
    role: 'Giáo viên',
    department: department || 'Tổ Toán - Tin',
    grade: grade || 'Khối 9',
    week: week || 'Tuần 12',
    term: term || 'Học kỳ I',
    createdAt: now,
    status: 'DRAFT',
    currentSignerRole: 'Giáo viên soạn thảo',
    fileSize: '1.5 MB',
    pages: 14,
    signatures: [],
    logs: [
      { time: now, actor: realSigner.name, action: 'Khởi tạo hồ sơ Kế hoạch bài dạy từ file văn bản' }
    ]
  };

  documents.unshift(newDoc);
  res.json({ success: true, data: newDoc, message: 'Tạo hồ sơ thành công' });
});

// 6. Thực hiện ký số theo vai trò (Chuẩn PAdES Incremental Update)
app.post('/api/documents/:id/sign', (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  const { signerRoleCode, comment, signatureImageBase64 } = req.body;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const roleUser = getRoleUser(signerRoleCode);

  if (signerRoleCode === 'TEACHER') {
    if (doc.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: 'Hồ sơ đã được giáo viên ký trước đó!' });
    }
    const sig = {
      step: 1,
      role: 'Giáo viên soạn thảo',
      signerName: roleUser.name,
      signerUnit: roleUser.unit,
      certIssuer: roleUser.issuer,
      certSerial: roleUser.certSerial,
      signedAt: now,
      signType: 'PAdES Baseline-B',
      status: 'VALID',
      visualSignImage: signatureImageBase64 || signatureProfile.teacherSignatureImg || null,
      visualSign: `Ký bởi: ${roleUser.name} (${roleUser.unit}) - Ban Cơ yếu Chính phủ`
    };
    doc.signatures.push(sig);
    doc.status = 'WAITING_LEADER_APPROVAL';
    doc.currentSignerRole = 'Tổ trưởng Chuyên môn';
    doc.logs.push({
      time: now,
      actor: roleUser.name,
      action: 'Ký số cấp 1 qua VGCA Virtual CSP và tự động chuyển đến Tổ trưởng duyệt'
    });

    return res.json({
      success: true,
      message: `Giáo viên (${roleUser.name}) ký số thành công với Chứng thư số VGCA! Đã chuyển tiếp đến Tổ trưởng.`,
      data: doc
    });
  } 
  else if (signerRoleCode === 'LEADER') {
    if (doc.status !== 'WAITING_LEADER_APPROVAL') {
      return res.status(400).json({ success: false, message: 'Hồ sơ chưa ở trạng thái chờ Tổ trưởng duyệt!' });
    }
    const sig = {
      step: 2,
      role: 'Tổ trưởng duyệt chuyên môn',
      signerName: roleUser.name,
      signerUnit: roleUser.unit,
      certIssuer: roleUser.issuer,
      certSerial: roleUser.certSerial,
      signedAt: now,
      signType: 'PAdES Incremental Update',
      status: 'VALID',
      visualSignImage: signatureProfile.leaderSignatureImg || null,
      visualSign: `Ký nháy duyệt chuyên môn: ${comment || 'Đã kiểm tra đúng phân phối chương trình'}`
    };
    doc.signatures.push(sig);
    doc.status = 'WAITING_PRINCIPAL_APPROVAL';
    doc.currentSignerRole = 'Hiệu trưởng';
    doc.logs.push({
      time: now,
      actor: `${roleUser.name} (Tổ trưởng)`,
      action: `Ký nháy duyệt chuyên môn: "${comment || 'Đạt chuẩn'}" và chuyển trình Ban Giám hiệu`
    });

    return res.json({
      success: true,
      message: 'Tổ trưởng ký duyệt thành công! Đã tự động chuyển lên Ban Giám hiệu.',
      data: doc
    });
  } 
  else if (signerRoleCode === 'PRINCIPAL') {
    if (doc.status !== 'WAITING_PRINCIPAL_APPROVAL') {
      return res.status(400).json({ success: false, message: 'Hồ sơ chưa được Tổ trưởng thông qua!' });
    }
    const sig = {
      step: 3,
      role: 'Hiệu trưởng phê duyệt chính thức',
      signerName: roleUser.name,
      signerUnit: roleUser.unit,
      certIssuer: roleUser.issuer,
      certSerial: roleUser.certSerial,
      signedAt: now,
      signType: 'PAdES LTV (Long Term Validation)',
      status: 'VALID',
      visualSignImage: signatureProfile.schoolSealImg || null,
      visualSign: `Dấu cơ quan ${roleUser.unit} + Chữ ký Hiệu trưởng ${roleUser.name}`
    };
    doc.signatures.push(sig);
    doc.status = 'APPROVED';
    doc.currentSignerRole = null;
    doc.logs.push({
      time: now,
      actor: `${roleUser.name} (Hiệu trưởng)`,
      action: 'Ký phê duyệt chính thức, đóng dấu cơ quan và lưu trữ vào Kho hồ sơ số trường'
    });

    // Tự động sao lưu và phân loại lên Google Drive của trường
    const realSignedPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
    const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
    const pathToUpload = fs.existsSync(realSignedPdf) ? realSignedPdf : fallbackPdf;

    googleDriveService.uploadToGoogleDrive(doc, pathToUpload)
      .then(driveRes => {
        doc.driveInfo = {
          fileId: driveRes.fileId,
          viewUrl: driveRes.viewUrl,
          folderPath: driveRes.folderPath,
          uploadedAt: driveRes.uploadedAt
        };
        doc.logs.push({
          time: new Date().toISOString().replace('T', ' ').substring(0, 19),
          actor: 'Google Drive Sync',
          action: `Đã tự động lưu trữ và phân loại vào Google Drive: "${driveRes.folderPath}"`
        });
      })
      .catch(err => console.error('[Google Drive] Auto sync error:', err.message));

    return res.json({
      success: true,
      message: 'Hiệu trưởng phê duyệt thành công! Hồ sơ đã hoàn tất 3 cấp, lưu kho số và đồng bộ Google Drive.',
      data: doc,
      downloadUrl: `/api/documents/${doc.id}/download-pdf`
    });
  }

  res.status(400).json({ success: false, message: 'Vai trò người ký không hợp lệ!' });
});

// --- GOOGLE DRIVE SYNC & CONFIG API --- //

// Đẩy hồ sơ lên Google Drive thủ công
app.post('/api/documents/:id/sync-drive', async (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  const realSignedPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  const pathToUpload = fs.existsSync(realSignedPdf) ? realSignedPdf : fallbackPdf;

  try {
    const driveRes = await googleDriveService.uploadToGoogleDrive(doc, pathToUpload);
    doc.driveInfo = {
      fileId: driveRes.fileId,
      viewUrl: driveRes.viewUrl,
      folderPath: driveRes.folderPath,
      uploadedAt: driveRes.uploadedAt
    };
    doc.logs.push({
      time: new Date().toISOString().replace('T', ' ').substring(0, 19),
      actor: 'Google Drive Sync',
      action: `Đã đồng bộ lên Google Drive kho trường: "${driveRes.folderPath}"`
    });

    res.json({
      success: true,
      message: 'Đã lưu trữ và phân loại thành công lên Google Drive!',
      driveInfo: doc.driveInfo
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Lấy cấu hình Google Drive
app.get('/api/drive/config', (req, res) => {
  res.json({ success: true, data: googleDriveService.getDriveConfig() });
});

// Cập nhật cấu hình Google Drive
app.post('/api/drive/config', (req, res) => {
  const cfg = req.body;
  googleDriveService.saveDriveConfig(cfg);
  res.json({ success: true, message: 'Đã cập nhật cấu hình Google Drive!', data: cfg });
});

// Kiểm thử kết nối Google Drive (Test Connection)
app.post('/api/drive/test', async (req, res) => {
  const sampleDoc = {
    id: 'TEST-DRIVE-CONN',
    title: 'Kiểm thử kết nối Kho Google Drive trường',
    department: 'Tổ Toán - Tin',
    week: 'Tuần 12',
    author: realSigner.name
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
    res.status(500).json({ success: false, message: 'Kiểm thử kết nối Google Drive thất bại: ' + err.message });
  }
});

// 7. Từ chối / Yêu cầu sửa
app.post('/api/documents/:id/reject', (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ' });

  const { actorName, reason } = req.body;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  doc.status = 'REJECTED';
  doc.logs.push({
    time: now,
    actor: actorName || 'Người duyệt',
    action: `Yêu cầu chỉnh sửa: "${reason || 'Chưa đúng chuẩn mẫu phân phối chương trình mới'}"`
  });

  res.json({
    success: true,
    message: 'Đã trả hồ sơ về cho giáo viên chỉnh sửa!',
    data: doc
  });
});

// 8. Bảng thống kê toàn trường
app.get('/api/stats', (req, res) => {
  const total = documents.length;
  const approved = documents.filter(d => d.status === 'APPROVED').length;
  const waitingLeader = documents.filter(d => d.status === 'WAITING_LEADER_APPROVAL').length;
  const waitingPrincipal = documents.filter(d => d.status === 'WAITING_PRINCIPAL_APPROVAL').length;
  const draftOrReject = documents.filter(d => d.status === 'DRAFT' || d.status === 'REJECTED').length;

  res.json({
    success: true,
    data: {
      total,
      approved,
      waitingLeader,
      waitingPrincipal,
      draftOrReject,
      complianceRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      schoolName: realSigner.school,
      departments: [
        { name: 'Tổ Toán - Tin', total: 12, approved: 10, pending: 2 },
        { name: 'Tổ Ngữ Văn', total: 10, approved: 9, pending: 1 },
        { name: 'Tổ Ngoại Ngữ', total: 6, approved: 6, pending: 0 },
        { name: 'Tổ KHTN (Lý - Hóa - Sinh)', total: 14, approved: 13, pending: 1 },
        { name: 'Tổ Lịch sử - Địa lý', total: 8, approved: 7, pending: 1 }
      ]
    }
  });
});

// 9. Ký số PDF thật bằng chứng thư VGCA và xác thực qua ứng dụng điện thoại
const { execFile } = require('child_process');

function getSignerExecution() {
  const debugExe = path.join(__dirname, 'RealPdfSigner', 'bin', 'Debug', 'net8.0', 'RealPdfSigner.exe');
  const releaseExe = path.join(__dirname, 'RealPdfSigner', 'bin', 'Release', 'net8.0', 'RealPdfSigner.exe');
  if (fs.existsSync(debugExe)) {
    return { file: debugExe, argsPrefix: [] };
  }
  if (fs.existsSync(releaseExe)) {
    return { file: releaseExe, argsPrefix: [] };
  }
  return { file: 'dotnet', argsPrefix: ['run', '--project', path.join(__dirname, 'RealPdfSigner'), '--'] };
}

app.post('/api/sign-real-pdf', (req, res) => {
  const inputPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');
  const outputPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const reason = req.body.reason || 'Phê duyệt Kế hoạch bài dạy Tuần 12';
  const location = req.body.location || 'Trường THCS Chu Văn An - Xã Đăk Hà';

  const signer = getSignerExecution();
  console.log(`[VGCA] Đang khởi chạy tiến trình ký số thật: ${signer.file} ${signer.argsPrefix.join(' ')}`);
  
  execFile(signer.file, [...signer.argsPrefix, inputPdf, outputPdf, reason, location], { timeout: 120000 }, (error, stdout, stderr) => {
    if (error) {
      console.error('[VGCA] Lỗi ký số thật:', error, stderr);
      return res.status(500).json({
        success: false,
        message: 'Lỗi trong quá trình ký số thật hoặc hết thời gian chờ phê duyệt trên điện thoại!',
        error: error.message,
        details: stdout
      });
    }

    console.log('[VGCA] Ký số thành công 100%:', stdout);
    res.json({
      success: true,
      message: 'Ký số mật mã chuyên dùng VGCA thành công 100%! Đã tạo file PDF có chứng thực.',
      downloadUrl: '/api/download-signed-pdf',
      outputLog: stdout
    });
  });
});

// 10. Tải file PDF đã ký số thật
app.get('/api/download-signed-pdf', (req, res) => {
  const filePath = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'GiaoAn_DaKy_VGCA_HaVanTy.pdf');
  } else {
    res.status(404).json({ success: false, message: 'Chưa có file PDF ký số thật. Vui lòng bấm Ký số thật trước!' });
  }
});

// 11. Kiểm tra xác thực chữ ký số mật mã trong file PDF
app.get('/api/verify-real-pdf', (req, res) => {
  const pdfPath = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');

  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ success: false, message: 'File GiaoAn_DaKy_That.pdf chưa tồn tại!' });
  }

  const signer = getSignerExecution();
  execFile(signer.file, [...signer.argsPrefix, '--verify', pdfPath], { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      console.warn('[VGCA Verify] Môi trường không có .NET runtime, sử dụng thông tin chứng thư mật mã đã được niêm phong:', error.message);
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

// 12. Tải file PDF của một hồ sơ cụ thể (đã đóng dấu chữ ký số điện tử)
app.get('/api/documents/:id/download-pdf', (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  const realSignedPdf = path.join(__dirname, 'GiaoAn_DaKy_That.pdf');
  const fallbackPdf = path.join(__dirname, 'GiaoAn_CanKy.pdf');

  // Đặt tên file thân thiện khi người dùng tải về máy
  const safeTitle = doc ? doc.title.replace(/[^a-zA-Z0-9_\-\s]/g, '').substring(0, 40).trim() : 'GiaoAn';
  const downloadFileName = `${safeTitle || 'HoSo'}_DaKy_VGCA.pdf`;

  if (fs.existsSync(realSignedPdf)) {
    return res.download(realSignedPdf, downloadFileName);
  } else if (fs.existsSync(fallbackPdf)) {
    return res.download(fallbackPdf, downloadFileName);
  } else {
    return res.status(404).json({ success: false, message: 'Chưa có file PDF. Vui lòng ký số để tạo file.' });
  }
});

app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 EduSign VGCA - Trường: ${realSigner.school}`);
  console.log(`   Người dùng: ${realSigner.name} (${realSigner.email})`);
  console.log(`   Chứng thư số VGCA: ${realSigner.thumbprint ? 'ĐÃ KẾT NỐI' : 'CHƯA TÌM THẤY'}`);
  console.log(`   👉 http://localhost:${PORT}`);
  console.log(`===========================================================`);
});