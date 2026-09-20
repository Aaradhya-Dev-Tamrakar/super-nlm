# Stop Super-NLM Background Server
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $scriptDir "data\server.pid"

if (Test-Path $pidFile) {
    $procId = (Get-Content $pidFile).Trim()
    if ($procId) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction Stop
            Stop-Process -Id $procId -Force
            Write-Host "✅ Stopped Super-NLM Hub background server (PID: $procId)" -ForegroundColor Green
        } catch {
            Write-Host "ℹ️ Process (PID: $procId) was not running." -ForegroundColor Yellow
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
} else {
    # Fallback: find any uvicorn/python process listening on port 8000
    $netstat = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
    if ($netstat) {
        foreach ($conn in $netstat) {
            try {
                Stop-Process -Id $conn.OwningProcess -Force
                Write-Host "✅ Terminated process on port 8000 (PID: $($conn.OwningProcess))" -ForegroundColor Green
            } catch {}
        }
    } else {
        Write-Host "ℹ️ No Super-NLM server currently running on port 8000." -ForegroundColor Gray
    }
}
