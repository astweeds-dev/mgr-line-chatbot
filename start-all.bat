@echo off
chcp 65001 >nul
title MGR System Watchdog
cd /d "%~dp0"

echo ============================================
echo   MGR LINE Chatbot - Production Watchdog
echo   Close this window to stop everything
echo ============================================
echo.

:loop
:: Clean up stale PRODUCTION processes only (port 3000, won't touch DEV on 4001)
powershell -Command "try { Get-WmiObject Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -match 'localhost:3000' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } } catch {}" >nul 2>nul
powershell -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul
timeout /t 2 /nobreak >nul

node watchdog.js

echo.
echo [%date% %time%] Watchdog exited ??? restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop

