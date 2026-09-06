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
    EduSign_Agent.exe --agent
) else if exist "RealPdfSigner.exe" (
    RealPdfSigner.exe --agent
) else (
    echo [ERROR] Khong tim thay file EduSign_Agent.exe!
    pause
)
