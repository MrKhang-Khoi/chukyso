const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DOCS_FILE = path.join(DATA_DIR, 'documents.json');

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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
        email: 'bgh-dakha@quangngai.gov.vn',
        school: 'TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN',
        phone: '0255.385.0001',
        createdAt: new Date().toISOString()
      }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
  }
}

// Khởi tạo danh sách tài liệu trống (xóa sạch dữ liệu mẫu tạm)
function initDefaultDocs() {
  if (!fs.existsSync(DOCS_FILE)) {
    fs.writeFileSync(DOCS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

initDefaultUsers();
initDefaultDocs();

// Đọc danh sách người dùng
function getUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
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

function createUser(userData) {
  const users = getUsers();
  const username = userData.username.trim().toLowerCase();
  
  if (users.some(u => u.username.toLowerCase() === username)) {
    throw new Error(`Tên đăng nhập "${username}" đã tồn tại trên hệ thống!`);
  }

  const roleTitleMap = {
    'ADMIN': 'Quản trị viên / Ban Giám hiệu',
    'HEAD_DEPT': `Tổ trưởng ${userData.department || ''}`,
    'TEACHER': `Giáo viên ${userData.department || ''}`
  };

  const newUser = {
    id: 'user_' + crypto.randomBytes(4).toString('hex'),
    username: username,
    password: userData.password || '123456',
    name: userData.name ? userData.name.trim() : username,
    role: userData.role || 'TEACHER', // ADMIN, HEAD_DEPT, TEACHER
    roleTitle: roleTitleMap[userData.role] || 'Giáo viên',
    department: userData.department || 'Tổ Toán - Tin',
    email: userData.email ? userData.email.trim() : `${username}@thcschuvanan.edu.vn`,
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

  // Không cho đổi id hoặc username của admin gốc
  if (users[index].id === 'admin' && updates.role && updates.role !== 'ADMIN') {
    throw new Error('Không thể hạ quyền của tài khoản Quản trị viên gốc!');
  }

  const roleTitleMap = {
    'ADMIN': 'Quản trị viên / Ban Giám hiệu',
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
  if (updates.email) users[index].email = updates.email.trim();
  if (updates.phone !== undefined) users[index].phone = updates.phone.trim();
  if (updates.signatureImage !== undefined) users[index].signatureImage = updates.signatureImage;
  if (updates.vgcaAuth !== undefined) users[index].vgcaAuth = updates.vgcaAuth;

  saveUsers(users);
  return users[index];
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

// =================== QUẢN LÝ HỒ SƠ GIÁO ÁN ===================
function getDocuments() {
  try {
    const data = fs.readFileSync(DOCS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
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

  const newDoc = {
    id: newId,
    title: docData.title,
    author: currentUser.name,
    authorId: currentUser.id,
    authorUsername: currentUser.username,
    department: currentUser.department || docData.department || 'Tổ Toán - Tin',
    grade: docData.grade || 'Khối 9',
    week: docData.week || 'Tuần 1',
    term: docData.term || 'Học kỳ I',
    createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    status: 'WAITING_LEADER_APPROVAL', // WAITING_LEADER_APPROVAL -> WAITING_PRINCIPAL_APPROVAL -> APPROVED (hoặc REJECTED)
    currentSignerRole: 'Tổ trưởng Chuyên môn',
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
        action: `Khởi tạo và nộp kế hoạch bài dạy "${docData.title}" (File: ${docData.fileName || 'GiaoAn.pdf'})`
      }
    ]
  };

  docs.unshift(newDoc);
  saveDocuments(docs);
  return newDoc;
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
  return docs[index];
}

function deleteDocument(id) {
  let docs = getDocuments();
  docs = docs.filter(d => d.id !== id);
  saveDocuments(docs);
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
  resetPassword,
  deleteUser,
  getDocuments,
  saveDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  normalizeFilePath,
  resolveFilePath,
  getBghSigningConfig,
  saveBghSigningConfig
};
