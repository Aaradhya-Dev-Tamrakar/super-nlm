# Windows PowerShell Launcher for Super-NLM Hub
$Host.UI.RawUI.WindowTitle = "Super-NLM Hub (Dev Drive ReFS)"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$pythonExe = Join-Path $scriptDir ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
    Write-Host "[ERROR] Virtual environment not found at $pythonExe" -ForegroundColor Red
    Write-Host "Creating environment with uv..." -ForegroundColor Yellow
    uv venv .venv
    uv pip install --python .venv\Scripts\python.exe fastapi uvicorn pydantic httpx aiosqlite
}

& $pythonExe (Join-Path $scriptDir "run.py") @args
