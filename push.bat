@echo off
echo ================================================
echo   Pushing updated game data to GitHub...
echo ================================================
echo.
cd /d "%~dp0"
git add data.csv
git commit -m "Update game data"
git push
echo.
echo  Done! Railway will auto-deploy.
echo.
pause
