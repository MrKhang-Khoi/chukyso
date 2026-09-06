@echo off
chcp 65001 >nul
title Cai dat EduSign Desktop Agent - Ban Co yeu Chinh phu
echo ======================================================================
echo    CAI DAT CONG CU KY SO CHUYEN DUNG EDUSIGN AGENT (VGCA DESKTOP)
echo    Truong THCS Chu Van An - Tinh Quang Ngai (Chuan Windows 10 va 11)
echo ======================================================================
echo.
echo Dang tien hanh cai dat, tao bieu tuong Desktop va khoi chay ngam...

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Cai_Dat_EduSign.ps1"

echo.
echo ======================================================================
echo   [+] CAI DAT THANH CONG!
echo   [+] Da tao bieu tuong "EduSign Agent" ngoai man hinh Desktop.
echo   [+] Ung dung da chay ngam va san sang ky so qua USB Token.
echo ======================================================================
timeout /t 3 >nul
exit /b 0
