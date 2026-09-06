$ErrorActionPreference = 'SilentlyContinue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceExe = Join-Path $scriptDir "EduSign_Agent.exe"
if (-not (Test-Path $sourceExe)) {
    $sourceExe = "c:\Users\HPZBook\Desktop\KÝ SỐ\public\downloads\EduSign_Agent.exe"
}

$installDir = Join-Path $env:LOCALAPPDATA "EduSign_Agent"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

# 1. Tắt tiến trình cũ nếu đang chạy
Get-Process -Name "EduSign_Agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

# 2. Sao chép file chương trình
$targetExe = Join-Path $installDir "EduSign_Agent.exe"
if (Test-Path $sourceExe) {
    Copy-Item -Path $sourceExe -Destination $targetExe -Force
}

# 3. Tạo Shortcut ngoài Desktop chuẩn Windows
$wsh = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutDesktop = Join-Path $desktopPath "EduSign Agent.lnk"
$s1 = $wsh.CreateShortcut($shortcutDesktop)
$s1.TargetPath = $targetExe
$s1.Arguments = "--tray"
$s1.WorkingDirectory = $installDir
$s1.Description = "EduSign Desktop Agent - Ban Co yeu Chinh phu"
$s1.IconLocation = "$targetExe,0"
$s1.Save()

# 4. Tạo Shortcut trong Start Menu
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$shortcutStart = Join-Path $startMenuDir "EduSign Agent.lnk"
$s2 = $wsh.CreateShortcut($shortcutStart)
$s2.TargetPath = $targetExe
$s2.Arguments = "--tray"
$s2.WorkingDirectory = $installDir
$s2.Description = "EduSign Desktop Agent"
$s2.IconLocation = "$targetExe,0"
$s2.Save()

# 5. Đăng ký tự động khởi động cùng Windows 10 & 11
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "EduSignAgent" -Value "`"$targetExe`" --tray" -Force

# 6. Khởi chạy ngầm ở Khay hệ thống ngay lập tức
Start-Process -FilePath $targetExe -ArgumentList "--tray" -WorkingDirectory $installDir

Write-Output "Cài đặt thành công! Biểu tượng đã được tạo tại: $shortcutDesktop"
