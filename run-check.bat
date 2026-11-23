@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден.
  echo Установи версию LTS с https://nodejs.org , затем закрой это окно и запусти файл снова.
  pause
  exit /b 1
)
node check.mjs %*
echo.
echo Отчёт лежит здесь: %~dp0out\report.md
echo Открой его в Блокноте и пришли мне текст.
pause
