@echo off
setlocal
cd /d "%~dp0"
echo Stopping Motto...

REM Only listeners on Motto's port. Leaves the browser alone.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8080"') do (
  echo   stopping %%P
  taskkill /F /PID %%P >nul 2>&1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = (Get-Location).Path; Get-CimInstance Win32_Process | ForEach-Object { $cmd = $_.CommandLine; if ($cmd -and $cmd.Contains($root) -and ($cmd -match 'server\.mjs' -or $cmd -match 'server\.py')) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }"

echo Motto stopped.
echo.
pause
