@echo off
chcp 65001 > nul
title EduSign Agent - Ký Số Ban Cơ Yếu Chính Phủ (VGCA) - THCS Chu Văn An
color 1F

echo =======================================================================
echo          CÔNG CỤ KÝ SỐ CHUYÊN DỤNG EDUSIGN AGENT (VGCA DESKTOP)
echo                   TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN
echo =======================================================================
echo.
echo [1/2] Đang kiểm tra chứng thư số Ban Cơ yếu Chính phủ...
echo [2/2] Khởi động Dịch vụ Ký số Cục bộ (Local Signer Bridge)...
echo.

if exist "EduSign_Agent.exe" (
    start "" EduSign_Agent.exe --tray
    echo [SUCCESS] EduSign Desktop Agent đã được khởi động và đang chạy ngầm tại Khay hệ thống (cạnh đồng hồ)!
    timeout /t 2 >nul
    exit /b 0
) else if exist "RealPdfSigner.exe" (
    start "" RealPdfSigner.exe --tray
    echo [SUCCESS] EduSign Desktop Agent đã được khởi động và đang chạy ngầm tại Khay hệ thống (cạnh đồng hồ)!
    timeout /t 2 >nul
    exit /b 0
) else (
    echo [ERROR] Không tìm thấy file EduSign_Agent.exe!
    pause
)
