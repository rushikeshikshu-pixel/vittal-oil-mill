@echo off
title Ikshu Intelligence - Gangamai Sugar Mill Command Center
echo ====================================================================
echo        IKSHU INTELLIGENCE - GANGAMAI COMMAND PORTAL
echo ====================================================================
echo.
echo Starting local high-speed portal with Google Maps Radar and Plot Visualizer...
cd /d "%~dp0sites\ikshu-intelligence"
start "" http://localhost:5173/portal
npm.cmd run dev
pause
