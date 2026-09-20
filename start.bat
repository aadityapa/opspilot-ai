@echo off
setlocal
title OpsPilot AI
cd /d "%~dp0"

echo.
echo   OpsPilot AI
echo   ===========
echo.

if not exist "package.json" (
    echo   package.json was not found next to start.bat.
    echo   Run this file from the OpsPilot folder.
    echo.
    pause
    exit /b 2
)

where node >nul 2>&1
if errorlevel 1 (
    echo   Node.js is not installed. Install Node 24 LTS from https://nodejs.org
    echo   then run this file again.
    start "" https://nodejs.org/en/download
    echo.
    pause
    exit /b 3
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 24 (
    echo   Node %NODE_MAJOR% found, but this project needs Node 24.
    echo   Install Node 24 LTS from https://nodejs.org and run this file again.
    echo.
    pause
    exit /b 3
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo   npm was not found alongside Node. Reinstall Node 24 LTS from https://nodejs.org
    echo.
    pause
    exit /b 3
)

echo   Node %NODE_MAJOR% found.
echo   The first run sets everything up and may take a few minutes.
echo   Leave this window open while you use the app. Press Ctrl+C to stop.
echo.

node "scripts\start.mjs"
set EXIT=%errorlevel%

if "%EXIT%"=="0" exit /b 0
if "%EXIT%"=="130" exit /b 0

echo.
if "%EXIT%"=="10" (
    echo   The database could not be used. See the message above.
    echo   If you use Docker Desktop, start it. If you use your own PostgreSQL, check that it is
    echo   running and that DATABASE_URL in .env is right. Nothing was changed.
) else if "%EXIT%"=="11" (
    echo   Applying database migrations failed. Nothing destructive was attempted.
    echo   Run   npm.cmd run db:migrate   to see the full message.
) else if "%EXIT%"=="12" (
    echo   The settings in .env are not valid. See the message above for the setting name.
) else (
    echo   Something went wrong ^(exit code %EXIT%^). Run   npm.cmd run doctor   to see what.
)
echo.
pause
exit /b %EXIT%
