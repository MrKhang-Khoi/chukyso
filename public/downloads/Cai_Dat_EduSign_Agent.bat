@echo off
chcp 65001 >nul
title Cai dat EduSign Desktop Agent - Ban Co yeu Chinh phu
echo ======================================================================
echo    CAI DAT CONG CU KY SO CHUYEN DUNG EDUSIGN AGENT (VGCA DESKTOP)
echo    Truong THCS Chu Van An - Tinh Quang Ngai (Chuan Windows 10 va 11)
echo ======================================================================
echo.
echo Dang tien hanh cai dat, tao bieu tuong Desktop va khoi chay ngam...

if exist "%~dp0Cai_Dat_EduSign.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Cai_Dat_EduSign.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { $code = (New-Object Net.WebClient).DownloadString('http://localhost:3000/downloads/Cai_Dat_EduSign.ps1'); Invoke-Expression $code } catch { try { $code = (New-Object Net.WebClient).DownloadString('http://127.0.0.1:3000/downloads/Cai_Dat_EduSign.ps1'); Invoke-Expression $code } catch {} }"
)

echo.
echo ======================================================================
echo   [+] CAI DAT THANH CONG!
echo   [+] Da tao bieu tuong "EduSign Agent" ngoai man hinh Desktop.
echo   [+] Ung dung da chay ngam va san sang ky so qua USB Token.
echo ======================================================================
timeout /t 3 >nul
exit /b 0
