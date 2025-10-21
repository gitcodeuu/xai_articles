/**
 * Help system for xai_articles scraping project
 * Provides command documentation and usage examples
 */

const chalk = require('chalk')

/**
 * Display general help information
 */
function showGeneralHelp() {
  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'))
  console.log(chalk.bold.cyan('  XAI Articles Scraper - Help Documentation'))
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'))

  console.log(chalk.yellow('OVERVIEW:'))
  console.log('  This project scrapes articles from Dawn and APP news sources.')
  console.log('  It uses Puppeteer with Chromium in Docker for reliable scraping.\n')

  console.log(chalk.yellow('QUICK START:'))
  console.log(chalk.green('  # Build Docker image'))
  console.log('  pnpm run docker:build\n')
  
  console.log(chalk.green('  # Run automated daily scrape'))
  console.log('  docker-compose run --rm scraper-daily\n')
  
  console.log(chalk.green('  # Or use PowerShell helper'))
  console.log('  .\\scripts\\scrape_today_verbose.ps1\n')

  console.log(chalk.yellow('MAIN COMMANDS:'))
  console.log(chalk.white('  node help.js [command]         ') + '- Show detailed help for a command')
  console.log(chalk.white('  node help.js dawn              ') + '- Help for Dawn scraping')
  console.log(chalk.white('  node help.js app               ') + '- Help for APP scraping')
  console.log(chalk.white('  node help.js refetch           ') + '- Help for refetch utility')
  console.log(chalk.white('  node help.js docker            ') + '- Help for Docker commands')
  console.log(chalk.white('  node help.js pipeline          ') + '- Help for automated pipeline\n')

  console.log(chalk.yellow('EXAMPLES:'))
  console.log(chalk.green('  # Scrape today\'s Dawn articles'))
  console.log('  docker-compose run --rm scraper node run_range_dawn.js $(date +%Y-%m-%d)\n')
  
  console.log(chalk.green('  # Scrape APP articles for a date range'))
  console.log('  docker-compose run --rm scraper node scrape_articles_app.js --fromDate 2025-10-15 --toDate 2025-10-21\n')
  
  console.log(chalk.green('  # Refetch failed articles'))
  console.log('  docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates 2025-10-21\n')

  console.log(chalk.yellow('PROJECT STRUCTURE:'))
  console.log('  data/                          - Scraped articles and lists')
  console.log('  ├── dawn/                      - Dawn newspaper content')
  console.log('  │   ├── lists/YYYY/MM/DD/      - Article lists by date')
  console.log('  │   └── articles/YYYY/MM/DD/   - Full article content')
  console.log('  └── app/                       - APP news content')
  console.log('      ├── lists/YYYY/MM/DD/      - Article lists by date')
  console.log('      └── articles/YYYY/MM/DD/   - Full article content\n')

  console.log(chalk.yellow('MORE INFO:'))
  console.log('  Run ' + chalk.cyan('node help.js <command>') + ' for detailed help on specific commands.\n')
}

/**
 * Display Dawn scraping help
 */
function showDawnHelp() {
  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'))
  console.log(chalk.bold.cyan('  Dawn Scraper Commands'))
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'))

  console.log(chalk.yellow('OVERVIEW:'))
  console.log('  Scrapes articles from Dawn.com Pakistan section.\n')

  console.log(chalk.yellow('COMMANDS:\n'))

  console.log(chalk.white('1. run_range_dawn.js - Full pipeline (lists + articles)'))
  console.log('   Usage: node run_range_dawn.js YYYY-MM-DD [YYYY-MM-DD]')
  console.log('   Examples:')
  console.log(chalk.green('     node run_range_dawn.js 2025-10-21'))
  console.log(chalk.green('     node run_range_dawn.js 2025-10-15 2025-10-21'))
  console.log(chalk.green('     docker-compose run --rm scraper node run_range_dawn.js 2025-10-21\n'))

  console.log(chalk.white('2. scrape_lists_dawn.js - Scrape article lists only'))
  console.log('   Usage: node scrape_lists_dawn.js YYYY-MM-DD[:YYYY-MM-DD]')
  console.log('   Examples:')
  console.log(chalk.green('     node scrape_lists_dawn.js 2025-10-21'))
  console.log(chalk.green('     node scrape_lists_dawn.js 2025-10-15:2025-10-21'))
  console.log(chalk.green('     pnpm run dawn:lists -- 2025-10-21\n'))

  console.log(chalk.white('3. scrape_articles_dawn.js - Scrape full article content'))
  console.log('   Usage: node scrape_articles_dawn.js YYYY-MM-DD[:YYYY-MM-DD]')
  console.log('   Examples:')
  console.log(chalk.green('     node scrape_articles_dawn.js 2025-10-21'))
  console.log(chalk.green('     node scrape_articles_dawn.js 2025-10-15:2025-10-21'))
  console.log(chalk.green('     pnpm run dawn:articles -- 2025-10-21\n'))

  console.log(chalk.yellow('OUTPUT:'))
  console.log('  Lists:    data/dawn/lists/YYYY/MM/DD/list_YYYY-MM-DD.json')
  console.log('  Articles: data/dawn/articles/YYYY/MM/DD/*.json')
  console.log('  Logs:     data/dawn/logs/\n')

  console.log(chalk.yellow('NOTES:'))
  console.log('  - Lists must be scraped before articles')
  console.log('  - run_range_dawn.js handles both steps automatically')
  console.log('  - Refetch is now a separate step (see: node help.js refetch)\n')
}

/**
 * Display APP scraping help
 */
function showAppHelp() {
  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'))
  console.log(chalk.bold.cyan('  APP Scraper Commands'))
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'))

  console.log(chalk.yellow('OVERVIEW:'))
  console.log('  Scrapes articles from APP.com.pk national section.\n')

  console.log(chalk.yellow('COMMANDS:\n'))

  console.log(chalk.white('1. scrape_lists_app.js - Scrape article lists'))
  console.log('   Usage: node scrape_lists_app.js [--latest] [--startPage N] [--endPage N]')
  console.log('   Options:')
  console.log('     --latest       Scrape only the first page (default: pages 1-5)')
  console.log('     --startPage N  Start from page N (default: 1)')
  console.log('     --endPage N    End at page N (default: 5)')
  console.log('   Examples:')
  console.log(chalk.green('     node scrape_lists_app.js --latest'))
  console.log(chalk.green('     node scrape_lists_app.js --startPage 1 --endPage 10'))
  console.log(chalk.green('     pnpm run app:lists -- --latest'))
  console.log(chalk.green('     docker-compose run --rm scraper node scrape_lists_app.js --latest\n'))

  console.log(chalk.white('2. scrape_articles_app.js - Scrape full article content'))
  console.log('   Usage: node scrape_articles_app.js --fromDate YYYY-MM-DD [--toDate YYYY-MM-DD]')
  console.log('   Examples:')
  console.log(chalk.green('     node scrape_articles_app.js --fromDate 2025-10-21'))
  console.log(chalk.green('     node scrape_articles_app.js --fromDate 2025-10-15 --toDate 2025-10-21'))
  console.log(chalk.green('     pnpm run app:articles -- --fromDate 2025-10-21'))
  console.log(chalk.green('     docker-compose run --rm scraper node scrape_articles_app.js --fromDate 2025-10-21\n'))

  console.log(chalk.yellow('OUTPUT:'))
  console.log('  Lists:    data/app/lists/YYYY/MM/DD/list_YYYY-MM-DD.json')
  console.log('  Articles: data/app/articles/YYYY/MM/DD/YYYY-MM-DD_<hash>.json')
  console.log('  Logs:     data/app/logs/\n')

  console.log(chalk.yellow('NOTES:'))
  console.log('  - Lists must be scraped before articles')
  console.log('  - Articles are deduplicated by URL hash')
  console.log('  - Use --latest for daily automated scraping')
  console.log('  - Concurrency is set to 8 parallel article scrapes\n')
}

/**
 * Display refetch utility help
 */
function showRefetchHelp() {
  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'))
  console.log(chalk.bold.cyan('  Refetch Null Content Utility'))
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'))

  console.log(chalk.yellow('OVERVIEW:'))
  console.log('  Re-scrapes articles that have null or empty content.')
  console.log('  Runs as a separate step after initial scraping.\n')

  console.log(chalk.yellow('USAGE:'))
  console.log('  node scripts/refetch_null_content.js [options]\n')

  console.log(chalk.yellow('OPTIONS:'))
  console.log(chalk.white('  --source <dawn|app|both>  ') + '- Source to refetch (default: both)')
  console.log(chalk.white('  --dates <YYYY-MM-DD>      ') + '- Specific date to process')
  console.log(chalk.white('  --concurrency <N>         ') + '- Parallel workers (default: 2)')
  console.log(chalk.white('  --retry <N>               ') + '- Max retry attempts (default: 2)')
  console.log(chalk.white('  --dry                     ') + '- Dry run (no actual refetch)\n')

  console.log(chalk.yellow('EXAMPLES:'))
  console.log(chalk.green('  # Refetch both sources for today'))
  console.log('  node scripts/refetch_null_content.js --source both --dates 2025-10-21\n')

  console.log(chalk.green('  # Refetch only Dawn with higher concurrency'))
  console.log('  node scripts/refetch_null_content.js --source dawn --dates 2025-10-21 --concurrency 4\n')

  console.log(chalk.green('  # Dry run to see what would be refetched'))
  console.log('  node scripts/refetch_null_content.js --source both --dates 2025-10-21 --dry\n')

  console.log(chalk.green('  # Docker command'))
  console.log('  docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates 2025-10-21\n')

  console.log(chalk.yellow('OUTPUT:'))
  console.log('  Progress: data/progress/refetch_nulls/<source>_<YYYY-MM>.json')
  console.log('  Summary:  data/progress/refetch_nulls/last_run.json\n')

  console.log(chalk.yellow('NOTES:'))
  console.log('  - Only processes articles with content < 50 characters')
  console.log('  - Updates articles in-place with refetched flag')
  console.log('  - Run after initial scraping completes')
  console.log('  - Safe to run multiple times (skips already valid content)\n')
}

/**
 * Display Docker commands help
 */
function showDockerHelp() {
  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'))
  console.log(chalk.bold.cyan('  Docker Commands'))
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'))

  console.log(chalk.yellow('SETUP:\n'))
  
  console.log(chalk.white('1. Build Docker image'))
  console.log(chalk.green('   pnpm run docker:build'))
  console.log(chalk.green('   # or'))
  console.log(chalk.green('   docker-compose build\n'))

  console.log(chalk.yellow('SERVICES:\n'))

  console.log(chalk.white('1. scraper - Manual commands (persistent container)'))
  console.log(chalk.green('   # Start container'))
  console.log('   docker-compose up -d scraper\n')
  console.log(chalk.green('   # Execute command in running container'))
  console.log('   docker-compose exec scraper node run_range_dawn.js 2025-10-21\n')
  console.log(chalk.green('   # One-off command (auto-removes container)'))
  console.log('   docker-compose run --rm scraper node run_range_dawn.js 2025-10-21\n')

  console.log(chalk.white('2. scraper-daily - Automated daily pipeline (one-shot)'))
  console.log(chalk.green('   # Run complete pipeline for today'))
  console.log('   docker-compose run --rm scraper-daily\n')
  console.log(chalk.green('   # Build and run'))
  console.log('   docker-compose up --build scraper-daily\n')

  console.log(chalk.yellow('COMMON OPERATIONS:\n'))

  console.log(chalk.green('  # View logs'))
  console.log('  docker-compose logs -f scraper')
  console.log('  docker-compose logs -f scraper-daily\n')

  console.log(chalk.green('  # Stop containers'))
  console.log('  docker-compose down\n')

  console.log(chalk.green('  # Remove volumes'))
  console.log('  docker-compose down -v\n')

  console.log(chalk.green('  # Rebuild after code changes'))
  console.log('  docker-compose build --no-cache\n')

  console.log(chalk.yellow('RESOURCE LIMITS:'))
  console.log('  CPU:    2 cores max, 1 core reserved')
  console.log('  Memory: 4GB max, 2GB reserved')
  console.log('  Adjust in docker-compose.yml if needed\n')

  console.log(chalk.yellow('TROUBLESHOOTING:\n'))

  console.log(chalk.green('  # Check if container is running'))
  console.log('  docker ps\n')

  console.log(chalk.green('  # View container logs'))
  console.log('  docker logs xai_scraper\n')

  console.log(chalk.green('  # Enter container shell'))
  console.log('  docker-compose exec scraper /bin/bash\n')

  console.log(chalk.green('  # Clean up everything'))
  console.log('  docker-compose down --volumes --remove-orphans')
  console.log('  docker system prune -a\n')
}

/**
 * Display pipeline help
 */
function showPipelineHelp() {
  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'))
  console.log(chalk.bold.cyan('  Automated Pipeline'))
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'))

  console.log(chalk.yellow('OVERVIEW:'))
  console.log('  The pipeline runs 4 steps to scrape today\'s articles from both sources.\n')

  console.log(chalk.yellow('PIPELINE STEPS:\n'))
  console.log(chalk.white('  [1/4] Dawn Lists + Articles  ') + '- Scrapes Dawn.com Pakistan section')
  console.log(chalk.white('  [2/4] APP Lists              ') + '- Scrapes APP.com.pk national section')
  console.log(chalk.white('  [3/4] APP Articles           ') + '- Downloads full APP article content')
  console.log(chalk.white('  [4/4] Refetch Nulls          ') + '- Retries failed/empty articles\n')

  console.log(chalk.yellow('METHODS:\n'))

  console.log(chalk.white('1. Docker Compose (Recommended)'))
  console.log(chalk.green('   docker-compose run --rm scraper-daily\n'))

  console.log(chalk.white('2. PowerShell Script'))
  console.log(chalk.green('   .\\scripts\\scrape_today_verbose.ps1\n'))

  console.log(chalk.white('3. Manual Steps (for debugging)'))
  console.log(chalk.green('   docker-compose run --rm scraper node run_range_dawn.js $(date +%Y-%m-%d)'))
  console.log(chalk.green('   docker-compose run --rm scraper node scrape_lists_app.js --latest'))
  console.log(chalk.green('   docker-compose run --rm scraper node scrape_articles_app.js --fromDate $(date +%Y-%m-%d)'))
  console.log(chalk.green('   docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates $(date +%Y-%m-%d)\n'))

  console.log(chalk.yellow('SCHEDULING:'))
  console.log('  You can schedule the pipeline to run daily using:\n')
  console.log(chalk.white('  Windows Task Scheduler:'))
  console.log(chalk.green('   - Create task to run: powershell.exe -File "D:\\path\\scripts\\scrape_today_verbose.ps1"'))
  console.log(chalk.green('   - Set trigger: Daily at desired time\n'))
  
  console.log(chalk.white('  Linux Cron:'))
  console.log(chalk.green('   0 2 * * * cd /path/to/project && docker-compose run --rm scraper-daily\n'))

  console.log(chalk.yellow('MONITORING:'))
  console.log('  Check output in:')
  console.log('  - data/dawn/logs/')
  console.log('  - data/app/logs/')
  console.log('  - data/progress/refetch_nulls/last_run.json\n')

  console.log(chalk.yellow('NOTES:'))
  console.log('  - Pipeline runs automatically for today\'s date')
  console.log('  - Each step depends on the previous step\'s output')
  console.log('  - Refetch runs last to catch any failed scrapes')
  console.log('  - Container auto-removes after completion\n')
}

/**
 * Main help router
 */
function main() {
  const args = process.argv.slice(2)
  const command = args[0]?.toLowerCase()

  switch (command) {
    case 'dawn':
      showDawnHelp()
      break
    case 'app':
      showAppHelp()
      break
    case 'refetch':
      showRefetchHelp()
      break
    case 'docker':
      showDockerHelp()
      break
    case 'pipeline':
      showPipelineHelp()
      break
    default:
      showGeneralHelp()
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  showGeneralHelp,
  showDawnHelp,
  showAppHelp,
  showRefetchHelp,
  showDockerHelp,
  showPipelineHelp
}