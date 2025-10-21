# Debug version - shows exactly what's happening

$TODAY = Get-Date -Format "yyyy-MM-dd"

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "🚀 DEBUG MODE - Scraping for: $TODAY" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

# Step 1: Dawn
Write-Host "📰 [1/4] Starting Dawn scraping..." -ForegroundColor Cyan
Write-Host "Command: docker-compose run --rm scraper node run_range_dawn.js $TODAY" -ForegroundColor Gray
Write-Host ""

$dawn_start = Get-Date
docker-compose run --rm scraper node run_range_dawn.js $TODAY
$dawn_exit = $LASTEXITCODE
$dawn_duration = ((Get-Date) - $dawn_start).TotalSeconds

Write-Host ""
Write-Host "Dawn completed - Exit code: $dawn_exit - Duration: $dawn_duration seconds" -ForegroundColor $(if ($dawn_exit -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($dawn_exit -ne 0) {
    Write-Host "❌ Dawn failed, stopping pipeline" -ForegroundColor Red
    exit $dawn_exit
}

Start-Sleep -Seconds 2
Write-Host "Continuing to next step..." -ForegroundColor Yellow
Write-Host ""

# Step 2: APP Lists
Write-Host "📰 [2/4] Starting APP lists scraping..." -ForegroundColor Cyan
Write-Host "Command: docker-compose run --rm scraper node scrape_lists_app.js --latest" -ForegroundColor Gray
Write-Host ""

$app_lists_start = Get-Date
docker-compose run --rm scraper node scrape_lists_app.js --latest
$app_lists_exit = $LASTEXITCODE
$app_lists_duration = ((Get-Date) - $app_lists_start).TotalSeconds

Write-Host ""
Write-Host "APP Lists completed - Exit code: $app_lists_exit - Duration: $app_lists_duration seconds" -ForegroundColor $(if ($app_lists_exit -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($app_lists_exit -ne 0) {
    Write-Host "❌ APP Lists failed, stopping pipeline" -ForegroundColor Red
    exit $app_lists_exit
}

Start-Sleep -Seconds 2
Write-Host "Continuing to next step..." -ForegroundColor Yellow
Write-Host ""

# Step 3: APP Articles
Write-Host "📰 [3/4] Starting APP articles scraping..." -ForegroundColor Cyan
Write-Host "Command: docker-compose run --rm scraper node scrape_articles_app.js --fromDate $TODAY --toDate $TODAY" -ForegroundColor Gray
Write-Host ""

$app_articles_start = Get-Date
docker-compose run --rm scraper node scrape_articles_app.js --fromDate $TODAY --toDate $TODAY
$app_articles_exit = $LASTEXITCODE
$app_articles_duration = ((Get-Date) - $app_articles_start).TotalSeconds

Write-Host ""
Write-Host "APP Articles completed - Exit code: $app_articles_exit - Duration: $app_articles_duration seconds" -ForegroundColor $(if ($app_articles_exit -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($app_articles_exit -ne 0) {
    Write-Host "❌ APP Articles failed, stopping pipeline" -ForegroundColor Red
    exit $app_articles_exit
}

Start-Sleep -Seconds 2
Write-Host "Continuing to next step..." -ForegroundColor Yellow
Write-Host ""

# Step 4: Refetch
Write-Host "🔄 [4/4] Starting refetch process..." -ForegroundColor Cyan
Write-Host "Command: docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates $TODAY" -ForegroundColor Gray
Write-Host ""

$refetch_start = Get-Date
docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates $TODAY
$refetch_exit = $LASTEXITCODE
$refetch_duration = ((Get-Date) - $refetch_start).TotalSeconds

Write-Host ""
Write-Host "Refetch completed - Exit code: $refetch_exit - Duration: $refetch_duration seconds" -ForegroundColor $(if ($refetch_exit -eq 0) { "Green" } else { "Yellow" })
Write-Host ""

# Summary
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "✅ PIPELINE COMPLETED" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "Step 1 (Dawn):         $([math]::Round($dawn_duration, 2))s - Exit: $dawn_exit" -ForegroundColor Cyan
Write-Host "Step 2 (APP Lists):    $([math]::Round($app_lists_duration, 2))s - Exit: $app_lists_exit" -ForegroundColor Cyan
Write-Host "Step 3 (APP Articles): $([math]::Round($app_articles_duration, 2))s - Exit: $app_articles_exit" -ForegroundColor Cyan
Write-Host "Step 4 (Refetch):      $([math]::Round($refetch_duration, 2))s - Exit: $refetch_exit" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total duration: $([math]::Round($dawn_duration + $app_lists_duration + $app_articles_duration + $refetch_duration, 2)) seconds" -ForegroundColor Green
Write-Host ""