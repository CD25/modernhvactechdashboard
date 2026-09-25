@echo off
REM Double-click to start the dashboard on this PC.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env - fill in your settings, save, then run this again.
  notepad ".env"
  exit /b 0
)
start "" http://localhost:8080
node server\index.js
pause
