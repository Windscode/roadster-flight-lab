@echo off
cd /d "%~dp0"
node "%~dp0scripts\serve.mjs" --open
if errorlevel 1 pause
