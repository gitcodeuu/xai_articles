// run_range_dawn.js — orchestrates Dawn scraping: lists then articles
// Usage:
//   node run_range_dawn.js YYYY-MM-DD [YYYY-MM-DD]
// Examples:
//   node run_range_dawn.js 2025-08-15
//   node run_range_dawn.js 2025-08-01 2025-08-07

const dayjs = require('dayjs')
const { main: scrapeLists } = require('./scrape_lists_dawn')
const { main: scrapeArticles } = require('./scrape_articles_dawn')
const { closeBrowser } = require('./utils/browser')

/**
 * Main orchestration function
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.error('Usage: node run_range_dawn.js YYYY-MM-DD [YYYY-MM-DD]')
    console.error('Examples:')
    console.error('  node run_range_dawn.js 2025-08-15')
    console.error('  node run_range_dawn.js 2025-08-01 2025-08-07')
    process.exit(1)
  }

  // Parse date arguments
  const startDate = dayjs(args[0])
  const endDate = args[1] ? dayjs(args[1]) : startDate

  if (!startDate.isValid() || !endDate.isValid()) {
    console.error('❌ Invalid date(s). Use format: YYYY-MM-DD')
    process.exit(1)
  }

  // Build date range string for scrapers
  const dateRange = endDate.isSame(startDate, 'day')
    ? startDate.format('YYYY-MM-DD')
    : `${startDate.format('YYYY-MM-DD')}:${endDate.format('YYYY-MM-DD')}`

  console.log('\n🚀 Starting Dawn scraping pipeline')
  console.log(`   Date range: ${startDate.format('YYYY-MM-DD')} to ${endDate.format('YYYY-MM-DD')}`)
  console.log('═'.repeat(50))

  try {
    // Step 1: Scrape lists
    console.log('\n[1/2] 📰 Scraping lists...')
    await scrapeLists(dateRange)
    
    // Step 2: Scrape articles
    console.log('\n[2/2] 📄 Scraping articles...')
    await scrapeArticles(dateRange)
    
    console.log('\n═'.repeat(50))
    console.log('✅ Dawn pipeline completed successfully')
    console.log('   Note: Run refetch script separately to retry failed articles')
  } catch (err) {
    console.error('\n═'.repeat(50))
    console.error('❌ Pipeline failed:', err.message)
    console.error('═'.repeat(50))
    process.exit(1)
  } finally {
    await closeBrowser()
    process.exit(0)
  }
}

if (require.main === module) {
  main()
}

module.exports = { main }