/**
 * =========================================================================
 * GOOGLE APPS SCRIPT: TỰ ĐỘNG NHẬN FILE PDF ĐÃ KÝ SỐ VÀ LƯU VÀO GOOGLE DRIVE
 * Trường THCS Chu Văn An - Xã Đăk Hà - Tỉnh Quảng Ngãi
 * =========================================================================
 * 
 * HƯỚNG DẪN CÀI ĐẶT TRÊN GOOGLE DRIVE NHÀ TRƯỜNG (CHỈ MẤT 2 PHÚT):
 * 1. Mở Google Drive của trường (hoặc tài khoản cá nhân).
 * 2. Bấm "Mới" (New) -> "Ứng dụng khác" -> "Google Apps Script" (script.google.com).
 * 3. Dán toàn bộ nội dung file này vào và bấm Lưu (Ctrl + S).
 * 4. Bấm nút "Triển khai" (Deploy) -> "Tùy chọn triển khai mới" (New deployment).
 * 5. Chọn loại: "Ứng dụng web" (Web app).
 *    - Thực thi dưới dạng: "Tôi" (Me)
 *    - Ai có quyền truy cập: "Bất kỳ ai" (Anyone).
 * 6. Bấm "Triển khai" -> Cấp quyền truy cập Google Drive.
 * 7. Sao chép URL ứng dụng web (có dạng https://script.google.com/macros/s/.../exec)
 *    và dán vào phần "Cấu hình Google Drive" trên phần mềm EduSign!
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    
    var fileName = data.fileName || ("GiaoAn_DaKy_" + new Date().getTime() + ".pdf");
    var folderPath = data.folderPath || "Năm học 2026 - 2027 / Hồ sơ số";
    var fileBytes = Utilities.base64Decode(data.fileBase64);
    var blob = Utilities.newBlob(fileBytes, "application/pdf", fileName);

    // Tìm hoặc tự động tạo cấu trúc cây thư mục trên Google Drive
    var targetFolder = getOrCreateFolderHierarchy(folderPath);

    // Tạo file PDF trên Google Drive
    var file = targetFolder.createFile(blob);
    file.setDescription("Hồ sơ số đã ký điện tử VGCA. Mã: " + (data.docId || "") + " - Giáo viên: " + (data.author || ""));

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      fileId: file.getId(),
      fileName: file.getName(),
      viewUrl: file.getUrl(),
      downloadUrl: file.getDownloadUrl(),
      folderPath: folderPath,
      message: "Đã lưu thành công vào Google Drive của trường!"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Hàm đệ quy tạo thư mục phân cấp theo Năm học / Học kỳ / Tổ bộ môn
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
