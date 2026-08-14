@echo off
title Push Updates to GitHub
echo Navigating to project directory...
cd /d "c:\Users\rishi\Downloads\vittal oil mill"

echo Pushing latest commits to GitHub...
git push origin main

echo.
echo ===================================================
echo  GitHub Push Completed!
echo ===================================================
pause
