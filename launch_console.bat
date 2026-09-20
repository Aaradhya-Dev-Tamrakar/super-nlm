@echo off
title Super-NLM Hub (Interactive Console)
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0launch.ps1" -Foreground %*
pause
