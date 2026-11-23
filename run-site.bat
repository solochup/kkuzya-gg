@echo off
rem KKUZYA.GG: start the site by double-click.
rem This file is ASCII-only with CRLF line endings on purpose: cmd.exe misreads
rem batch files with LF-only endings or UTF-8 text. All logic and Russian messages
rem live in server\launch.mjs.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node server\launch.mjs %*
if errorlevel 1 pause
exit /b

:nonode
echo Node.js was not found.
echo Install the LTS version from https://nodejs.org and run this file again.
pause
exit /b 1
