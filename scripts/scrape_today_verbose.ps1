# PowerShell script with verbose Docker output

$TODAY = Get-Date -Format "yyyy-MM-dd"

Write-Host "🚀 Starting scraping pipeline for: $TODAY" -ForegroundColor Green
Write-Host ""

# Step 1: Dawn
Write-Host "📰 [1/4] Scraping Dawn..." -ForegroundColor Cyan
docker-compose run --rm scraper node run_range_dawn.js $TODAY
Write-Host ""

# Step 2: APP Lists
Write-Host "📰 [2/4] Scraping APP lists..." -ForegroundColor Cyan
docker-compose run --rm scraper node scrape_lists_app.js --latest
Write-Host ""

# Step 3: APP Articles
Write-Host "📰 [3/4] Scraping APP articles..." -ForegroundColor Cyan
docker-compose run --rm scraper node scrape_articles_app.js --fromDate $TODAY --toDate $TODAY
Write-Host ""

# Step 4: Refetch
Write-Host "🔄 [4/4] Refetching nulls..." -ForegroundColor Cyan
docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates $TODAY
Write-Host ""

Write-Host "✅ Done!" -ForegroundColor Green