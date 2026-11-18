@echo off
set "PATH=C:\Program Files\nodejs;C:\Users\Owner\.cargo\bin;%PATH%"
cd /d "%~dp0"
echo Starting Local Planner (Tauri v2 Dev Server)...
npm.cmd run tauri dev
pause
