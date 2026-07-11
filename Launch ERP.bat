@echo off
title Vitthal Oil Mill OS Launcher
echo ==========================================================
echo       VITTHAL OIL MILL MANAGEMENT OS LAUNCHER
echo ==========================================================
echo.
echo Starting secure local database server...
echo (Keep this window open while using the software)
echo.

python --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Python detected. Launching database API server...
    python "%~dp0server.py"
) else (
    echo [INFO] PowerShell fallback. Starting static server...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [WARNING] Database server failed to start.
    echo Opening dashboard in offline file fallback mode...
    start "" "%~dp0index.html"
)
pause
