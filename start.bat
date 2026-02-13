@echo off
echo ================================================
echo   Moeller Game Prep Agent V3
echo ================================================
echo.
if "%ANTHROPIC_API_KEY%"=="" (
    echo  No API key found!
    set /p ANTHROPIC_API_KEY="  API Key: "
)
pip show flask >nul 2>&1
if errorlevel 1 (
    echo  Installing dependencies...
    pip install flask anthropic
)
echo.
echo  Starting at http://localhost:3000
echo  Press Ctrl+C to stop
echo.
start "" http://localhost:3000
python server.py
pause
