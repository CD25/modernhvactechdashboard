@echo off
REM Stops the background dashboard (it starts again at the next Windows sign-in).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-hidden.vbs|server\\index.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Dashboard stopped.
pause
