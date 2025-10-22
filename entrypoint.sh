#!/bin/bash
set -e

# Get today's date
TODAY=$(date +%Y-%m-%d)

echo "🚀 Starting automated scraping for $TODAY"


# Step 1: Dawn
echo "📰 [1/5] Scraping Dawn..."
node run_range_dawn.js "$TODAY"

# Step 2: APP Lists
echo "📰 [2/5] Scraping APP lists..."
node scrape_lists_app.js --latest

# Step 3: APP Articles
echo "📰 [3/5] Scraping APP articles..."
node scrape_articles_app.js --fromDate "$TODAY" --toDate "$TODAY"

# Step 4: Refetch nulls
echo "🔄 [4/5] Refetching null content..."
node scripts/refetch_null_content.js --source both --dates "$TODAY"

# Step 5: Upload to Azure Blob Storage
echo "☁️ [5/5] Uploading articles to Azure Blob Storage..."
node scripts/upload-to-azure.js

echo "✅ All done for $TODAY!"