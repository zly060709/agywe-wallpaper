@echo off
setlocal
chcp 65001 >nul
set "AG=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not "%AGYWE_EXE%"=="" set "AG=%AGYWE_EXE%"
if not exist "%AG%" (
  echo [agywe] Antigravity.exe not found: "%AG%"
  echo Set AGYWE_EXE to the full path of Antigravity.exe and run again.
  pause
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=1
"%AG%" "%~dp0install.cjs" restore --exe "%AG%" %*
set ERR=%ERRORLEVEL%
echo.
pause
exit /b %ERR%
