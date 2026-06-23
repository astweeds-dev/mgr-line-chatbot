@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   MGR Named Tunnel Setup
echo   URL คงที่ ไม่เปลี่ยนทุกครั้งที่ restart
echo ============================================
echo.
echo   สิ่งที่ต้องมี:
echo   1. Cloudflare account (ฟรี)
echo   2. โดเมนที่เพิ่มใน Cloudflare แล้ว
echo      (ซื้อโดเมน .com ~350 บาท/ปี)
echo.
echo ============================================
echo.

:: Step 1: Login
echo [1/4] Login to Cloudflare...
echo   Browser จะเปิด — login แล้วอนุญาตให้ cloudflared
echo.
cloudflared tunnel login
if %errorlevel% neq 0 (
    echo.
    echo   [!] Login failed — ลองใหม่
    pause
    exit /b 1
)
echo   Login OK!
echo.

:: Step 2: Create tunnel
set TUNNEL_NAME=mgr-chatbot
echo [2/4] Creating tunnel "%TUNNEL_NAME%"...
cloudflared tunnel create %TUNNEL_NAME%
if %errorlevel% neq 0 (
    echo.
    echo   Tunnel อาจมีอยู่แล้ว — ลองดู:
    cloudflared tunnel list
    echo.
)
echo.

:: Step 3: Set DNS
echo [3/4] Set up DNS route
echo.
set /p HOSTNAME="   ใส่ hostname ที่ต้องการ (เช่น order.example.com): "
if "%HOSTNAME%"=="" (
    echo   [!] ต้องใส่ hostname
    pause
    exit /b 1
)

cloudflared tunnel route dns %TUNNEL_NAME% %HOSTNAME%
if %errorlevel% neq 0 (
    echo.
    echo   [!] DNS route failed
    echo   ตรวจสอบว่าโดเมนอยู่ใน Cloudflare แล้ว
    pause
    exit /b 1
)
echo   DNS route OK!
echo.

:: Step 4: Update .env
echo [4/4] Updating .env...
powershell -Command "(Get-Content .env -Raw) -replace 'TUNNEL_NAME=.*', 'TUNNEL_NAME=%TUNNEL_NAME%' -replace 'TUNNEL_HOSTNAME=.*', 'TUNNEL_HOSTNAME=%HOSTNAME%' | Set-Content .env -NoNewline"
echo   .env updated!
echo.

echo ============================================
echo   Done! Named Tunnel is ready.
echo.
echo   TUNNEL_NAME=%TUNNEL_NAME%
echo   TUNNEL_HOSTNAME=%HOSTNAME%
echo   URL: https://%HOSTNAME%
echo.
echo   Start production: start-all.bat
echo   URL จะคงที่ไม่เปลี่ยนอีกแล้ว!
echo ============================================
echo.
pause
