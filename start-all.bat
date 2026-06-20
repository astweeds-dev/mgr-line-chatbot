@echo off
chcp 65001 >nul
title MGR LINE Chatbot
cd /d "%~dp0"

echo ============================================
echo   MGR LINE Chatbot - Starting All Services
echo ============================================
echo.

:: Kill old processes
echo [1/5] Cleaning up old processes...
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im cloudflared.exe >nul 2>nul
timeout /t 2 /nobreak >nul

:: Clear old tunnel log
if exist tunnel.log del tunnel.log

:: Start Node.js server
echo [2/5] Starting Node.js server...
start /b "" cmd /c "node app.js >> server.log 2>&1"
timeout /t 3 /nobreak >nul

curl -s -o nul -w "%%{http_code}" http://localhost:3000/health > "%TEMP%\mgr_check.txt" 2>nul
set /p STATUS=<"%TEMP%\mgr_check.txt"
if "%STATUS%"=="200" (
    echo        Server OK!
) else (
    echo        WARNING: Server may not be ready yet
)

:: Start Cloudflare Tunnel
echo [3/5] Starting Cloudflare Tunnel...
start /b "" cmd /c "cloudflared tunnel --url http://localhost:3000 >> tunnel.log 2>&1"

:: Wait for tunnel URL to appear in log
echo        Waiting for tunnel URL...
set TUNNEL_URL=
set RETRY=0

:wait_tunnel
timeout /t 2 /nobreak >nul
set /a RETRY+=1

if exist tunnel.log (
    for /f "tokens=*" %%a in ('findstr /c:"trycloudflare.com" tunnel.log 2^>nul') do (
        for %%u in (%%a) do (
            echo %%u | findstr /b "https://.*trycloudflare.com" >nul 2>nul
            if not errorlevel 1 set "TUNNEL_URL=%%u"
        )
    )
)

if defined TUNNEL_URL goto tunnel_found
if %RETRY% GEQ 15 goto tunnel_timeout
goto wait_tunnel

:tunnel_timeout
echo        ERROR: Could not get tunnel URL after 30 seconds
echo        Check tunnel.log for details
goto start_monitor

:tunnel_found
echo        Tunnel URL: %TUNNEL_URL%

:: Update BASE_URL in .env
echo [4/5] Updating .env BASE_URL...
powershell -Command "(Get-Content .env -Raw) -replace 'BASE_URL=.*', 'BASE_URL=%TUNNEL_URL%' | Set-Content .env -NoNewline"
echo        .env updated!

:: Restart server to pick up new BASE_URL
echo        Restarting server with new URL...
taskkill /f /im node.exe >nul 2>nul
timeout /t 2 /nobreak >nul
start /b "" cmd /c "node app.js >> server.log 2>&1"
timeout /t 3 /nobreak >nul

:: Update LINE Webhook
echo [5/5] Updating LINE Webhook URL...
node update-webhook.js
echo.

:start_monitor
echo ============================================
echo   All services running!
echo   - Server:  http://localhost:3000
if defined TUNNEL_URL echo   - Tunnel:  %TUNNEL_URL%
echo   - Webhook: auto-updated
echo   - Monitor: checking every 30 seconds
echo.
echo   Close this window to stop everything
echo ============================================
echo.

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
