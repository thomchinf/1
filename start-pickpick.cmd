@echo off
setlocal
title PickPick
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [PickPick] Node.js was not found. Please install Node.js first.
  pause
  exit /b 1
)

node "%~dp0pickpick-local-server.js"
if errorlevel 1 pause
