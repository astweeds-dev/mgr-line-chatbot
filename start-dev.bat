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

:: Kill old processes
echo [1/5] Cleaning up old processes...
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im cloudflared.exe >nul 2>nul
timeout /t 2 /nobreak >nul

:: Clear old tunnel log
if exist tunnel.log del tunnel.log

:: Start Node.js server in DEV mode
echo [2/5] Starting Node.js server (DEV)...
set NODE_ENV=development
start /b "" cmd /c "set "NODE_ENV=development"&& node app.js >> server.log 2>&1"
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

:: Wait for tunnel URL
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

:: Update BASE_URL in .env.development
echo [4/5] Updating .env.development BASE_URL...
powershell -Command "(Get-Content .env.development -Raw) -replace 'BASE_URL=.*', 'BASE_URL=%TUNNEL_URL%' | Set-Content .env.development -NoNewline"
echo        .env.development updated!

:: Restart server to pick up new BASE_URL
echo        Restarting server with new URL...
taskkill /f /im node.exe >nul 2>nul
timeout /t 2 /nobreak >nul
start /b "" cmd /c "set "NODE_ENV=development"&& node app.js >> server.log 2>&1"
timeout /t 3 /nobreak >nul

:: Update DEV LINE Webhook
echo [5/5] Updating DEV LINE Webhook URL...
set NODE_ENV=development
node -e "require('dotenv').config({path:'.env.development'});const{messagingApi}=require('@line/bot-sdk');const c=new messagingApi.MessagingApiClient({channelAccessToken:process.env.CHANNEL_ACCESS_TOKEN});const url=process.env.BASE_URL+'/webhook';c.setWebhookEndpoint({endpoint:url}).then(()=>console.log('Webhook set:',url)).catch(e=>console.error('Error:',e.body||e.message))"
echo.

:start_monitor
echo ============================================
echo   DEV MODE - All services running!
echo   - Server:  http://localhost:3000
if defined TUNNEL_URL echo   - Tunnel:  %TUNNEL_URL%
echo   - Webhook: auto-updated (DEV channel)
echo   - Monitor: checking every 30 seconds
echo.
echo   ** This is DEV - production is NOT affected **
echo.
echo   Close this window to stop everything
echo ============================================
echo.

:loop
curl -s -o nul -w "%%{http_code}" http://localhost:3000/health > "%TEMP%\mgr_health.txt" 2>nul
set /p CODE=<"%TEMP%\mgr_health.txt"

if "%CODE%"=="200" (
    echo [%time%] [DEV] Server OK
) else (
    echo [%time%] [DEV] SERVER DOWN - Restarting...
    taskkill /f /im node.exe >nul 2>nul
    timeout /t 2 /nobreak >nul
    start /b "" cmd /c "set "NODE_ENV=development"&& node app.js >> server.log 2>&1"
    timeout /t 3 /nobreak >nul
    echo [%time%] [DEV] Server restarted
)

timeout /t 30 /nobreak >nul
goto loop
