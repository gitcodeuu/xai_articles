// run_range_dawn.js — convenience runner to execute Dawn list+article scrapes for the same date or date range
// Examples (pnpm):
//   pnpm run dawn:range -- 2025-08-15
//   pnpm run dawn:range -- 2025-08-01:2025-08-07
// Notes:
//   • Accepts a single date (YYYY-MM-DD) or a range (YYYY-MM-DD:YYYY-MM-DD).
//   • Runs lists first, then articles for the same input.
const { main: runLists } = require('./scrape_lists_dawn')
const { main: runArticles } = require('./scrape_articles_dawn')

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: node run_range_dawn.js YYYY-MM-DD[:YYYY-MM-DD]')
    console.error('Tip: pnpm run dawn:range -- YYYY-MM-DD[:YYYY-MM-DD]')
    process.exit(1)
  }
  // Run list scraper first (builds inputs), then article scraper
  await runLists(arg)
  await runArticles(arg)
}

if (require.main === module) {
  main()
}

module.exports = { main }
