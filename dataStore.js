const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DOCS_FILE = path.join(DATA_DIR, 'documents.json');
const DEPTS_FILE = path.join(DATA_DIR, 'departments.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Khởi tạo danh sách tổ chuyên môn mặc định nếu chưa có
function initDefaultDepts() {
  if (!fs.existsSync(DEPTS_FILE)) {
    const defaultDepts = [
      { id: 'dept_bgh', name: 'Ban Giám hiệu', code: 'BGH', description: 'Lãnh đạo và quản lý toàn diện các hoạt động nhà trường', leaderId: 'admin', createdAt: new Date().toISOString() },
      { id: 'dept_toan_tin', name: 'Tổ Toán - Tin', code: 'TOAN_TIN', description: 'Tổ chuyên môn Toán học và Tin học', leaderId: null, createdAt: new Date().toISOString() },
      { id: 'dept_ngu_van', name: 'Tổ Ngữ Văn', code: 'NGU_VAN', description: 'Tổ chuyên môn Ngữ văn và Nghệ thuật', leaderId: null, createdAt: new Date().toISOString() },
      { id: 'dept_ngoai_ngu', name: 'Tổ Ngoại Ngữ', code: 'NGOAI_NGU', description: 'Tổ chuyên môn Tiếng Anh', leaderId: null, createdAt: new Date().toISOString() },
      { id: 'dept_khtn', name: 'Tổ Khoa học Tự nhiên', code: 'KHTN', description: 'Tổ chuyên môn Vật lý, Hóa học, Sinh học', leaderId: null, createdAt: new Date().toISOString() },
      { id: 'dept_ls_dl', name: 'Tổ Lịch sử - Địa lý', code: 'LS_DL', description: 'Tổ chuyên môn Lịch sử, Địa lý, GDCD', leaderId: null, createdAt: new Date().toISOString() },
      { id: 'dept_gdtc_nt', name: 'Tổ Giáo dục Thể chất - Nghệ thuật', code: 'GDTC_NT', description: 'Tổ chuyên môn Thể dục, Âm nhạc, Mỹ thuật', leaderId: null, createdAt: new Date().toISOString() },
      { id: 'dept_van_phong', name: 'Văn phòng nhà trường', code: 'VAN_PHONG', description: 'Bộ phận hành chính, kế toán, văn thư, y tế', leaderId: null, createdAt: new Date().toISOString() }
    ];
    fs.writeFileSync(DEPTS_FILE, JSON.stringify(defaultDepts, null, 2), 'utf8');
  }
}

// Khởi tạo danh sách đăng ký thông báo Web Push
function initDefaultSubscriptions() {
  if (!fs.existsSync(SUBS_FILE)) {
    fs.writeFileSync(SUBS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

// Khởi tạo tài khoản Admin mặc định nếu chưa có
function initDefaultUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [
      {
        id: 'admin',
        username: 'admin',
        password: 'admin@123',
        name: 'Ban Giám hiệu - Quản trị viên',
        role: 'ADMIN',
        roleTitle: 'Quản trị viên nhà trường',
        department: 'Ban Giám hiệu',
        departmentId: 'dept_bgh',
        signType: 'USB_TOKEN',
        status: 'ACTIVE',
        email: 'bgh-dakha@quangngai.gov.vn',
        officialEmail: 'bgh-dakha@quangngai.gov.vn',
        cccd: '025E056A3F133DA9',
        certSerial: '025E056A3F133DA9',
        school: 'TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN',
        phone: '0255.385.0001',
        createdAt: new Date().toISOString()
      }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
  }
}

// Khởi tạo danh sách tài liệu trống
function initDefaultDocs() {
  if (!fs.existsSync(DOCS_FILE)) {
    fs.writeFileSync(DOCS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

initDefaultDepts();
initDefaultSubscriptions();
initDefaultUsers();
initDefaultDocs();

const DEPARTMENTS = [
  'Tổ Toán - Tin',
  'Tổ Ngữ Văn',
  'Tổ Ngoại Ngữ',
  'Tổ Khoa học Tự nhiên',
  'Tổ Lịch sử - Địa lý',
  'Tổ Giáo dục Thể chất - Nghệ thuật',
  'Văn phòng nhà trường',
  'Ban Giám hiệu'
];

function readJsonSafe(filePath, defaultVal = []) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    let data = fs.readFileSync(filePath, 'utf8');
    if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
    return JSON.parse(data.trim());
  } catch {
    return defaultVal;
  }
}

// Đọc danh sách người dùng
function getUsers() {
  return readJsonSafe(USERS_FILE, []);
}

function saveJsonSafe(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, filePath);
      return;
    } catch (err) {
      try {
        fs.writeFileSync(filePath, content, 'utf8');
        return;
      } catch (err2) {
        if (attempt === 11) throw err2;
        const start = Date.now();
        while (Date.now() - start < 100) {}
      }
    }
  }
}

function saveUsers(users) {
  saveJsonSafe(USERS_FILE, users);
}

function getUserById(id) {
  return getUsers().find(u => u.id === id);
}

function getUserByUsername(username) {
  if (!username) return null;
  return getUsers().find(u => u.username.toLowerCase() === username.toLowerCase().trim());
}

// =================== QUẢN LÝ TỔ CHUYÊN MÔN (DEPARTMENTS) ===================
function getDepartments() {
  return readJsonSafe(DEPTS_FILE, []);
}

function saveDepartments(depts) {
  saveJsonSafe(DEPTS_FILE, depts);
}

function getDepartmentById(id) {
  return getDepartments().find(d => d.id === id);
}

function createDepartment(deptData) {
  const depts = getDepartments();
  const name = (deptData.name || '').trim();
  if (!name) throw new Error('Tên tổ chuyên môn không được để trống!');
  if (depts.some(d => d.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Tổ chuyên môn "${name}" đã tồn tại!`);
  }
  const id = 'dept_' + (deptData.code ? deptData.code.toLowerCase().replace(/[^a-z0-9_]/g, '_') : crypto.randomBytes(3).toString('hex'));
  const newDept = {
    id,
    name,
    code: deptData.code ? deptData.code.trim().toUpperCase() : name.toUpperCase().slice(0, 8),
    description: deptData.description ? deptData.description.trim() : '',
    leaderId: deptData.leaderId || null,
    createdAt: new Date().toISOString()
  };
  depts.push(newDept);
  saveDepartments(depts);
  return newDept;
}

function updateDepartment(id, updates) {
  const depts = getDepartments();
  const index = depts.findIndex(d => d.id === id);
  if (index === -1) throw new Error('Không tìm thấy tổ chuyên môn!');
  if (updates.name) depts[index].name = updates.name.trim();
  if (updates.code) depts[index].code = updates.code.trim().toUpperCase();
  if (updates.description !== undefined) depts[index].description = updates.description.trim();
  if (updates.leaderId !== undefined) depts[index].leaderId = updates.leaderId;
  saveDepartments(depts);
  return depts[index];
}

function deleteDepartment(id) {
  if (id === 'dept_bgh') throw new Error('Không thể xóa Ban Giám hiệu!');
  let depts = getDepartments();
  depts = depts.filter(d => d.id !== id);
  saveDepartments(depts);
  return true;
}

// =================== QUẢN LÝ THÔNG BÁO WEB PUSH (PWA) ===================
function getSubscriptions() {
  return readJsonSafe(SUBS_FILE, []);
}

function saveSubscriptions(subs) {
  saveJsonSafe(SUBS_FILE, subs);
}

function saveSubscription(userId, subscription) {
  if (!subscription || !subscription.endpoint) return;
  const subs = getSubscriptions();
  const existingIdx = subs.findIndex(s => s.endpoint === subscription.endpoint);
  if (existingIdx !== -1) {
    subs[existingIdx].userId = userId;
    subs[existingIdx].updatedAt = new Date().toISOString();
  } else {
    subs.push({
      userId,
      subscription,
      endpoint: subscription.endpoint,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  saveSubscriptions(subs);
}

function getSubscriptionsForUser(userId) {
  return getSubscriptions().filter(s => s.userId === userId).map(s => s.subscription);
}

// =================== QUẢN LÝ TÀI KHOẢN GIÁO VIÊN & BGH ===================
function createUser(userData) {
  const users = getUsers();
  const username = userData.username.trim().toLowerCase();
  
  if (users.some(u => u.username.toLowerCase() === username)) {
    throw new Error(`Tên đăng nhập "${username}" đã tồn tại trên hệ thống!`);
  }

  const roleTitleMap = {
    'ADMIN': 'Quản trị viên hệ thống',
    'BGH': 'Ban Giám hiệu nhà trường',
    'HEAD_DEPT': `Tổ trưởng ${userData.department || ''}`,
    'TEACHER': `Giáo viên ${userData.department || ''}`
  };

  const newUser = {
    id: 'user_' + crypto.randomBytes(4).toString('hex'),
    username: username,
    password: userData.password || '123456',
    name: userData.name ? userData.name.trim() : username,
    role: userData.role || 'TEACHER', // ADMIN, BGH, HEAD_DEPT, TEACHER
    roleTitle: roleTitleMap[userData.role] || 'Giáo viên',
    department: userData.department || 'Tổ Toán - Tin',
    departmentId: userData.departmentId || null,
    signType: userData.signType || (userData.role === 'BGH' || userData.role === 'ADMIN' ? 'USB_TOKEN' : 'VGCA'), // VGCA, USB_TOKEN
    status: userData.status || 'ACTIVE', // ACTIVE, LOCKED
    email: userData.email ? userData.email.trim() : `${username}@thcschuvanan.edu.vn`,
    officialEmail: userData.officialEmail ? userData.officialEmail.trim() : (userData.email ? userData.email.trim() : ''),
    cccd: userData.cccd ? userData.cccd.trim() : '',
    certSerial: userData.certSerial ? userData.certSerial.trim() : '',
    school: 'TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN',
    phone: userData.phone ? userData.phone.trim() : '',
    signatureImage: null,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);
  return newUser;
}

function updateUser(id, updates) {
  const users = getUsers();
  const index = users.findIndex(u => u.id === id);
  if (index === -1) throw new Error('Không tìm thấy người dùng!');

  // Không cho đổi id hoặc hạ quyền/khóa admin gốc
  if (users[index].id === 'admin') {
    if (updates.role && updates.role !== 'ADMIN') {
      throw new Error('Không thể hạ quyền của tài khoản Quản trị viên gốc!');
    }
    if (updates.status && updates.status === 'LOCKED') {
      throw new Error('Không thể khóa tài khoản Quản trị viên gốc!');
    }
  }

  const roleTitleMap = {
    'ADMIN': 'Quản trị viên hệ thống',
    'BGH': 'Ban Giám hiệu nhà trường',
    'HEAD_DEPT': `Tổ trưởng ${updates.department || users[index].department || ''}`,
    'TEACHER': `Giáo viên ${updates.department || users[index].department || ''}`
  };

  if (updates.name) users[index].name = updates.name.trim();
  if (updates.role) {
    users[index].role = updates.role;
    users[index].roleTitle = roleTitleMap[updates.role];
  }
  if (updates.department) {
    users[index].department = updates.department;
    if (users[index].role === 'HEAD_DEPT' || users[index].role === 'TEACHER') {
      users[index].roleTitle = roleTitleMap[users[index].role];
    }
  }
  if (updates.departmentId !== undefined) users[index].departmentId = updates.departmentId;
  if (updates.signType !== undefined) users[index].signType = updates.signType;
  if (updates.status !== undefined) users[index].status = updates.status;
  if (updates.email) users[index].email = updates.email.trim();
  if (updates.officialEmail !== undefined) users[index].officialEmail = updates.officialEmail.trim();
  if (updates.cccd !== undefined) users[index].cccd = updates.cccd.trim();
  if (updates.certSerial !== undefined) users[index].certSerial = updates.certSerial.trim();
  if (updates.phone !== undefined) users[index].phone = updates.phone.trim();
  if (updates.signatureImage !== undefined) users[index].signatureImage = updates.signatureImage;
  if (updates.vgcaAuth !== undefined) users[index].vgcaAuth = updates.vgcaAuth;

  saveUsers(users);
  return users[index];
}

function toggleUserLock(id) {
  if (id === 'admin') throw new Error('Không thể khóa tài khoản Quản trị viên gốc!');
  const users = getUsers();
  const user = users.find(u => u.id === id);
  if (!user) throw new Error('Không tìm thấy người dùng!');
  user.status = (user.status === 'LOCKED') ? 'ACTIVE' : 'LOCKED';
  saveUsers(users);
  return user;
}

function resetPassword(id, newPassword) {
  const users = getUsers();
  const user = users.find(u => u.id === id);
  if (!user) throw new Error('Không tìm thấy người dùng!');
  user.password = newPassword || '123456';
  saveUsers(users);
  return true;
}

function deleteUser(id) {
  if (id === 'admin') throw new Error('Không thể xóa tài khoản Quản trị viên gốc!');
  let users = getUsers();
  users = users.filter(u => u.id !== id);
  saveUsers(users);
  return true;
}

function getSigners() {
  return getUsers()
    .filter(u => u.status !== 'LOCKED')
    .map(u => ({
      id: u.id,
      name: u.name,
      role: u.role,
      roleTitle: u.roleTitle,
      department: u.department,
      email: u.email
    }));
}

// =================== QUẢN LÝ HỒ SƠ GIÁO ÁN ===================
function getDocuments() {
  return readJsonSafe(DOCS_FILE, []);
}

function saveDocuments(docs) {
  saveJsonSafe(DOCS_FILE, docs);
}

function getDocumentById(id) {
  return getDocuments().find(d => d.id === id);
}

function normalizeFilePath(p) {
  if (!p || typeof p !== 'string') return null;
  const match = p.match(/[\\\/](uploads[\\\/].+)$/i);
  if (match) {
    return match[1].replace(/\\/g, '/');
  }
  if (p.startsWith('uploads/') || p.startsWith('uploads\\')) {
    return p.replace(/\\/g, '/');
  }
  return p;
}

function resolveFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  // 1. Nếu đường dẫn trực tiếp tồn tại trên hệ thống hiện tại
  if (fs.existsSync(filePath)) return path.resolve(filePath);
  // 2. Nếu là đường dẫn tương đối hoặc chứa 'uploads/'
  const match = filePath.match(/[\\\/]?(uploads[\\\/].+)$/i);
  if (match) {
    const rel = match[1].replace(/\\/g, '/');
    const local = path.join(__dirname, rel);
    if (fs.existsSync(local)) return local;
  }
  // 3. Tìm theo tên tệp trong thư mục uploads/documents
  const basename = path.basename(filePath);
  const inUploads = path.join(__dirname, 'uploads', 'documents', basename);
  if (fs.existsSync(inUploads)) return inUploads;
  return null;
}

function createDocument(docData, currentUser) {
  const docs = getDocuments();
  const newId = 'KHBD-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-6);

  const category = docData.category || 'PERSONAL';
  const isPersonal = (category === 'PERSONAL');
  const defaultStatus = docData.status || (isPersonal ? 'COMPLETED' : (docData.nextSignerId ? 'WAITING_SIGNER_APPROVAL' : 'WAITING_LEADER_APPROVAL'));
  const currentSignerRole = isPersonal ? null : (docData.nextSignerRole || 'Tổ trưởng Chuyên môn');

  const newDoc = {
    id: newId,
    title: docData.title,
    category: category,
    author: currentUser.name,
    authorId: currentUser.id,
    authorUsername: currentUser.username,
    department: currentUser.department || docData.department || 'Tổ Toán - Tin',
    grade: docData.grade || 'Khối 9',
    week: docData.week || 'Tuần 1',
    term: docData.term || 'Học kỳ I',
    createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    status: defaultStatus,
    currentSignerRole: currentSignerRole,
    nextSignerId: docData.nextSignerId || null,
    nextSignerName: docData.nextSignerName || null,
    nextSignerRole: docData.nextSignerRole || null,
    isArchived: docData.isArchived || false,
    fileName: docData.fileName || 'GiaoAn_Chuan.pdf',
    fileType: docData.fileType || 'pdf', // 'pdf', 'docx', 'doc'
    filePath: normalizeFilePath(docData.filePath),
    fileBase64: null,
    customContentHtml: docData.customContentHtml || null,
    realSignedPath: normalizeFilePath(docData.realSignedPath),
    signedPdfBase64: null,
    signPlacement: docData.signPlacement || 'bottom-right',
    fileSize: docData.fileSize || '1.5 MB',
    pages: docData.pages || 10,
    signType: docData.signType || 'STANDARD',
    isCopySign: docData.isCopySign || (docData.signType === 'COPY'),
    copyType: docData.copyType || null,
    copyText: docData.copyText || null,
    copySignBannerBase64: docData.copySignBannerBase64 || null,
    copySignBannerWidthPt: docData.copySignBannerWidthPt || null,
    copySignBannerHeightPt: docData.copySignBannerHeightPt || null,
    signatures: docData.signatures || [],
    driveInfo: null,
    logs: [
      {
        time: new Date().toISOString().replace('T', ' ').substring(0, 19),
        actor: currentUser.name,
        action: `Khởi tạo và nộp hồ sơ "${docData.title}" (${category === 'PERSONAL' ? 'Giáo án cá nhân' : 'Báo cáo liên cấp'})`
      }
    ]
  };

  docs.unshift(newDoc);
  saveDocuments(docs);
  syncDocToFirebase(newDoc);
  return newDoc;
}

const FIREBASE_RTDB_URL = 'https://edusign-school-default-rtdb.asia-southeast1.firebasedatabase.app';

function syncDocToFirebase(doc) {
  if (!doc || !doc.id) return;
  try {
    const cleanDoc = { ...doc };
    delete cleanDoc.fileBase64;
    delete cleanDoc.signedPdfBase64;
    fetch(`${FIREBASE_RTDB_URL}/documents/${doc.id}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanDoc)
    }).catch(() => {});
  } catch (e) {}
}

function updateDocument(id, updates) {
  const docs = getDocuments();
  const index = docs.findIndex(d => d.id === id);
  if (index === -1) throw new Error('Không tìm thấy hồ sơ!');

  const cleanUpdates = { ...updates };
  delete cleanUpdates.fileBase64;
  delete cleanUpdates.signedPdfBase64;
  if (cleanUpdates.filePath) cleanUpdates.filePath = normalizeFilePath(cleanUpdates.filePath);
  if (cleanUpdates.realSignedPath) cleanUpdates.realSignedPath = normalizeFilePath(cleanUpdates.realSignedPath);

  Object.assign(docs[index], cleanUpdates);
  saveDocuments(docs);
  syncDocToFirebase(docs[index]);
  return docs[index];
}

function archiveDocument(id, driveInfo = null) {
  const docs = getDocuments();
  const index = docs.findIndex(d => d.id === id);
  if (index === -1) throw new Error('Không tìm thấy hồ sơ để lưu trữ!');

  const doc = docs[index];
  doc.isArchived = true;
  doc.status = 'ARCHIVED';
  doc.archivedAt = new Date().toISOString();
  if (driveInfo) doc.driveInfo = driveInfo;

  saveDocuments(docs);
  syncDocToFirebase(doc);
  return doc;
}

function deleteDocument(id) {
  let docs = getDocuments();
  docs = docs.filter(d => d.id !== id);
  saveDocuments(docs);
  try {
    fetch(`${FIREBASE_RTDB_URL}/documents/${id}.json`, { method: 'DELETE' }).catch(() => {});
  } catch (e) {}
  return true;
}

const BGH_CONFIG_FILE = path.join(DATA_DIR, 'bgh_signing_config.json');

function getBghSigningConfig() {
  try {
    if (fs.existsSync(BGH_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(BGH_CONFIG_FILE, 'utf8'));
    }
  } catch (err) {}
  return {
    signType: 'USB_TOKEN', // 'USB_TOKEN' hoặc 'SMART_CA'
    serialNumber: '025E056A3F133DA9', // USB Token Ban Giám hiệu (Cô Ngô Thị Liền)
    certOwner: 'Ngô Thị Liền',
    school: 'TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN',
    updatedAt: new Date().toISOString()
  };
}

function saveBghSigningConfig(config) {
  const current = getBghSigningConfig();
  const updated = {
    ...current,
    ...config,
    updatedAt: new Date().toISOString()
  };
  saveJsonSafe(BGH_CONFIG_FILE, updated);
  return updated;
}

module.exports = {
  DEPARTMENTS,
  getUsers,
  saveUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  toggleUserLock,
  getSigners,
  resetPassword,
  deleteUser,
  getDepartments,
  saveDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getSubscriptions,
  saveSubscriptions,
  saveSubscription,
  getSubscriptionsForUser,
  getDocuments,
  saveDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  archiveDocument,
  normalizeFilePath,
  resolveFilePath,
  getBghSigningConfig,
  saveBghSigningConfig
};
