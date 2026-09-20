param (
    [switch]$Background,
    [switch]$Hidden,
    [switch]$Tunnel,
    [switch]$NoBrowser,
    [switch]$NoUpgrade,
    [int]$Port = 0
)

# Windows PowerShell Launcher for Super-NLM Hub
$Host.UI.RawUI.WindowTitle = "Super-NLM Hub (Dev Drive ReFS)"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$pythonExe = Join-Path $scriptDir ".venv\Scripts\python.exe"
$pythonwExe = Join-Path $scriptDir ".venv\Scripts\pythonw.exe"

if (-not (Test-Path $pythonExe)) {
    Write-Host "[ERROR] Virtual environment not found at $pythonExe" -ForegroundColor Red
    Write-Host "Creating environment with uv..." -ForegroundColor Yellow
    uv venv .venv
    uv pip install --python .venv\Scripts\python.exe fastapi uvicorn pydantic httpx aiosqlite
}

$argList = @()
if ($Tunnel) { $argList += "--tunnel" }
if ($NoBrowser) { $argList += "--no-browser" }
if ($NoUpgrade) { $argList += "--no-upgrade" }
if ($Port -gt 0) { $argList += "--port", $Port }

if ($Background -or $Hidden) {
    Write-Host "🚀 Launching Super-NLM Hub in the background (hidden)..." -ForegroundColor Cyan
    $runPy = Join-Path $scriptDir "run.py"
    $targetExe = if (Test-Path $pythonwExe) { $pythonwExe } else { $pythonExe }
    
    $proc = Start-Process -FilePath $targetExe -ArgumentList (@($runPy) + $argList) -WorkingDirectory $scriptDir -WindowStyle Hidden -PassThru
    
    if (-not (Test-Path "$scriptDir\data")) {
        New-Item -ItemType Directory -Path "$scriptDir\data" -Force | Out-Null
    }
    $proc.Id | Out-File -FilePath "$scriptDir\data\server.pid" -Encoding ascii
    Write-Host "✅ Super-NLM Hub is running silently in background (PID: $($proc.Id))" -ForegroundColor Green
    Write-Host "🌐 Access Dashboard at http://127.0.0.1:8000" -ForegroundColor Cyan
    Write-Host "🛑 To stop the background server, run: .\stop.ps1" -ForegroundColor Gray
} else {
    & $pythonExe (Join-Path $scriptDir "run.py") $argList
}
