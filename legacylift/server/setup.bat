@echo off
REM =============================================================================
REM LegacyLift - Windows Setup Script
REM =============================================================================
REM Activates the existing .venv, upgrades pip, and installs all dependencies.
REM Run this once before starting development or after pulling new changes.
REM
REM Usage: setup.bat
REM Assumes: .venv already exists in this directory (python -m venv .venv)
REM =============================================================================

echo.
echo ============================================================
echo   LegacyLift - AI Legacy Code Migration Workbench
echo   Setting up development environment...
echo ============================================================
echo.

REM Step 1: Activate the virtual environment
echo [1/3] Activating virtual environment...
call .venv\Scripts\activate
if errorlevel 1 (
    echo ERROR: Failed to activate .venv
    echo Make sure you have created it first: python -m venv .venv
    pause
    exit /b 1
)
echo       OK - .venv activated

REM Step 2: Upgrade pip to latest
echo [2/3] Upgrading pip...
python -m pip install --upgrade pip --quiet
if errorlevel 1 (
    echo ERROR: Failed to upgrade pip
    pause
    exit /b 1
)
echo       OK - pip upgraded

REM Step 3: Install all project dependencies
echo [3/3] Installing requirements.txt...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install requirements
    echo Check requirements.txt and your internet connection
    pause
    exit /b 1
)
echo       OK - all packages installed

echo.
echo ============================================================
echo   Setup complete!
echo.
echo   Next steps:
echo   1. Copy .env.example to .env and add your OPENAI_API_KEY
echo   2. Run the API server:
echo         python -m uvicorn api.main:app --reload
echo   3. In a second terminal, hit the health check:
echo         curl http://localhost:8000/health
echo   4. Run the test suite:
echo         pytest tests/ -v
echo.
echo   DEMO_MODE is ON by default (see .env.example).
echo   All LLM prompts and responses will be printed to console.
echo ============================================================
echo.
pause
