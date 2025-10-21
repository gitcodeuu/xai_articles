// scrape_lists_app.js — scrapes article titles and URLs from APP's national section
// Usage:
//   node scrape_lists_app.js [--latest] [--startPage N] [--endPage N]
// Examples (pnpm):
//   pnpm run app:lists -- --latest
//   pnpm run app:lists -- --startPage 1 --endPage 5

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs-extra')
const path = require('path')
const dayjs = require('dayjs')

const { buildDatedPath, sleep, jitter } = require('./utils/helpers')
const { normalizeListArray } = require('./utils/schema')
const { createLogStream } = require('./utils/logger')
const { newPage, closeBrowser } = require('./utils/browser')

puppeteer.use(StealthPlugin())

const BASE_URL = 'https://www.app.com.pk/national'
const LIST_DIR = path.join(__dirname, 'data', 'app', 'lists')
const LOG_DIR = path.join(__dirname, 'data', 'app', 'logs')

fs.ensureDirSync(LIST_DIR)
fs.ensureDirSync(LOG_DIR)

/**
 * Creates a logger instance for APP list scraping
 * @returns {Function} Log function that writes to file and console
 */
function makeLogger() {
  return createLogStream('app_lists', { subDir: 'app/logs' })
}

/**
 * Scrapes articles from a single page
 * @param {number} pageNum - Page number to scrape
 * @param {Function} log - Logger function
 * @returns {Promise<Array>} Array of article objects
 */
async function scrapePage(pageNum, log) {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}/page/${pageNum}`
  const page = await newPage()

  try {
    await sleep(jitter(500, 1500))
    log(`🔗 Visiting: ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(jitter(1000, 2000))

    const articles = await page.evaluate(() => {
      const items = []
      const articleElements = document.querySelectorAll('article, .post, .entry')

      articleElements.forEach((article) => {
        const titleEl = article.querySelector('h2 a, h3 a, .entry-title a')
        const dateEl = article.querySelector('time, .date, .posted-on')

        if (titleEl) {
          items.push({
            title: titleEl.textContent.trim(),
            link: titleEl.href,
            publishedAt: dateEl ? dateEl.getAttribute('datetime') || dateEl.textContent.trim() : null,
          })
        }
      })

      return items
    })

    log(`🌐 Page ${pageNum} → ${articles.length} articles`)
    return articles

  } finally {
    await page.close()
  }
}

/**
 * Deduplicates and saves articles grouped by date
 * @param {Array} articles - Array of article objects
 * @param {Function} log - Logger function
 */
function saveArticlesByDate(articles, log) {
  const byDate = {}

  // Group articles by date
  articles.forEach((article) => {
    let date = null
    if (article.publishedAt) {
      const parsed = dayjs(article.publishedAt)
      if (parsed.isValid()) {
        date = parsed.format('YYYY-MM-DD')
      }
    }

    // Fallback to today's date if parsing fails
    if (!date) {
      date = dayjs().format('YYYY-MM-DD')
    }

    if (!byDate[date]) byDate[date] = []
    byDate[date].push(article)
  })

  // Save each date's articles
  Object.keys(byDate).forEach((date) => {
    const dateFolder = buildDatedPath(LIST_DIR, date)
    fs.ensureDirSync(dateFolder)
    const outPath = path.join(dateFolder, `list_${date}.json`)

    // Merge with existing articles if file exists
    const existing = fs.existsSync(outPath) ? fs.readJsonSync(outPath) : []
    const combined = [...existing, ...byDate[date]]

    // Deduplicate by link
    const seen = new Set()
    const deduped = combined.filter((item) => {
      if (seen.has(item.link)) return false
      seen.add(item.link)
      return true
    })

    const dedupedCount = combined.length - deduped.length
    if (dedupedCount > 0) {
      log(`⚠️ Deduplicated 0 photos-section and 0 removed before dedupe; ${dedupedCount} deduped for ${date}`)
    }

    const normalized = normalizeListArray(deduped)
    fs.writeJsonSync(outPath, normalized, { spaces: 2 })
    log(`✅ Saved ${normalized.length} articles for ${date} → ${outPath}`)
  })
}

/**
 * Main scraping function
 */
async function main() {
  const argv = require('minimist')(process.argv.slice(2))
  const log = makeLogger()

  const isLatest = argv.latest === true
  const startPage = parseInt(argv.startPage || '1', 10)
  const endPage = parseInt(argv.endPage || (isLatest ? '1' : '5'), 10)

  log(`🚀 Batch 1 started`)
  log(`🔢 Pages: ${startPage} to ${endPage}`)

  const allArticles = []

  // Scrape each page
  for (let p = startPage; p <= endPage; p++) {
    try {
      const articles = await scrapePage(p, log)
      allArticles.push(...articles)
      await sleep(jitter(1500, 3000))
    } catch (err) {
      log(`❌ Page ${p} failed: ${err.message}`)
    }
  }

  // Save articles grouped by date
  saveArticlesByDate(allArticles, log)
  log(`🎯 Batch 1 finished`)

  console.log('✅ All batches completed.')
  console.log('')

  await closeBrowser()
}

if (require.main === module) {
  main()
}

module.exports = { main, scrapePage, saveArticlesByDate }