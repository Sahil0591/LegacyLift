@echo off
:: LegacyLift server setup — Windows only, runs inside server/ directory.
:: Uses the shared .venv at the repo root (LegacyLift\.venv).

echo.
echo  =========================================
echo   LegacyLift Server Setup
echo  =========================================
echo.

:: Verify we're in the right folder
if not exist requirements.txt (
    echo ERROR: Run this script from inside server/
    echo        e.g.  cd legacylift\server ^&^& setup.bat
    exit /b 1
)

:: Verify the shared venv exists
if not exist ..\..\.venv\Scripts\python.exe (
    echo ERROR: .venv not found. Create it first from LegacyLift\:
    echo        python -m venv .venv
    exit /b 1
)

set VENV_PYTHON=..\..\.venv\Scripts\python.exe
set VENV_PIP=..\..\.venv\Scripts\pip.exe

echo [1/2] Upgrading pip...
%VENV_PYTHON% -m pip install --upgrade pip --quiet
if %ERRORLEVEL% NEq 0 (
    echo ERROR: pip upgrade failed.
    exit /b 1
)

echo.
echo [2/2] Installing requirements...
%VENV_PIP% install -r requirements.txt
if %ERRORLEVEL% NEq 0 (
    echo ERROR: pip install failed. Check requirements.txt and your internet connection.
    exit /b 1
)

echo.
echo  =========================================
echo   LegacyLift server ready.
echo   Copy .env.example to .env, add your OPENAI_API_KEY, then run:
echo     python -m uvicorn api.main:app --reload
echo  =========================================
echo.
