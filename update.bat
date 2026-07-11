@echo off
title Vitthal Oil Mill OS Updater
echo ==========================================================
echo        VITTHAL OIL MILL ERP — SYSTEM UPDATER
echo ==========================================================
echo.
echo Checking connection to the update server...
echo.

:: Configure your update URL here. 
:: You can host these files on GitHub (Raw), your own website, or a free host.
set UPDATE_URL=https://raw.githubusercontent.com/rushikeshikshu-pixel/vittal-oil-mill/main

:: Verify curl is installed (Standard on Windows 10/11)
curl --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] curl command not found. Cannot update automatically.
    pause
    exit /b
)

echo Downloading latest software components...
echo.

:: Download each code file to a temporary file first to prevent corruption
curl -s -f -o "%~dp0app.js.new" "%UPDATE_URL%/app.js"
if %ERRORLEVEL% NEQ 0 goto ERROR_DOWNLOAD

curl -s -f -o "%~dp0index.html.new" "%UPDATE_URL%/index.html"
if %ERRORLEVEL% NEQ 0 goto ERROR_DOWNLOAD

curl -s -f -o "%~dp0style.css.new" "%UPDATE_URL%/style.css"
if %ERRORLEVEL% NEQ 0 goto ERROR_DOWNLOAD

curl -s -f -o "%~dp0server.py.new" "%UPDATE_URL%/server.py"
if %ERRORLEVEL% NEQ 0 goto ERROR_DOWNLOAD

:: Apply updates
echo.
echo Applying files...
move /y "%~dp0app.js.new" "%~dp0app.js" >nul
move /y "%~dp0index.html.new" "%~dp0index.html" >nul
move /y "%~dp0style.css.new" "%~dp0style.css" >nul
move /y "%~dp0server.py.new" "%~dp0server.py" >nul

echo.
echo ==========================================================
echo   SUCCESS: ERP system successfully updated to the latest version!
echo ==========================================================
echo.
pause
exit /b

:ERROR_DOWNLOAD
echo.
echo [ERROR] Failed to download updates. 
echo 1. Check your internet connection.
echo 2. Verify that your UPDATE_URL in this batch file is correct.
echo.
if exist "%~dp0app.js.new" del "%~dp0app.js.new"
if exist "%~dp0index.html.new" del "%~dp0index.html.new"
if exist "%~dp0style.css.new" del "%~dp0style.css.new"
if exist "%~dp0server.py.new" del "%~dp0server.py.new"
pause
exit /b
