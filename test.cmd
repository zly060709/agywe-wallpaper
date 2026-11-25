@echo off
setlocal
chcp 65001 >nul
rem v0.11.1: smoke test (read-only). Uses Antigravity.exe as Node, same as install.cmd.
set "AG="
for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0findag.ps1"`) do set "AG=%%I"
if "%AG%"=="" set "AG=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not exist "%AG%" (
  echo [agywe] Antigravity.exe not found: "%AG%"
  echo Set AGYWE_EXE to the full path of Antigravity.exe and run again.
  pause
  exit /b 1
)
echo [agywe] smoke test - read-only, does not modify Antigravity or your settings
echo.
set ELECTRON_RUN_AS_NODE=1
"%AG%" "%~dp0test\smoke.cjs"
set ERR=%ERRORLEVEL%
echo.
echo [agywe] log saved to test\smoke-last.log
pause
exit /b %ERR%
