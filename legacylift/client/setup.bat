@echo off
:: LegacyLift client setup - Windows only, runs inside client/ directory.
:: Does NOT touch the parent legacylift/ Python environment.

echo.
echo  =========================================
echo   LegacyLift Client Setup
echo  =========================================
echo.

:: Verify we're in the right folder
if not exist package.json (
    echo ERROR: Run this script from inside client/
    echo        e.g.  cd legacylift\client ^&^& setup.bat
    exit /b 1
)

echo [1/2] Installing npm dependencies...
npm install
if %ERRORLEVEL% NEq 0 (
    echo ERROR: npm install failed. Make sure Node.js ^>=18 is installed.
    exit /b 1
)

echo.
echo [2/2] Creating .env.local from example...
if not exist .env.local (
    copy .env.local.example .env.local
    echo       .env.local created.
) else (
    echo       .env.local already exists - skipping.
)

echo.
echo  =========================================
echo   LegacyLift frontend ready.
echo   Fill in .env.local then run: npm run dev
echo  =========================================
echo.
