@echo off
chcp 65001 >nul
title EduSign VGCA - H? th?ng K? s? Tr?c tuy?n
echo ===============================================================
echo   H? TH?NG QU?N L? & TR?NH K? H? S? GI?O D?C ?I?N T? VGCA
echo   Tr??ng THCS Chu V?n An - X? ??k H? - T?nh Qu?ng Ng?i
echo ===============================================================
echo.
echo [1/2] ?ang kh?i ch?y m?y ch? EduSign tr?n m?y (Port 3000)...
start /b node server.js
timeout /t 2 >nul
echo.
echo [2/2] ?ang k?t n?i ???ng h?m tr?c tuy?n Cloudflare Tunnel...
echo      -> ???ng link HTTPS c?ng khai s? hi?n th? ngay b?n d??i:
echo ===============================================================
echo.
.\cloudflared.exe tunnel --url http://localhost:3000
pause
