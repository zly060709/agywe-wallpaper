@echo off
setlocal
chcp 65001 >nul
rem v0.10.2: find Antigravity.exe (AGYWE_EXE / last known location / default / registry)
set "AG="
for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0findag.ps1"`) do set "AG=%%I"
if "%AG%"=="" set "AG=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not exist "%AG%" (
  echo [agywe] Antigravity.exe not found: "%AG%"
  echo Set AGYWE_EXE to the full path of Antigravity.exe and run again.
  pause
  exit /b 1
)
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0fusecheck.ps1" -Exe "%AG%" -For other
set "FC=%ERRORLEVEL%"
if "%FC%"=="2" goto :fcstop
if "%FC%"=="3" goto :fcstop
goto :fcok
:fcstop
echo.
pause
exit /b 1
:fcok
set ELECTRON_RUN_AS_NODE=1
"%AG%" "%~dp0install.cjs" uninstall --exe "%AG%" %*
set ERR=%ERRORLEVEL%
echo.
pause
exit /b %ERR%
