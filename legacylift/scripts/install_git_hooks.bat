@echo off
setlocal
cd /d "%~dp0..\.."
git config core.hooksPath .githooks
echo Installed git hooks from .githooks (post-merge and post-checkout will sync conduct_demo_script.md).
python legacylift\scripts\sync_conduct_demo_script.py
endlocal
