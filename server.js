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
    const psCommand = `powershell -NoProfile -Command "$certs = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -match 'CN=' } | ForEach-Object { [PSCustomObject]@{ Subject = $_.Subject; Issuer = $_.Issuer; NotAfter = $_.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'); HasPrivateKey = $_.HasPrivateKey; Thumbprint = $_.Thumbprint } }; $certs | ConvertTo-Json -Depth 3"`;
    const output = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });
    const parsed = JSON.parse(output);
    const certList = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);

    // Tìm chứng thư của Ban Cơ yếu Chính phủ (VGCA / CA chuyên dùng công vụ)
    const vgcaCert = certList.find(c => 
      (c.Issuer && c.Issuer.includes('Ban Co y') || c.Issuer.includes('VGCA') || c.Issuer.includes('Nhà nước')) ||
      (c.Subject && (c.Subject.includes('gov.vn') || c.Subject.includes('TRUONG') || c.Subject.includes('UBND')))
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
  school: 'Trường THCS Chu Văn An',
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
  
  if (cnMatch) realSigner.name = cnMatch[1].trim();
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
  }
];

// Danh sách các vai trò dùng thử
const getRoleUser = (roleCode) => {
  if (roleCode === 'TEACHER') {
    return {
      name: realSigner.name,
      role: 'Giáo viên',
      unit: realSigner.school,
      email: realSigner.email,
      certSerial: realSigner.thumbprint,
      issuer: realSigner.issuer,
      isRealCert: true
    };
  } else if (roleCode === 'LEADER') {
    return {
      name: 'Trần Văn Nam',
      role: 'Tổ trưởng Chuyên môn',
      unit: `Tổ Toán - Tin (${realSigner.school})`,
      email: 'tvnam@quangngai.gov.vn',
      certSerial: '54:02:88:AC:77:22:55',
      issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ',
      isRealCert: false
    };
  } else {
    return {
      name: 'Nguyễn Văn Hùng',
      role: 'Hiệu trưởng',
      unit: realSigner.school,
      email: 'nvhung-bgh@quangngai.gov.vn',
      certSerial: '54:02:88:AA:99:88:77',
      issuer: 'CA phục vụ các cơ quan Nhà nước G2 - Ban Cơ yếu Chính phủ',
      isRealCert: false
    };
  }
};

// ==================== REST API ENDPOINTS ==================== //

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

// 3. Danh sách hồ sơ
app.get('/api/documents', (req, res) => {
  res.json({ success: true, data: documents });
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

    return res.json({
      success: true,
      message: 'Hiệu trưởng phê duyệt thành công! Hồ sơ đã hoàn tất 3 cấp và lưu kho số vĩnh viễn.',
      data: doc
    });
  }

  res.status(400).json({ success: false, message: 'Vai trò người ký không hợp lệ!' });
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

app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 EduSign VGCA - Trường: ${realSigner.school}`);
  console.log(`   Người dùng: ${realSigner.name} (${realSigner.email})`);
  console.log(`   Chứng thư số VGCA: ${realSigner.thumbprint ? 'ĐÃ KẾT NỐI' : 'CHƯA TÌM THẤY'}`);
  console.log(`   👉 http://localhost:${PORT}`);
  console.log(`===========================================================`);
});