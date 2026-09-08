@echo off
title Super-NLM Hub (Cloudflare Remote Tunnel)
chcp 65001 > nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found in .venv.
    echo Please run: uv venv .venv
    pause
    exit /b 1
)

echo Starting Super-NLM with secure Cloudflare Tunnel...
.venv\Scripts\python.exe run.py --tunnel
pause
