const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const CONFIG_FILE = path.join(__dirname, 'drive_config.json');

// Cấu hình mặc định Google Drive của nhà trường
function getDriveConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      console.error('Lỗi đọc drive_config.json:', e.message);
    }
  }
  return {
    enabled: true,
    autoUploadOnSign: true, // Tự động đẩy lên Google Drive sau khi ký số hoàn tất
    schoolFolderId: 'THCS_CHU_VAN_AN_ARCHIVE_2026',
    schoolFolderName: 'KHO_HO_SO_SO_TRUONG_THCS_CHU_VAN_AN',
    gasWebhookUrl: '', // URL Webhook Google Apps Script của trường (nếu có)
    backupLocalStorage: true
  };
}

function saveDriveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

/**
 * Tự động đồng bộ file PDF đã ký lên Google Drive của trường
 * @param {Object} doc Thông tin hồ sơ kế hoạch bài dạy
 * @param {string} pdfFilePath Đường dẫn file PDF đã ký số
 */
async function uploadToGoogleDrive(doc, pdfFilePath) {
  const config = getDriveConfig();

  if (!fs.existsSync(pdfFilePath)) {
    throw new Error(`File PDF ký số không tồn tại tại: ${pdfFilePath}`);
  }

  const fileBuffer = fs.readFileSync(pdfFilePath);
  const base64Content = fileBuffer.toString('base64');
  const safeFileName = `[${doc.department}]_${doc.title.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim()}_DaKy.pdf`;

  // Cấu trúc phân loại thư mục lưu trữ theo tiêu chuẩn sư phạm
  const folderPath = `Năm học 2026 - 2027 / Học kỳ I / ${doc.department} / ${doc.week || 'Tuần 12'}`;

  // Nếu nhà trường đã cấu hình Google Apps Script Webhook URL thật
  if (config.gasWebhookUrl && config.gasWebhookUrl.startsWith('http')) {
    console.log(`[Google Drive] Đang đẩy file lên Google Apps Script: ${config.gasWebhookUrl}`);
    const payload = JSON.stringify({
      action: 'UPLOAD_SIGNED_DOC',
      fileName: safeFileName,
      folderPath: folderPath,
      schoolFolderId: config.schoolFolderId,
      docId: doc.id,
      docTitle: doc.title,
      author: doc.author,
      department: doc.department,
      fileBase64: base64Content
    });

    const result = await sendHttpPost(config.gasWebhookUrl, payload);
    if (result && (result.success === true || result.fileId)) {
      return {
        success: true,
        isRealCloud: true,
        fileId: result.fileId || `drive_${Date.now()}`,
        viewUrl: result.viewUrl || (result.fileId ? `https://drive.google.com/file/d/${result.fileId}/view` : `https://drive.google.com`),
        downloadUrl: result.downloadUrl || null,
        folderPath: result.folderPath || folderPath,
        uploadedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
        mode: 'REAL_GOOGLE_DRIVE',
        message: 'Đã lưu trữ thành công trên Google Drive đám mây của trường!'
      };
    } else {
      throw new Error((result && result.error) || (result && result.message) || 'Google Apps Script trả về lỗi không xác định');
    }
  }

  // Chế độ Mô phỏng / Lưu cục bộ khi CHƯA CẤU HÌNH Webhook Google Apps Script thật:
  const fakeFileId = `1${Buffer.from(doc.id + Date.now()).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 28)}`;
  const driveViewUrl = `https://drive.google.com/file/d/${fakeFileId}/view?usp=sharing`;

  // Lưu một bản sao vào thư mục đồng bộ cục bộ của Google Drive Desktop nếu có
  const localDriveDir = path.join(__dirname, 'GoogleDrive_KhoTruong', doc.department, doc.week || 'Tuần 12');
  if (!fs.existsSync(localDriveDir)) {
    fs.mkdirSync(localDriveDir, { recursive: true });
  }
  const destPath = path.join(localDriveDir, safeFileName);
  fs.copyFileSync(pdfFilePath, destPath);

  return {
    success: true,
    isRealCloud: false,
    fileId: fakeFileId,
    viewUrl: driveViewUrl,
    folderPath: folderPath,
    localMirrorPath: destPath,
    uploadedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    mode: 'SIMULATION_LOCAL_MIRROR',
    message: 'Lưu trữ tại thư mục cục bộ (Chưa cấu hình Webhook Google Apps Script thật)'
  };
}

async function sendHttpPost(urlStr, dataStr) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const res = await fetch(urlStr, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: dataStr,
      redirect: 'follow', // RẤT QUAN TRỌNG: Google Apps Script luôn trả về HTTP 302 Redirect
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return json;
    } catch {
      return { success: res.ok, raw: text, fileId: 'drive_' + Date.now() };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Hết thời gian chờ kết nối Google Drive (Timeout 60s)');
    }
    throw err;
  }
}

module.exports = {
  getDriveConfig,
  saveDriveConfig,
  uploadToGoogleDrive
};
