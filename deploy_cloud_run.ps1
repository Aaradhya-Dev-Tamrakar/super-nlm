# Deploy Super-NLM to Google Cloud Run (24/7 Hosting)
$Host.UI.RawUI.WindowTitle = "Deploy Super-NLM to Google Cloud Run"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  🚀 Deploy Super-NLM Hub to Google Cloud Run (24/7)" -ForegroundColor White
Write-Host "=========================================================" -ForegroundColor Cyan

$gcloudCmd = Get-Command gcloud -ErrorAction SilentlyContinue

if (-not $gcloudCmd) {
    Write-Host "`n[NOTICE] Google Cloud SDK (gcloud) is not installed." -ForegroundColor Yellow
    Write-Host "Installing Google Cloud SDK via winget..." -ForegroundColor Gray
    winget install Google.CloudSDK --accept-package-agreements --accept-source-agreements
    Write-Host "`n[OK] Google Cloud SDK installed. Please restart this terminal and run deploy_cloud_run.ps1 again." -ForegroundColor Green
    exit 0
}

# Check GCP project
$currentProject = (gcloud config get-value project 2>$null)

if (-not $currentProject -or $currentProject -eq "(unset)") {
    Write-Host "`nNo default Google Cloud project set." -ForegroundColor Yellow
    Write-Host "Please authenticate and select your project:" -ForegroundColor White
    gcloud auth login
    $projectId = Read-Host "`nEnter your Google Cloud Project ID"
    gcloud config set project $projectId
} else {
    Write-Host "`nActive Google Cloud Project: $currentProject" -ForegroundColor Green
}

Write-Host "`nDeploying to Google Cloud Run in us-central1..." -ForegroundColor Cyan
Write-Host "Google Cloud will automatically build your container in the cloud.`n" -ForegroundColor Gray

gcloud run deploy super-nlm `
    --source . `
    --region us-central1 `
    --allow-unauthenticated `
    --memory 512Mi `
    --cpu 1

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n🎉 DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
    $url = (gcloud run services describe super-nlm --region us-central1 --format "value(status.url)")
    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host "  🌐 24/7 URL for Android / Web:" -ForegroundColor White
    Write-Host "  🔗 $url" -ForegroundColor Green
    Write-Host "=========================================================" -ForegroundColor Cyan
} else {
    Write-Host "`n❌ Deployment failed. Check the error output above." -ForegroundColor Red
}

Write-Host "`nPress any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
