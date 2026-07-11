@echo off
REM ============================================================
REM  Vitthal Oil Mill OS - Resilient Server Runner
REM  Keeps the database server running; auto-restarts if it stops.
REM  This is the file the auto-start task launches at boot/logon.
REM ============================================================

title Vitthal Oil Mill Server (auto-restart)

REM Don't pop a browser window every restart on the server machine.
set VOM_NO_BROWSER=1

REM --- OFF-DISK BACKUP (recommended) ---
REM Point this at a USB drive or a Google Drive / OneDrive synced folder so a
REM copy of the daily backup survives even if this PC's disk fails.
REM Remove the "REM " below and edit the path, e.g.:
REM set VOM_BACKUP_DIR=G:\My Drive\VittalMillBackups

cd /d "%~dp0"

:loop
echo [%date% %time%] Starting Vitthal Oil Mill server...
python "%~dp0server.py"
echo.
echo [%date% %time%] Server stopped (exit code %ERRORLEVEL%). Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
