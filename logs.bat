@echo off
title Super-NLM Hub Live Logs
cd /d "%~dp0"
powershell -NoProfile -Command "if (Test-Path 'data\server.log') { Get-Content -Path 'data\server.log' -Wait -Tail 50 } else { Write-Host 'data\server.log does not exist yet. Launch Super-NLM first.' -ForegroundColor Yellow; pause }"
