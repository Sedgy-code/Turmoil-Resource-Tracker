@echo off
setlocal
title Turmoil Resource Tracker
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Windows cannot find Node.js yet.
  echo Close this window, restart your computer, then try again.
  echo If Node.js is not installed, install version 22 or newer first.
  echo.
  pause
  exit /b 1
)
node "%~dp0scripts\start-demo.mjs"
set "tracker_exit_code=%errorlevel%"
echo.
pause
exit /b %tracker_exit_code%
