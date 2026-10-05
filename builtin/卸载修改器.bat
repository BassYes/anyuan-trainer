@echo off
chcp 65001 >nul
title AnYuan Trainer - Uninstall
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node install.js uninstall
echo.
pause
exit /b 0

:nonode
echo.
echo [ERROR] Node.js not found. Install from https://nodejs.org/
echo.
pause
exit /b 1
