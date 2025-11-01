#!/bin/bash
set -e

TODAY="${DATE:-$(date +%Y-%m-%d)}"
echo "🚀 Starting automated scraping for $TODAY"

# Step 1: Dawn (existing pipeline)
echo "📰 [1/5] Scraping Dawn..."
node run_range_dawn.js "$TODAY"

# Step 1b: Dawn Articles (force-save to data/dawn/articles/YYYY/MM/DD)
echo "📄 [1b] Scraping Dawn articles (enforced path)..."
node scrape_articles_dawn.js --fromDate "$TODAY" --toDate "$TODAY"

# Step 2: APP Lists
echo "📰 [2/5] Scraping APP lists..."
node scrape_lists_app.js --date "$TODAY"

# Step 3: APP Articles
echo "📰 [3/5] Scraping APP articles..."
node scrape_articles_app.js --fromDate "$TODAY" --toDate "$TODAY"

# Step 4: Refetch nulls
echo "🔄 [4/5] Refetching null content..."
node scripts/refetch_null_content.js --source both --dates "$TODAY"

# Step 5: Run the data cleaner service
echo "🧹 [5/5] Cleaning and transforming data..."
docker-compose run --rm data-cleaner

echo "✅ All done for $TODAY!"