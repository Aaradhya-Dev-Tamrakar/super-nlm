@echo off
title Deploy Super-NLM to Google Cloud Run
chcp 65001 > nul
cd /d "%~dp0"

powershell -ExecutionPolicy Bypass -File deploy_cloud_run.ps1
pause
