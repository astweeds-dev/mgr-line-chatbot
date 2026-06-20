@echo off
chcp 65001 >nul
title MGR LINE Chatbot
cd /d "%~dp0"

echo ============================================
echo   MGR LINE Chatbot - Starting All Services
echo ============================================
echo.

:: Kill old processes
echo [1/4] Cleaning up old processes...
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im cloudflared.exe >nul 2>nul
timeout /t 2 /nobreak >nul

:: Start Node.js server
echo [2/4] Starting Node.js server...
start /b "" cmd /c "node app.js >> server.log 2>&1"
timeout /t 3 /nobreak >nul

:: Verify server is up
curl -s -o nul -w "%%{http_code}" http://localhost:3000/health > "%TEMP%\mgr_check.txt" 2>nul
set /p STATUS=<"%TEMP%\mgr_check.txt"
if "%STATUS%"=="200" (
    echo     Server OK!
) else (
    echo     WARNING: Server may not be ready yet
)

:: Start Cloudflare Tunnel
echo [3/4] Starting Cloudflare Tunnel...
start /b "" cmd /c "cloudflared tunnel --url http://localhost:3000 >> tunnel.log 2>&1"
timeout /t 5 /nobreak >nul
echo     Tunnel started! Check tunnel.log for URL

:: Start Monitor
echo [4/4] Starting Monitor...
echo.
echo ============================================
echo   All services running!
echo   - Server:  http://localhost:3000
echo   - Tunnel:  check tunnel.log for URL
echo   - Monitor: checking every 30 seconds
echo.
echo   Close this window to stop everything
echo ============================================
echo.

:: Run monitor inline (keeps window open)
set "LOG=%~dp0server.log"
echo [%date% %time%] All services started >> "%LOG%"

:loop
curl -s -o nul -w "%%{http_code}" http://localhost:3000/health > "%TEMP%\mgr_health.txt" 2>nul
set /p CODE=<"%TEMP%\mgr_health.txt"

if "%CODE%"=="200" (
    echo [%time%] Server OK
) else (
    echo [%date% %time%] Server down! Restarting... >> "%LOG%"
    echo [%time%] SERVER DOWN - Restarting...
    taskkill /f /im node.exe >nul 2>nul
    timeout /t 2 /nobreak >nul
    start /b "" cmd /c "node app.js >> server.log 2>&1"
    timeout /t 3 /nobreak >nul
    echo [%date% %time%] Server restarted >> "%LOG%"
    echo [%time%] Server restarted
)

timeout /t 30 /nobreak >nul
goto loop
