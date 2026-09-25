@echo off
REM Gives the dashboard a permanent, secure https link that works on any
REM phone or computer, using Tailscale Funnel (free, no credit card).
REM Run once. The link keeps working after restarts.
setlocal
cd /d "%~dp0"
title Modern HVAC Tech dashboard - public link

where tailscale >nul 2>nul
if errorlevel 1 (
  echo Installing Tailscale...
  winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\Tailscale"
)
where tailscale >nul 2>nul
if errorlevel 1 (
  echo Tailscale could not be installed automatically. Install it from https://tailscale.com/download and run this again.
  pause
  exit /b 1
)

echo.
echo Step 1: sign in to Tailscale (a free account - Google sign-in works).
tailscale up
echo.
echo Step 2: turning on the public link. If Tailscale shows a web link to
echo "enable Funnel" or "enable HTTPS", open it, click Enable, then come back here.
tailscale funnel --bg 8080
echo.
echo ============================================================
echo  Your dashboard link is the https:// address below.
echo  Send it to the client. It stays the same from now on.
echo ============================================================
tailscale funnel status
pause
