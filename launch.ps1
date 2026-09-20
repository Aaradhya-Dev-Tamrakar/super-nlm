param (
    [switch]$Foreground,
    [switch]$Console,
    [switch]$Tunnel,
    [switch]$NoBrowser,
    [switch]$NoUpgrade,
    [int]$Port = 0
)

# Windows PowerShell Launcher for Super-NLM Hub (Defaults to Background)
$Host.UI.RawUI.WindowTitle = "Super-NLM Hub"
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

# Check if server is already running on port 8000
$existingConn = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
if ($existingConn) {
    $existingPid = $existingConn[0].OwningProcess
    Write-Host "[INFO] Super-NLM Hub is already active on http://127.0.0.1:8000 (PID: $existingPid)" -ForegroundColor Green
    if (-not $NoBrowser) {
        Start-Process "http://127.0.0.1:8000"
    }
    exit 0
}

$argList = @()
if ($Tunnel) { $argList += "--tunnel" }
if ($NoBrowser) { $argList += "--no-browser" }
if ($NoUpgrade) { $argList += "--no-upgrade" }
if ($Port -gt 0) { $argList += "--port", $Port }

if ($Foreground -or $Console) {
    Write-Host "[START] Launching Super-NLM Hub in foreground console..." -ForegroundColor Cyan
    & $pythonExe (Join-Path $scriptDir "run.py") $argList
} else {
    # Default: Background execution
    Write-Host "[START] Launching Super-NLM Hub silently in background..." -ForegroundColor Cyan
    $runPy = Join-Path $scriptDir "run.py"
    
    $bgArgs = @($runPy) + $argList
    if ($bgArgs -notcontains "--no-browser") {
        $bgArgs += "--no-browser"
    }
    
    $targetExe = if (Test-Path $pythonwExe) { $pythonwExe } else { $pythonExe }
    $proc = Start-Process -FilePath $targetExe -ArgumentList $bgArgs -WorkingDirectory $scriptDir -WindowStyle Hidden -PassThru
    
    if (-not (Test-Path "$scriptDir\data")) {
        New-Item -ItemType Directory -Path "$scriptDir\data" -Force | Out-Null
    }
    $proc.Id | Out-File -FilePath "$scriptDir\data\server.pid" -Encoding ascii
    Write-Host "[SUCCESS] Super-NLM Hub is active in background (PID: $($proc.Id))" -ForegroundColor Green
    Write-Host "[URL] Dashboard: http://127.0.0.1:8000" -ForegroundColor Cyan
    Write-Host "[STOP] To stop background server: run .\stop.ps1 or double-click stop.bat" -ForegroundColor Gray

    if (-not $NoBrowser) {
        # Poll up to 5 seconds for the server to bind port 8000
        for ($i = 0; $i -lt 10; $i++) {
            Start-Sleep -Milliseconds 500
            $conn = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
            if ($conn) {
                break
            }
        }
        Start-Process "http://127.0.0.1:8000"
    }
}
