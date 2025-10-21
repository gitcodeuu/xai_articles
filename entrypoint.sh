#!/bin/bash
set -e

# Get today's date
TODAY=$(date +%Y-%m-%d)

echo "🚀 Starting automated scraping for $TODAY"

# Step 1: Dawn
echo "📰 [1/4] Scraping Dawn..."
node run_range_dawn.js "$TODAY"

# Step 2: APP Lists
echo "📰 [2/4] Scraping APP lists..."
node scrape_lists_app.js --latest

# Step 3: APP Articles
echo "📰 [3/4] Scraping APP articles..."
node scrape_articles_app.js --fromDate "$TODAY" --toDate "$TODAY"

# Step 4: Refetch nulls
echo "🔄 [4/4] Refetching null content..."
node scripts/refetch_null_content.js --source both --dates "$TODAY"

echo "✅ All done for $TODAY!"