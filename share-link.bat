@echo off
REM Gives the dashboard a secure https:// link that works on any phone or
REM laptop. Keep this window open while people use the link.
cd /d "%~dp0"
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo Installing Cloudflare's free tunnel tool...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo Close this window and double-click share-link.bat again.
  pause
  exit /b 0
)
echo.
echo Your link appears below as https://....trycloudflare.com
echo Send it to your team. It changes each time you restart this window.
echo.
cloudflared tunnel --url http://localhost:8080
pause
