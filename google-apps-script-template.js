/**
 * =========================================================================
 * GOOGLE APPS SCRIPT: TỰ ĐỘNG LƯU TRỮ HỒ SƠ GIÁO ÁN ĐÃ KÝ SỐ VÀO GOOGLE DRIVE
 * Trường THCS Chu Văn An - Xã Đăk Hà - Tỉnh Quảng Ngãi
 * Phiên bản: Chuẩn phân cấp [Năm học] / [Họ và tên giáo viên] / [Tên_file_DaKy.pdf]
 * =========================================================================
 * 
 * HƯỚNG DẪN CẬP NHẬT TRÊN GOOGLE APPS SCRIPT (script.google.com):
 * 1. Mở file Code.gs trong dự án Google Apps Script của bạn (như trong ảnh bạn tải lên).
 * 2. Xóa toàn bộ nội dung cũ và dán toàn bộ đoạn mã này vào.
 * 3. Bấm biểu tượng "Lưu dự án" (Ctrl + S).
 * 4. Bấm "Triển khai" (Deploy) -> "Quản lý bản triển khai" (Manage deployments).
 * 5. Bấm biểu tượng cây bút (Chỉnh sửa) -> Tại mục "Phiên bản", chọn "Phiên bản mới" (New version).
 * 6. Bấm "Triển khai" để cập nhật phiên bản mới nhất.
 */

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "active",
    school: "TRƯỜNG THCS CHU VĂN AN",
    system: "EduSign Google Drive Storage Webhook",
    timestamp: new Date().toISOString(),
    message: "Webhook Google Drive đang hoạt động sẵn sàng nhận file ký số!"
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Không nhận được dữ liệu tải lên từ phần mềm!");
    }

    var data = JSON.parse(e.postData.contents);
    
    var fileName = data.fileName || ("GiaoAn_DaKy_" + new Date().getTime() + ".pdf");
    var folderPath = data.folderPath || ("Năm học 2026 - 2027 / " + (data.author || "Giáo viên"));
    
    if (!data.fileBase64) {
      throw new Error("Thiếu nội dung file base64!");
    }

    var fileBytes = Utilities.base64Decode(data.fileBase64);
    var blob = Utilities.newBlob(fileBytes, "application/pdf", fileName);

    // 1. Tự động tạo và lấy thư mục phân cấp: [Năm học] / [Tên giáo viên]
    var targetFolder = getOrCreateFolderHierarchy(folderPath);

    // 2. Tạo file PDF đã ký số vào đúng thư mục của giáo viên
    var file = targetFolder.createFile(blob);
    file.setDescription(
      "Hồ sơ giáo án điện tử đã ký số chuẩn VGCA.\n" +
      "• Mã hồ sơ: " + (data.docId || "N/A") + "\n" +
      "• Tiêu đề: " + (data.docTitle || fileName) + "\n" +
      "• Người ký / Tác giả: " + (data.author || "N/A") + "\n" +
      "• Tổ chuyên môn: " + (data.department || "N/A") + "\n" +
      "• Thời gian lưu trữ: " + new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    );

    // 3. Cấp quyền xem công khai qua liên kết (bất kỳ ai trong trường có link đều xem được file PDF)
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      console.warn("Không thể set sharing công khai:", shareErr);
    }

    // 4. Trả về kết quả thành công cho EduSign
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      fileId: file.getId(),
      fileName: file.getName(),
      viewUrl: file.getUrl(),
      downloadUrl: file.getDownloadUrl(),
      folderPath: folderPath,
      folderId: targetFolder.getId(),
      uploadedAt: new Date().toISOString(),
      message: "Đã lưu thành công vào thư mục: " + folderPath
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString(),
      message: "Lỗi lưu file trên Google Drive: " + error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Hàm phân cấp thư mục tự động theo chuỗi đường dẫn (VD: 'Năm học 2026 - 2027 / Hà Văn Tý')
 * - Nếu thư mục Năm học chưa có -> Tự động tạo.
 * - Nếu thư mục Tên giáo viên chưa có bên trong Năm học -> Tự động tạo.
 * - Trả về thư mục con cuối cùng để lưu file.
 */
function getOrCreateFolderHierarchy(pathStr) {
  var parts = pathStr.split("/").map(function(s) { return s.trim(); }).filter(Boolean);
  var currentFolder = DriveApp.getRootFolder();

  for (var i = 0; i < parts.length; i++) {
    var name = parts[i];
    var folders = currentFolder.getFoldersByName(name);
    if (folders.hasNext()) {
      currentFolder = folders.next();
    } else {
      currentFolder = currentFolder.createFolder(name);
    }
  }
  return currentFolder;
}
