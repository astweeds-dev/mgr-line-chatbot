@echo off
chcp 65001 >nul
title MGR Monitor

set "DIR=%~dp0"
set "LOG=%DIR%server.log"

echo [%date% %time%] Monitor started >> "%LOG%"
echo === MGR Server Monitor ===
echo Checking every 30 seconds...
echo.

:loop
curl -s -o nul -w "%%{http_code}" http://localhost:3000/health > "%TEMP%\mgr_health.txt" 2>nul
set /p CODE=<"%TEMP%\mgr_health.txt"

if "%CODE%"=="200" (
    echo [%time%] OK
) else (
    echo [%date% %time%] Server down! Restarting... >> "%LOG%"
    echo [%time%] Server down! Restarting...

    taskkill /f /im node.exe >nul 2>nul
    timeout /t 2 /nobreak >nul

    cd /d "%DIR%"
    start /b "" cmd /c "node app.js >> "%LOG%" 2>&1"

    timeout /t 3 /nobreak >nul
    echo [%date% %time%] Server restarted >> "%LOG%"
    echo [%time%] Server restarted
)

timeout /t 30 /nobreak >nul
goto loop
