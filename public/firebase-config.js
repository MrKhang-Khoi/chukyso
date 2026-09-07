/**
 * CẤU HÌNH GOOGLE FIREBASE CHO HỆ THỐNG QUẢN LÝ KÝ SỐ HỒ SƠ GIÁO ÁN
 * 
 * Hướng dẫn lấy thông tin (Hoàn toàn miễn phí trên gói Spark của Google):
 * 1. Truy cập: https://console.firebase.google.com
 * 2. Bấm [Add Project] -> Nhập tên dự án (ví dụ: edusign-truong-2026) -> Bấm [Create Project]
 * 3. Bấm vào biểu tượng Web </> để tạo ứng dụng Web
 * 4. Sao chép các thông số bên dưới dán vào đây:
 */

window.FIREBASE_CONFIG = {
  // Đổi thành true khi Thầy/Cô đã điền các thông tin bên dưới:
  enabled: false,

  apiKey: "AIzaSy_YOUR_API_KEY_HERE",
  authDomain: "edusign-school.firebaseapp.com",
  projectId: "edusign-school",
  storageBucket: "edusign-school.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
