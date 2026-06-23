@echo off
chcp 65001 >nul

set "TASK_NAME=MGR-Chatbot-Watchdog"
set "BAT_PATH=%~dp0start-all.bat"

echo ================================================
echo   MGR Chatbot - Auto-Start Setup
echo ================================================
echo.
echo   Task: %TASK_NAME%
echo   Script: %BAT_PATH%
echo.

:: Check for admin rights
net session >nul 2>nul
if %errorlevel% neq 0 (
    echo   [!] Need administrator rights
    echo   Right-click this file and "Run as administrator"
    echo.
    pause
    exit /b 1
)

:: Create scheduled task (runs at user logon, highest privileges)
schtasks /create /tn "%TASK_NAME%" /tr "\"%BAT_PATH%\"" /sc onlogon /rl highest /f

if %errorlevel% equ 0 (
    echo.
    echo   ============================================
    echo   Done!
    echo   MGR Chatbot will start automatically
    echo   when you log in to Windows.
    echo.
    echo   To remove auto-start:
    echo     schtasks /delete /tn "%TASK_NAME%" /f
    echo   ============================================
) else (
    echo.
    echo   [!] Failed to create task.
    echo   Try running as Administrator.
)

echo.
pause
