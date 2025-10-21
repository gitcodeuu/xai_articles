# PowerShell script to scrape today's data using Docker

# Get today's date
$TODAY = Get-Date -Format "yyyy-MM-dd"
$YEAR = Get-Date -Format "yyyy"
$MONTH = Get-Date -Format "MM"
$DAY = Get-Date -Format "dd"

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "🚀 Starting scraping pipeline for: $TODAY" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

# Function to show step completion
function Show-StepComplete {
    param($stepName, $duration)
    Write-Host ""
    Write-Host "✅ $stepName completed in $([math]::Round($duration, 2)) seconds" -ForegroundColor Green
    Write-Host "─────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host ""
}

# Function to show progress
function Show-Progress {
    param($message)
    Write-Host "   ⏳ $message" -ForegroundColor Yellow
}

# Step 1: Dawn - Lists and Articles
Write-Host "📰 [1/4] Scraping Dawn (lists + articles)..." -ForegroundColor Cyan
Write-Host "     Source: dawn.com/pakistan" -ForegroundColor Gray
Write-Host "     Date: $TODAY" -ForegroundColor Gray
Show-Progress "Launching browser and fetching Dawn articles..."
$step1Start = Get-Date

docker-compose run --rm scraper node run_range_dawn.js $TODAY

$step1Duration = ((Get-Date) - $step1Start).TotalSeconds
Show-StepComplete "Dawn scraping" $step1Duration

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Dawn scraping failed! Exit code: $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

# Check Dawn results
$dawnListPath = ".\data\dawn\lists\$YEAR\$MONTH\$DAY"
$dawnArticlePath = ".\data\dawn\articles\$YEAR\$MONTH\$DAY"
$dawnListCount = if (Test-Path $dawnListPath) { (Get-ChildItem -Path "$dawnListPath\*.json" -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
$dawnArticleCount = if (Test-Path $dawnArticlePath) { (Get-ChildItem -Path "$dawnArticlePath\*.json" -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
Write-Host "   📊 Dawn results: $dawnListCount list(s), $dawnArticleCount article(s)" -ForegroundColor Cyan

# Step 2: APP - Latest lists
Write-Host ""
Write-Host "📰 [2/4] Scraping APP lists (latest)..." -ForegroundColor Cyan
Write-Host "     Source: app.com.pk" -ForegroundColor Gray
Show-Progress "Fetching latest APP news list from page 1..."
$step2Start = Get-Date

docker-compose run --rm scraper node scrape_lists_app.js --latest

$step2Duration = ((Get-Date) - $step2Start).TotalSeconds
Show-StepComplete "APP lists scraping" $step2Duration

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ APP lists scraping failed! Exit code: $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

# Check APP list results
$appListPath = ".\data\app\lists"
$appListCount = if (Test-Path $appListPath) { (Get-ChildItem -Path "$appListPath\*.json" -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
Write-Host "   📊 APP list results: $appListCount list file(s)" -ForegroundColor Cyan

# Step 3: APP - Articles for today
Write-Host ""
Write-Host "📰 [3/4] Scraping APP articles for $TODAY..." -ForegroundColor Cyan
Write-Host "     Source: app.com.pk" -ForegroundColor Gray
Write-Host "     Date range: $TODAY to $TODAY" -ForegroundColor Gray
Show-Progress "Processing APP articles from today's list..."
$step3Start = Get-Date

docker-compose run --rm scraper node scrape_articles_app.js --fromDate $TODAY --toDate $TODAY

$step3Duration = ((Get-Date) - $step3Start).TotalSeconds
Show-StepComplete "APP articles scraping" $step3Duration

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ APP articles scraping failed! Exit code: $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

# Check APP article results
$appArticlePath = ".\data\app\articles\$YEAR\$MONTH\$DAY"
$appArticleCount = if (Test-Path $appArticlePath) { (Get-ChildItem -Path "$appArticlePath\*.json" -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
Write-Host "   📊 APP article results: $appArticleCount article(s)" -ForegroundColor Cyan

# Step 4: Refetch null content
Write-Host ""
Write-Host "🔄 [4/4] Refetching null/empty content..." -ForegroundColor Cyan
Write-Host "     Checking both sources for failed articles" -ForegroundColor Gray
Write-Host "     Date: $TODAY" -ForegroundColor Gray
Show-Progress "Scanning for articles with missing content..."
$step4Start = Get-Date

docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates $TODAY

$step4Duration = ((Get-Date) - $step4Start).TotalSeconds

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Refetch had some issues (exit code: $LASTEXITCODE), but continuing..." -ForegroundColor Yellow
} else {
    Show-StepComplete "Refetch process" $step4Duration
}

# Final Summary
Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "📊 Final Summary for $TODAY" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

# Recount after refetch
$dawnArticleCountFinal = if (Test-Path $dawnArticlePath) { (Get-ChildItem -Path "$dawnArticlePath\*.json" -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
$appArticleCountFinal = if (Test-Path $appArticlePath) { (Get-ChildItem -Path "$appArticlePath\*.json" -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
$totalFiles = $dawnArticleCountFinal + $appArticleCountFinal
$totalDuration = $step1Duration + $step2Duration + $step3Duration + $step4Duration

Write-Host "Source        Lists    Articles    Status" -ForegroundColor Gray
Write-Host "──────────────────────────────────────────" -ForegroundColor Gray
Write-Host "Dawn          $dawnListCount        $dawnArticleCountFinal           $(if ($dawnArticleCountFinal -gt 0) { '✅' } else { '⚠️' })" -ForegroundColor Cyan
Write-Host "APP           $appListCount        $appArticleCountFinal           $(if ($appArticleCountFinal -gt 0) { '✅' } else { '⚠️' })" -ForegroundColor Cyan
Write-Host "──────────────────────────────────────────" -ForegroundColor Gray
Write-Host "Total files:  $totalFiles" -ForegroundColor Green
Write-Host "Total time:   $([math]::Round($totalDuration, 2)) seconds ($([math]::Round($totalDuration/60, 1)) minutes)" -ForegroundColor Green
Write-Host ""

# Show file locations
Write-Host "📁 Data saved to:" -ForegroundColor Yellow
if ($dawnArticleCountFinal -gt 0) {
    Write-Host "   Dawn:  .\data\dawn\articles\$YEAR\$MONTH\$DAY\" -ForegroundColor Gray
}
if ($appArticleCountFinal -gt 0) {
    Write-Host "   APP:   .\data\app\articles\$YEAR\$MONTH\$DAY\" -ForegroundColor Gray
}
Write-Host ""

if ($totalFiles -eq 0) {
    Write-Host "⚠️  Warning: No articles were scraped. Check the sources or date range." -ForegroundColor Yellow
    Write-Host "   Possible reasons:" -ForegroundColor Gray
    Write-Host "   - No articles published on $TODAY" -ForegroundColor Gray
    Write-Host "   - Source websites may be down or blocking requests" -ForegroundColor Gray
    Write-Host "   - Network connectivity issues" -ForegroundColor Gray
} else {
    Write-Host "✅ All scraping tasks completed successfully!" -ForegroundColor Green
    Write-Host "   You can now use the scraped data for analysis." -ForegroundColor Gray
}

Write-Host ""