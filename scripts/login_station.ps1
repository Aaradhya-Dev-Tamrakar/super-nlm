[CmdletBinding()]
param(
    [int]$Port = 9222,
    [string]$StationDir = "F:\nlm-login-station",
    [string[]]$ProfileIds,
    [switch]$IncludeExpiredOnly
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ProfilesPath = Join-Path $RepoRoot "data\profiles.json"
$CdpUrl = "http://127.0.0.1:$Port"

if (-not (Test-Path $ProfilesPath)) {
    Write-Error "Profiles file not found: $ProfilesPath"
    exit 1
}

function Find-ChromeExecutable {
    $candidates = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    $cmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Find-NlmPython {
    $candidates = @(
        "$env:APPDATA\uv\tools\notebooklm-mcp-cli\Scripts\python.exe",
        "$env:LOCALAPPDATA\uv\tools\notebooklm-mcp-cli\Scripts\python.exe"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

$NlmPy = Find-NlmPython
if (-not $NlmPy) {
    Write-Error "Could not find notebooklm-mcp-cli Python runtime for CDP cookie reset."
    exit 1
}

function Test-CdpReady {
    try {
        $null = Invoke-RestMethod -Uri "$CdpUrl/json/version" -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

$ClearCookiesPy = @'
import asyncio, json, sys, urllib.request, websockets

port = int(sys.argv[1])
url = sys.argv[2]
with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as resp:
    targets = json.loads(resp.read().decode("utf-8"))

page = next((t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")), None)
if not page:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/new?{url}", timeout=5) as resp:
        page = json.loads(resp.read().decode("utf-8"))

ws_url = page["webSocketDebuggerUrl"]

async def run():
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Network.enable"}))
        await ws.recv()
        await ws.send(json.dumps({"id": 2, "method": "Network.clearBrowserCookies"}))
        await ws.recv()
        await ws.send(json.dumps({"id": 3, "method": "Page.navigate", "params": {"url": url}}))
        await ws.recv()

asyncio.run(run())
'@

function Reset-StationBrowser {
    param([string]$TargetUrl = "https://notebooklm.google.com")
    & $NlmPy -c $ClearCookiesPy $Port $TargetUrl | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not clear station cookies via CDP; clear cookies manually if needed (do NOT click Sign out)."
    }
}

if (-not (Test-CdpReady)) {
    $ChromeExe = Find-ChromeExecutable
    if (-not $ChromeExe) {
        Write-Error "Google Chrome executable not found."
        exit 1
    }
    if (-not (Test-Path $StationDir)) {
        New-Item -ItemType Directory -Path $StationDir -Force | Out-Null
    }
    Write-Host "Launching Login Station Chrome on $CdpUrl (profile: $StationDir)..." -ForegroundColor Cyan
    Start-Process -FilePath $ChromeExe -ArgumentList @(
        "--user-data-dir=`"$StationDir`"",
        "--remote-debugging-port=$Port",
        "--no-first-run",
        "https://notebooklm.google.com"
    ) | Out-Null

    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-CdpReady)) {
        if ((Get-Date) -gt $deadline) {
            Write-Error "Timed out waiting for Chrome CDP on $CdpUrl"
            exit 1
        }
        Start-Sleep -Milliseconds 400
    }
}

Write-Host ""
Write-Host "=== Super-NLM Login Station ===" -ForegroundColor Cyan
Write-Host "1. Make sure the Bitwarden extension is installed & unlocked in the station Chrome window."
Write-Host "2. NEVER click 'Sign out' in Google (the script clears local browser cookies between accounts)."
Write-Host ""
$null = Read-Host "Press Enter when the station browser is ready"

$profiles = Get-Content $ProfilesPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pending = @($profiles | Where-Object {
    if ($ProfileIds -and $ProfileIds.Count -gt 0) {
        return $ProfileIds -contains $_.id
    }
    if ($IncludeExpiredOnly) {
        return $_.status -eq "expired"
    }
    return $_.status -ne "connected"
})

if ($pending.Count -eq 0) {
    Write-Host "No pending accounts to sign into!" -ForegroundColor Green
    exit 0
}

Write-Host "Found $($pending.Count) pending account(s)." -ForegroundColor Yellow
$completedCount = 0

for ($i = 0; $i -lt $pending.Count; $i++) {
    $p = $pending[$i]
    $idx = $i + 1
    Write-Host ""
    Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "[$idx/$($pending.Count)] Profile: $($p.id) ($($p.displayName))" -ForegroundColor Cyan
    Write-Host "Expected Email : $($p.email)" -ForegroundColor Green
    Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray

    Reset-StationBrowser -TargetUrl "https://notebooklm.google.com"

    $choice = Read-Host "Sign in as $($p.email) in Chrome, wait for NotebookLM to load, then press Enter (or 's'=skip, 'q'=quit)"
    if ($choice -eq 'q') { break }
    if ($choice -eq 's') {
        Write-Host "Skipped $($p.id)." -ForegroundColor DarkYellow
        continue
    }

    Write-Host "Extracting cookies from station Chrome for '$($p.id)'..." -ForegroundColor Cyan
    nlm login --profile $p.id --cdp-url $CdpUrl
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "nlm login failed for '$($p.id)'. You can re-run later."
        continue
    }

    $checkOut = (nlm login --check --profile $p.id 2>&1 | Out-String)
    Write-Host $checkOut.Trim()

    if ($checkOut -match "Account:\s*([^\s\r\n]+)") {
        $actualEmail = $Matches[1].Trim().ToLowerInvariant()
        $expectedEmail = ($p.email | ForEach-Object { $_.Trim().ToLowerInvariant() })
        if ($expectedEmail -and $actualEmail -ne $expectedEmail) {
            Write-Warning "EMAIL MISMATCH! Expected '$expectedEmail' but captured '$actualEmail'. Re-check this profile!"
            continue
        }
    }

    $nbCount = $p.notebookCount
    if ($checkOut -match "Notebooks found:\s*(\d+)") {
        $nbCount = [int]$Matches[1]
    }

    foreach ($orig in $profiles) {
        if ($orig.id -eq $p.id) {
            $orig.status = "connected"
            $orig.lastError = $null
            $orig.notebookCount = $nbCount
            $orig.lastAuthCheck = (Get-Date).ToUniversalTime().ToString("o")
        }
    }
    $profiles | ConvertTo-Json -Depth 10 | Set-Content -Path $ProfilesPath -Encoding UTF8

    $completedCount++
    if ($completedCount % 5 -eq 0 -and $idx -lt $pending.Count) {
        Write-Host ""
        Write-Host "Completed $completedCount accounts in this batch. Consider a short break to avoid Google velocity checks." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done ($completedCount authenticated). Close the Login Station Chrome window when finished." -ForegroundColor Green
