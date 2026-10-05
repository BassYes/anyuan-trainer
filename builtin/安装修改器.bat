@echo off
chcp 65001 >nul
title AnYuan Trainer - Install
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node install.js install
echo.
pause
exit /b 0

:nonode
echo.
echo [ERROR] Node.js not found. Install from https://nodejs.org/
echo.
pause
exit /b 1
