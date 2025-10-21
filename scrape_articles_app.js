// scrape_articles_app.js — scrapes full article content from APP using list files
// Usage:
//   node scrape_articles_app.js --fromDate YYYY-MM-DD [--toDate YYYY-MM-DD]
// Examples (pnpm):
//   pnpm run app:articles -- --fromDate 2025-08-15
//   pnpm run app:articles -- --fromDate 2025-08-01 --toDate 2025-08-07

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs-extra')
const path = require('path')
const dayjs = require('dayjs')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
const crypto = require('crypto')

const { buildDatedPath, sleep, jitter, chunkArray } = require('./utils/helpers')
const { normalizeArticle } = require('./utils/schema')
const { createLogStream } = require('./utils/logger')
const { newPage, closeBrowser } = require('./utils/browser')

puppeteer.use(StealthPlugin())
dayjs.extend(isSameOrBefore)

const LIST_DIR = path.join(__dirname, 'data', 'app', 'lists')
const ARTICLE_DIR = path.join(__dirname, 'data', 'app', 'articles')
const LOG_DIR = path.join(__dirname, 'data', 'app', 'logs')
const CONCURRENCY = 8

fs.ensureDirSync(ARTICLE_DIR)
fs.ensureDirSync(LOG_DIR)

/**
 * Creates a logger instance for APP article scraping
 * @returns {Function} Log function that writes to file and console
 */
function makeLogger() {
  return createLogStream('app_articles', { subDir: 'app/logs' })
}

/**
 * Generates a unique filename hash from URL
 * @param {string} url - Article URL
 * @returns {string} MD5 hash of the URL
 */
function hashFilename(url) {
  return crypto.createHash('md5').update(url).digest('hex')
}

/**
 * Scrapes full content from a single article
 * @param {Object} item - Article metadata from list file
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Function} log - Logger function
 * @returns {Promise<Object>} Result object with status
 */
async function scrapeArticle(item, date, log) {
  const { link, title } = item
  const hash = hashFilename(link)
  const filename = `${date}_${hash}.json`

  const dateFolder = buildDatedPath(ARTICLE_DIR, date)
  await fs.ensureDir(dateFolder)
  const outPath = path.join(dateFolder, filename)

  // Skip if already exists
  if (await fs.pathExists(outPath)) {
    return { status: 'skipped', filename }
  }

  const page = await newPage()

  try {
    await sleep(jitter(300, 1000))
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(jitter(800, 1500))

    // Extract article content
    const content = await page.evaluate(() => {
      const contentEl = document.querySelector('.entry-content, article .content, .post-content')
      if (!contentEl) return null

      // Remove unwanted elements
      const unwanted = contentEl.querySelectorAll(
        'script, style, .social-share, .advertisement, .related-posts'
      )
      unwanted.forEach((el) => el.remove())

      return contentEl.innerText.trim()
    })

    // Build complete article object
    const article = normalizeArticle({
      ...item,
      content: content || '',
      scrapedAt: new Date().toISOString(),
    })

    await fs.writeJson(outPath, article, { spaces: 2 })
    log(`✅ Saved: ${filename}`)

    return { status: 'success', filename }
  } catch (err) {
    log(`❌ Failed: ${title.substring(0, 50)}... - ${err.message}`)
    return { status: 'failed', filename, error: err.message }
  } finally {
    await page.close()
  }
}

/**
 * Processes articles for a single date
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Function} log - Logger function
 */
async function processDate(date, log) {
  const listPath = path.join(buildDatedPath(LIST_DIR, date), `list_${date}.json`)

  if (!(await fs.pathExists(listPath))) {
    log(`⚠️ List file not found: ${listPath}`)
    return
  }

  const items = await fs.readJson(listPath)
  log(`[📅 Processing LIST for: ${date}]`)

  const results = { success: 0, skipped: 0, failed: 0 }

  // Process articles in batches for concurrency control
  for (const batch of chunkArray(items, CONCURRENCY)) {
    await Promise.all(
      batch.map(async (item) => {
        const result = await scrapeArticle(item, date, log)
        results[result.status]++
      })
    )
    await sleep(jitter(1000, 2000))
  }

  log(`🎯 Finished ${date}`)
}

/**
 * Main entry point for the scraper
 */
async function main() {
  const argv = require('minimist')(process.argv.slice(2))
  const log = makeLogger()

  const fromDate = argv.fromDate
  const toDate = argv.toDate || fromDate

  if (!fromDate) {
    console.error('Usage: node scrape_articles_app.js --fromDate YYYY-MM-DD [--toDate YYYY-MM-DD]')
    console.error('Examples:')
    console.error('  node scrape_articles_app.js --fromDate 2025-08-15')
    console.error('  node scrape_articles_app.js --fromDate 2025-08-01 --toDate 2025-08-07')
    process.exit(1)
  }

  const start = dayjs(fromDate)
  const end = dayjs(toDate)

  if (!start.isValid() || !end.isValid()) {
    console.error('❌ Invalid date format. Use YYYY-MM-DD')
    process.exit(1)
  }

  // Build list of dates to process
  const dates = []
  let current = start
  while (current.isSameOrBefore(end)) {
    dates.push(current.format('YYYY-MM-DD'))
    current = current.add(1, 'day')
  }

  // Process each date
  for (const date of dates) {
    await processDate(date, log)
  }

  console.log('✅ APP article scraping completed.')

  await closeBrowser()
}

if (require.main === module) {
  main()
}

module.exports = { main, processDate, scrapeArticle }