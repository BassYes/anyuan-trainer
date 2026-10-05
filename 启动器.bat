@echo off
chcp 65001 >nul
title AnYuan Trainer
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node launcher.js %*
exit /b 0

:nonode
echo.
echo [ERROR] Node.js not found. Please install Node.js: https://nodejs.org/
echo.
pause
exit /b 1
