const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'onedrive_config.json');

/**
 * Tự động dò tìm thư mục OneDrive của Sở GD&ĐT Quảng Ngãi & Trường THCS Chu Văn An trên máy tính
 */
function findOneDriveSharedFolder() {
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\HPZBook';
  
  // 1. Kiểm tra chính xác thư mục chia sẻ năm học 2026-2027 của Thầy Hà Văn Tý
  const exactCandidates = [
    path.join(userProfile, 'OneDrive - Sở GD&ĐT Quảng Ngãi', "Trường THCS Chu Văn An (Đăk Hà)'s files - 15. HÀ VĂN TÝ 26-27"),
    path.join(userProfile, 'OneDrive - Sở GD&ĐT Quảng Ngãi', "Trường THCS Chu Văn An (Đăk Hà)'s files - 12. HÀ VĂN TÝ"),
    path.join(userProfile, 'OneDrive - Sở GD&ĐT Quảng Ngãi')
  ];

  for (const cand of exactCandidates) {
    if (fs.existsSync(cand)) return cand;
  }

  // 2. Quét động các thư mục OneDrive khác trong User Profile
  try {
    const userDirs = fs.readdirSync(userProfile);
    for (const d of userDirs) {
      if (d.toLowerCase().includes('onedrive')) {
        const full = path.join(userProfile, d);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
          try {
            const subDirs = fs.readdirSync(full);
            for (const sub of subDirs) {
              if (sub.includes('Chu Văn An') || sub.includes('HÀ VĂN TÝ')) {
                return path.join(full, sub);
              }
            }
          } catch (e) {}
          return full;
        }
      }
    }
  } catch (e) {}

  return null;
}

function getOneDriveConfig() {
  const detectedRoot = findOneDriveSharedFolder();
  let cfg = {
    enabled: true,
    autoSyncOnSign: true,
    storageQuota: '5 TB',
    schoolName: 'Trường THCS Chu Văn An (Đăk Hà)',
    department: 'Sở GD&ĐT Quảng Ngãi',
    teacherName: 'Hà Văn Tý',
    academicYear: '2026 - 2027',
    oneDriveFolderPath: detectedRoot || '',
    detected: !!detectedRoot
  };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg = { ...cfg, ...saved };
      if (!cfg.oneDriveFolderPath && detectedRoot) {
        cfg.oneDriveFolderPath = detectedRoot;
        cfg.detected = true;
      }
    } catch (e) {}
  }

  return cfg;
}

function saveOneDriveConfig(newCfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newCfg, null, 2), 'utf8');
}

/**
 * Phân loại thư mục lưu trữ theo chuyên môn
 */
function resolveSubCategory(doc) {
  const t = (doc.title || '').toLowerCase();
  const fn = (doc.fileName || '').toLowerCase();

  if (t.includes('giáo dục') || t.includes('phụ lục') || t.includes('khgd') || fn.includes('pl') || fn.includes('khgd')) {
    return '1. KẾ HOẠCH GIÁO DỤC CÁ NHÂN';
  }
  if (t.includes('dự giờ') || fn.includes('du_gio')) {
    return '4. SỔ DỰ GIỜ';
  }
  if (t.includes('chủ nhiệm') || fn.includes('chu_nhiem')) {
    return '6. CÔNG TÁC CHỦ NHIỆM';
  }
  if (t.includes('chất lượng') || fn.includes('chat_luong')) {
    return '3. THEO DÕI CHẤT LƯỢNG DẠY HỌC';
  }

  return '2. KẾ HOẠCH BÀI DẠY';
}

/**
 * Tự động đồng bộ file PDF đã ký số vào thư mục OneDrive của trường
 */
async function syncDocumentToOneDrive(doc, pdfFilePath) {
  const cfg = getOneDriveConfig();
  const root = cfg.oneDriveFolderPath || findOneDriveSharedFolder();

  if (!root || !fs.existsSync(root)) {
    throw new Error('Chưa tìm thấy thư mục đồng bộ OneDrive trên máy tính. Thầy vui lòng kiểm tra ứng dụng OneDrive!');
  }

  if (!fs.existsSync(pdfFilePath)) {
    throw new Error('Tệp PDF ký số không tồn tại tại: ' + pdfFilePath);
  }

  const category = resolveSubCategory(doc);
  const targetDir = path.join(root, category);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const cleanTitle = (doc.title || 'GiaoAn')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .trim();
  const weekInfo = doc.week ? ('_' + doc.week.replace(/\s+/g, '_')) : '';
  const finalFileName = '[' + (doc.department || 'To_Toan_Tin') + ']' + weekInfo + '_' + cleanTitle + '_DaKySo.pdf';
  const destPath = path.join(targetDir, finalFileName);

  fs.copyFileSync(pdfFilePath, destPath);

  const stats = fs.statSync(destPath);
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  return {
    success: true,
    fileName: finalFileName,
    category: category,
    destinationPath: destPath,
    fileSize: stats.size,
    syncedAt: nowStr,
    oneDriveRoot: root,
    message: 'Đã nộp thành công vào OneDrive: ' + category + ' / ' + finalFileName
  };
}

module.exports = {
  getOneDriveConfig,
  saveOneDriveConfig,
  syncDocumentToOneDrive,
  findOneDriveSharedFolder,
  resolveSubCategory
};
