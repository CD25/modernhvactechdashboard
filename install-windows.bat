@echo off
REM One-click setup for Windows: installs Node.js if needed, makes the
REM dashboard start by itself whenever this PC signs in, and starts it now.
setlocal
cd /d "%~dp0"
title Modern HVAC Tech dashboard - setup

where node >nul 2>nul
if errorlevel 1 (
  echo Installing Node.js - this takes a minute...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js could not be installed automatically.
  echo Install the LTS version from https://nodejs.org, then double-click this file again.
  pause
  exit /b 1
)

if not exist ".env" copy ".env.example" ".env" >nul
if not exist "data" mkdir "data"

REM Start with Windows (no admin rights needed): a small launcher in the Startup folder.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\Modern HVAC Tech dashboard.vbs" echo CreateObject("WScript.Shell").Run "wscript.exe ""%~dp0run-hidden.vbs""", 0, False

REM Keep the PC from sleeping while plugged in, so the link keeps working.
powercfg /change standby-timeout-ac 0 >nul 2>nul

start "" wscript.exe "%~dp0run-hidden.vbs"
echo Starting the dashboard...
timeout /t 6 /nobreak >nul
start "" http://localhost:8080

echo.
echo ============================================================
echo  Done. The dashboard is running and will start by itself
echo  every time this PC is turned on and signed in.
echo.
echo  1. In the browser that just opened, create the owner account.
echo  2. Open Connections in the menu to connect Google and the rest.
echo  3. Double-click public-link.bat to get the link for the client.
echo ============================================================
pause
