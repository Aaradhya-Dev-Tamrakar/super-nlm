# Tailscale Remote Access Setup for Super-NLM Hub
$Host.UI.RawUI.WindowTitle = "Tailscale Setup for Super-NLM"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  Tailscale Private Mesh Setup for Super-NLM Hub" -ForegroundColor White
Write-Host "=========================================================" -ForegroundColor Cyan

$tailscaleCmd = Get-Command tailscale -ErrorAction SilentlyContinue

if (-not $tailscaleCmd) {
    Write-Host "`nTailscale is not currently installed on this system." -ForegroundColor Yellow
    Write-Host "Installing Tailscale via Windows Package Manager (winget)..." -ForegroundColor Gray
    winget install Tailscale.Tailscale --accept-package-agreements --accept-source-agreements
    Write-Host "`nPlease restart your terminal or launch Tailscale from your Windows Start Menu to log in." -ForegroundColor Green
    exit 0
}

Write-Host "`n[OK] Tailscale is installed!" -ForegroundColor Green

try {
    $ip = (tailscale ip -4).Trim()
    $status = (tailscale status --json | ConvertFrom-Json)
    $selfNode = $status.Self
    $dnsName = $selfNode.DNSName.TrimEnd('.')

    Write-Host "`nYour Private Tailscale Information:" -ForegroundColor White
    Write-Host "  IP Address : $ip" -ForegroundColor Cyan
    Write-Host "  MagicDNS   : $dnsName" -ForegroundColor Cyan

    Write-Host "`nHow to access Super-NLM from your phone/tablet/laptop:" -ForegroundColor Yellow
    Write-Host "  1. Install the Tailscale app on your other device (iOS / Android / Mac / PC)."
    Write-Host "  2. Sign in with the same Tailscale account."
    Write-Host "  3. Open your browser on that device and navigate to:"
    Write-Host "     http://${dnsName}:8000" -ForegroundColor Green
    Write-Host "     or"
    Write-Host "     http://${ip}:8000" -ForegroundColor Green
} catch {
    Write-Host "`nTailscale is installed but may not be logged in or connected." -ForegroundColor Yellow
    Write-Host "Run 'tailscale up' or open the Tailscale desktop client from your system tray to connect." -ForegroundColor Gray
}

Write-Host "`nPress any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
