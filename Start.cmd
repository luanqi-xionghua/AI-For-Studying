@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" goto setup
".venv\Scripts\python.exe" run.py
if errorlevel 1 pause
exit /b
:setup
echo Please create the Python virtual environment as described in README.md.
pause
