@echo off
setlocal

cd /d "%~dp0"
echo ARES-X launcher for Windows
echo Project: %CD%
echo.

set "NODE_CMD=node"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo Installing Node.js LTS with winget...
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  ) else (
    where choco >nul 2>nul
    if not errorlevel 1 (
      echo Installing Node.js LTS with Chocolatey...
      choco install nodejs-lts -y
    ) else (
      echo Please install Node.js LTS from https://nodejs.org/ and run this file again.
      echo.
      pause
      exit /b 1
    )
  )
)

if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"

"%NODE_CMD%" "%CD%\ares-x\scripts\run-all.mjs"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" echo ARES-X launcher exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
