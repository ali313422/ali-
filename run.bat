@echo off
chcp 65001 >nul
set PYTHONUTF8=1
setlocal enabledelayedexpansion



for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (

  echo Stopping PID %%a on port 8000...

  taskkill /PID %%a /F >nul 2>&1

)



cd /d "%~dp0"

echo ========================================

echo  Kitchen Designer - مطابخ

echo  Folder: %CD%

echo ========================================

echo Open:  http://127.0.0.1:8000/admin

echo Login: admin / 1234

echo Delete: POST to /admin (same page)

echo Check: http://127.0.0.1:8000/debug  (must show adminVersion v7-final)

echo WhatsApp: set CALLMEBOT_API_KEY below (callmebot.com)
echo ========================================

REM set CALLMEBOT_API_KEY=YOUR_KEY_HERE

start "" "http://127.0.0.1:8000/admin"



python -u "%~dp0start.py"



endlocal

