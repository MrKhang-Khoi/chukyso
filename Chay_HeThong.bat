@echo off
chcp 65001 > nul
title EduSign - Ký Số Ban Cơ Yếu Chính Phủ (VGCA) - THCS Chu Văn An
color 1F

echo =======================================================================
echo          HỆ THỐNG QUẢN LÝ VÀ KÝ SỐ GIÁO ÁN ĐIỆN TỬ (EDUSIGN VGCA)
echo                   TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN
echo =======================================================================
echo.
echo [1/3] Đang kiểm tra chứng thư số Ban Cơ yếu Chính phủ...
echo [2/3] Khởi động Dịch vụ Ký số Cục bộ (Local Signer Bridge)...
echo [3/3] Sẵn sàng kết nối ứng dụng Web (Localhost và Render Cloud)...
echo.
echo -----------------------------------------------------------------------
echo  * Cổng hoạt động: http://localhost:3000
echo  * Trạng thái kết nối VGCA: Sẵn sàng gửi tín hiệu tới điện thoại
echo  * Vui lòng giữ cửa sổ này mở khi thực hiện ký số trên Render hoặc máy tính
echo -----------------------------------------------------------------------
echo.

node server.js
pause
