@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установи LTS с https://nodejs.org
  pause
  exit /b 1
)
echo Измеряю задержку появления нового матча. Оставь окно открытым, пока играешь и после игры.
node watch.mjs %*
echo.
echo Отчёт: %~dp0out\watch.md
pause
