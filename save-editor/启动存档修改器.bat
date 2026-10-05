@echo off
chcp 65001 >nul
title AnYuan-QiJu Save Trainer
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node trainer.js %*
echo.
pause
exit /b 0

:nonode
echo.
echo [ERROR] Node.js not found. Please install Node.js: https://nodejs.org/
echo.
pause
exit /b 1
