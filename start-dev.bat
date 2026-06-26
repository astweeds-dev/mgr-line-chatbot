@echo off
chcp 65001 >nul
title MGR LINE Chatbot [DEV]
cd /d "%~dp0"

echo ============================================
echo   MGR LINE Chatbot - DEV MODE
echo ============================================
echo.

:: Check .env.development exists
if not exist .env.development (
    echo ERROR: .env.development not found!
    echo Please create .env.development with your DEV LINE channel credentials.
    pause
    exit /b 1
)

:: Read DEV port from .env.development (default 4001)
set DEV_PORT=4001
for /f "tokens=2 delims==" %%p in ('findstr /b "PORT=" .env.development 2^>nul') do set "DEV_PORT=%%p"

:: Kill only DEV server (by port), NOT production
echo [1/5] Cleaning up old DEV processes...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%DEV_PORT% " 2^>nul') do (
    if %%p NEQ 0 taskkill /f /pid %%p >nul 2>nul
)
timeout /t 2 /nobreak >nul

:: Clear old tunnel log
if exist tunnel-dev.log del tunnel-dev.log

:: Start Node.js server in DEV mode
echo [2/5] Starting Node.js server (DEV) on port %DEV_PORT%...
start /b "" cmd /c "set "NODE_ENV=development"&& node app.js >> server-dev.log 2>&1"
timeout /t 3 /nobreak >nul

curl -s -o nul -w "%%{http_code}" http://localhost:%DEV_PORT%/health > "%TEMP%\mgr_dev_check.txt" 2>nul
set /p STATUS=<"%TEMP%\mgr_dev_check.txt"
if "%STATUS%"=="200" (
    echo        Server OK on port %DEV_PORT%!
) else (
    echo        WARNING: Server may not be ready yet
)

:: Start Cloudflare Tunnel (point to DEV port)
echo [3/5] Starting Cloudflare Tunnel...
start /b "" cmd /c "cloudflared tunnel --url http://localhost:%DEV_PORT% >> tunnel-dev.log 2>&1"

:: Wait for tunnel URL
echo        Waiting for tunnel URL...
set TUNNEL_URL=
set RETRY=0

:wait_tunnel
timeout /t 2 /nobreak >nul
set /a RETRY+=1

if exist tunnel-dev.log (
    for /f "tokens=*" %%a in ('findstr /c:"trycloudflare.com" tunnel-dev.log 2^>nul') do (
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
echo        Check tunnel-dev.log for details
goto start_monitor

:tunnel_found
echo        Tunnel URL: %TUNNEL_URL%

:: Update BASE_URL in .env.development
echo [4/5] Updating .env.development BASE_URL...
powershell -Command "(Get-Content .env.development -Raw) -replace 'BASE_URL=.*', 'BASE_URL=%TUNNEL_URL%' | Set-Content .env.development -NoNewline"
echo        .env.development updated!

:: Restart DEV server to pick up new BASE_URL (kill only DEV port)
echo        Restarting server with new URL...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%DEV_PORT% " 2^>nul') do (
    if %%p NEQ 0 taskkill /f /pid %%p >nul 2>nul
)
timeout /t 2 /nobreak >nul
start /b "" cmd /c "set "NODE_ENV=development"&& node app.js >> server-dev.log 2>&1"
timeout /t 3 /nobreak >nul

:: Update DEV LINE Webhook
echo [5/5] Updating DEV LINE Webhook URL...
set NODE_ENV=development
node -e "require('dotenv').config({path:'.env.development'});const{messagingApi}=require('@line/bot-sdk');const c=new messagingApi.MessagingApiClient({channelAccessToken:process.env.CHANNEL_ACCESS_TOKEN});const url=process.env.BASE_URL+'/webhook';c.setWebhookEndpoint({endpoint:url}).then(()=>console.log('Webhook set:',url)).catch(e=>console.error('Error:',e.body||e.message))"
echo.

:: Read admin token from server log
set ADMIN_TOKEN=
for /f "tokens=4" %%t in ('findstr /c:"generated token:" server-dev.log 2^>nul') do set "ADMIN_TOKEN=%%t"

:start_monitor
echo ============================================
echo   DEV MODE - All services running!
echo   - Server:  http://localhost:%DEV_PORT%
if defined TUNNEL_URL echo   - Tunnel:  %TUNNEL_URL%
echo.
echo   Links:
if defined TUNNEL_URL echo   - Order:   %TUNNEL_URL%/order.html
if defined TUNNEL_URL if defined ADMIN_TOKEN echo   - Admin:   %TUNNEL_URL%/admin.html?token=%ADMIN_TOKEN%
echo   - Order (local):  http://localhost:%DEV_PORT%/order.html
if defined ADMIN_TOKEN echo   - Admin (local):  http://localhost:%DEV_PORT%/admin.html?token=%ADMIN_TOKEN%
echo.
echo   - Webhook: auto-updated (DEV channel)
echo   - Monitor: checking every 30 seconds
echo.
echo   ** This is DEV - production is NOT affected **
echo.
echo   Close this window to stop everything
echo ============================================
echo.

:loop
curl -s -o nul -w "%%{http_code}" http://localhost:%DEV_PORT%/health > "%TEMP%\mgr_dev_health.txt" 2>nul
set /p CODE=<"%TEMP%\mgr_dev_health.txt"

if "%CODE%"=="200" (
    echo [%time%] [DEV] Server OK
) else (
    echo [%time%] [DEV] SERVER DOWN - Restarting...
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%DEV_PORT% " 2^>nul') do (
        if %%p NEQ 0 taskkill /f /pid %%p >nul 2>nul
    )
    timeout /t 2 /nobreak >nul
    start /b "" cmd /c "set "NODE_ENV=development"&& node app.js >> server-dev.log 2>&1"
    timeout /t 3 /nobreak >nul
    echo [%time%] [DEV] Server restarted
)

timeout /t 30 /nobreak >nul
goto loop
