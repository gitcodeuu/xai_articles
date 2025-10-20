// scrape_articles_dawn.js — optimized extraction for Dawn; outputs to data/dawn/articles/YYYY/MM/DD
// Usage:
//   node scrape_articles_dawn.js YYYY-MM-DD[:YYYY-MM-DD]
// Examples (pnpm):
//   pnpm run dawn:articles -- 2025-08-15
//   pnpm run dawn:articles -- 2025-08-01:2025-08-07

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const dayjs = require('dayjs')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
const customParseFormat = require('dayjs/plugin/customParseFormat')
const {
  buildDatedPath,
  fileNameFromLink,
  sleep,
  jitter,
  readJSON,
  saveJSON,
} = require('./utils/helpers')
const { normalizeArticle } = require('./utils/schema')
const { SCRAPER_CONFIG, randOf } = require('./config');
const { newPage, closeBrowser } = require('./utils/browser')

puppeteer.use(StealthPlugin())

dayjs.extend(isSameOrBefore)
dayjs.extend(customParseFormat)

const { scrapeArticleOnPage } = require('./scrapers/dawn')

const LIST_DIR = path.join(__dirname, 'data', 'dawn', 'lists')
const OUTPUT_DIR = path.join(__dirname, 'data', 'dawn', 'articles')
const LOG_DIR = path.join(__dirname, 'data', 'dawn', 'logs')
const STATS_FILE = path.join(LOG_DIR, 'stats_articles.json')
const { CONCURRENCY } = SCRAPER_CONFIG

fs.ensureDirSync(OUTPUT_DIR)
fs.ensureDirSync(LOG_DIR)

function logStream(date) {
  const ts = dayjs().format('YYYYMMDD_HHmmss')
  const file = path.join(LOG_DIR, `latest_extract_${ts}_${date}.log`)
  const stream = fs.createWriteStream(file, { flags: 'a' })
  return (msg) => {
    const line = `[${dayjs().format('HH:mm:ss')}] ${msg}`
    console.log(line)
    stream.write(line + '\n')
  }
}



// Backward-compatible: still available for external callers
async function scrapeArticleUsingBrowser(browser, url) {
  const page = await browser.newPage()
  try {
    return await scrapeArticleOnPage(page, url)
  } finally {
    try {
      await page.close({ runBeforeUnload: false })
    } catch (_) {}
  }
}

async function processList(date, stats, retryLimit = 3) {
  // Prefer dated list path; fallback to legacy flat under data/dawn/lists
  const [y, m, d] = String(date).split('-')
  const listPathNew = path.join(LIST_DIR, y, m, d, `list_${date}.json`)
  const listPathOld = path.join(LIST_DIR, `list_${date}.json`)
  const listPath = (await fs.pathExists(listPathNew))
    ? listPathNew
    : listPathOld

  const dateFolder = buildDatedPath(OUTPUT_DIR, date)
  const log = logStream(date)

  if (!(await fs.pathExists(listPath))) {
    log(`⚠️ No list found for ${date}`)
    stats[date] = { completed: false, error: 'No list found' }
    return
  }

  await fs.ensureDir(dateFolder)
  const urlData = await fs.readJson(listPath)
  const completed = new Set()
  const failed = []

  // Prepare link list, skipping already scraped ones
  const items = urlData.map((a) => ({ url: a.link, title: a.title }))
  let idx = 0

  const pages = await Promise.all(
    Array.from({ length: CONCURRENCY }).map(() => newPage())
  )

  async function worker(page) {
    while (true) {
      const i = idx++
      if (i >= items.length) break
      const { url, title } = items[i]
      const fileName = `${date}_${fileNameFromLink(url)}`
      const outPath = path.join(dateFolder, fileName)

      // Skip if already scraped
      if (await fs.pathExists(outPath)) {
        completed.add(url)
        log(`⏭️ Skipped (exists): ${fileName}`)
        continue
      }

      let lastError = null
      for (let attempt = 1; attempt <= retryLimit; attempt++) {
        try {
          log(`🔎 [${date}] ${url} (try ${attempt})`)
          const article = await scrapeArticleOnPage(page, url)

          const retrievedAt = dayjs().toISOString()
          const finalArticle = {
            title: article.title || title,
            author: article.author,
            content: article.content,
            tags: article.tags,
            categories: article.categories,
            image: article.image,
            retrievedAt,
            source: 'Dawn',
            link: url,
            dateList: date,
            date_published:
              article.published && dayjs(article.published).isValid()
                ? dayjs(article.published).toISOString()
                : null,
          }

          await fs.writeJson(outPath, normalizeArticle(finalArticle), {
            spaces: 2,
          })
          completed.add(url)
          log(`✅ Saved: ${fileName}`)
          lastError = null
          break // success
        } catch (err) {
          lastError = err
          log(`❌ Failed (try ${attempt}): ${url} - ${err.message}`)
        }
      }
      if (lastError) {
        failed.push(url)
        log(`🛑 Giving up: ${url} - ${lastError.message}`)
      }
    }
  }

  await Promise.all(pages.map(worker))

  stats[date] = { completed: failed.length === 0, failed }
  log(`📦 [${date}] Completed: ${completed.size}, Failed: ${failed.length}`)
}

async function main(arg) {
  // Accept either a single combined arg or multiple args (e.g., "2025-08-15", ":2025-08-01")
  const rawArgs = arg ? [String(arg)] : process.argv.slice(2).map(String)
  const joined = rawArgs
    .join('') // join without spaces to allow "A : B"
    .replace(/\s+/g, '') // remove any whitespace just in case
    .trim()

  if (!joined) {
    console.error('Usage: node scrape_articles_dawn.js YYYY-MM-DD[:YYYY-MM-DD]')
    process.exit(1)
  }

  const parts = joined.includes(':') ? joined.split(':') : [joined, joined]
  if (parts.length > 2) {
    console.error('❌ Invalid input. Use YYYY-MM-DD or YYYY-MM-DD:YYYY-MM-DD')
    process.exit(1)
  }

  let start = dayjs(String(parts[0]).trim(), 'YYYY-MM-DD')
  let end = dayjs(String(parts[1] ?? parts[0]).trim(), 'YYYY-MM-DD')

  if (!start.isValid() || !end.isValid()) {
    console.error('❌ Invalid date format. Use YYYY-MM-DD[:YYYY-MM-DD]')
    process.exit(1)
  }

  // Normalize reversed ranges
  if (start.isAfter(end)) {
    const tmp = start
    start = end
    end = tmp
    console.log(
      `ℹ️ Swapped date range to ascending: ${start.format('YYYY-MM-DD')} : ${end.format('YYYY-MM-DD')}`
    )
  }

  const stats = fs.existsSync(STATS_FILE) ? await fs.readJson(STATS_FILE) : {}

  const dates = []
  let current = start
  while (current.isSameOrBefore(end)) {
    dates.push(current.format('YYYY-MM-DD'))
    current = current.add(1, 'day')
  }

  for (const date of dates) {
    await processList(date, stats)
    await fs.writeJson(STATS_FILE, stats, { spaces: 2 })
    // human-like pause between dates
    await sleep(jitter(1500, 4000))
  }

  const months = [...new Set(dates.map((d) => d.substring(0, 7)))].join(',')
  console.log('\n🚀 Starting content refetch process for DAWN source...')
  try {
    const { run: refetchNullContent } = require('./scripts/refetch_null_content')
    const refetchArgs = ['--source', 'dawn']
    if (months) {
      refetchArgs.push('--months', months)
    }
    await refetchNullContent({ argv: refetchArgs })
    console.log('✅ Content refetch process for DAWN source completed.')
  } catch (err) {
    console.error('❌ Content refetch process for DAWN source failed:', err)
  } finally {
    await closeBrowser()
  }
}

if (require.main === module) {
  main()
}

module.exports = { main, processList, scrapeArticleOnPage }
