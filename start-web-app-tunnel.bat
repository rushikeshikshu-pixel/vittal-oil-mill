@echo off
title Vitthal Oil Mill - Web App Server & Permanent Tunnel
echo ==========================================================
echo       VITTHAL OIL MILL - MOBILE WEB APP LAUNCHER
echo ==========================================================
echo.
echo 1. Starting local ERP database server...
start /b python server.py
timeout /t 3 /nobreak >nul
echo.
echo 2. Starting secure Cloudflare Web App Tunnel...
echo.
if exist "%~dp0cloudflared.exe" (
    "%~dp0cloudflared.exe" tunnel --url http://localhost:4567
) else (
    npx -y localtunnel --port 4567
)
pause
