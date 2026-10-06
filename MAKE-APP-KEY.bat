@echo off
setlocal
title Turmoil - Create Private App Key
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Windows cannot find Node.js. Install Node.js 22 or newer and try again.
  echo.
  pause
  exit /b 1
)
node "%~dp0scripts\make-app-key.mjs"
set "tracker_exit_code=%errorlevel%"
echo.
pause
exit /b %tracker_exit_code%
