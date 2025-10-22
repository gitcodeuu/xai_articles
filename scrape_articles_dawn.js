// scrape_articles_dawn.js — scrapes full article content from Dawn using list files
// Usage:
//   node scrape_articles_dawn.js YYYY-MM-DD[:YYYY-MM-DD]
// Examples (pnpm):
//   pnpm run dawn:articles -- 2025-08-15
//   pnpm run dawn:articles -- 2025-08-01:2025-08-07

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto')
const dayjs = require('dayjs')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
const customParseFormat = require('dayjs/plugin/customParseFormat')

const { buildDatedPath, sleep, jitter, chunkArray } = require('./utils/helpers')
const { normalizeArticle } = require('./utils/schema')
const { createLogStream } = require('./utils/logger')
const { newPage, closeBrowser } = require('./utils/browser')

puppeteer.use(StealthPlugin())
dayjs.extend(isSameOrBefore)
dayjs.extend(customParseFormat)

const LIST_DIR = path.join(__dirname, 'data', 'dawn', 'lists')
const ARTICLE_DIR = path.join(__dirname, 'data', 'dawn', 'articles')
const LOG_DIR = path.join(__dirname, 'data', 'dawn', 'logs')
const BATCH_SIZE = 3
const STATS_FILE = path.join(LOG_DIR, 'stats_articles.json')

fs.ensureDirSync(ARTICLE_DIR)
fs.ensureDirSync(LOG_DIR)

/**
 * Creates a logger instance specifically for Dawn article scraping
 * @returns {Function} Log function that writes to file and console
 */
function makeLogger() {
  const log = createLogStream('dawn_articles', { subDir: 'dawn/logs' })
  return log
}

/**
 * Generate MD5 hash from URL for filename
 * @param {string} url - Article URL
 * @returns {string} MD5 hash
 */
function generateFilenameHash(url) {
  return crypto.createHash('md5').update(url).digest('hex')
}

/**
 * Scrapes full content from a single article
 * @param {Object} item - Article metadata from list file
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Function} log - Logger function
 * @returns {Promise<boolean>} Success status
 */
async function scrapeArticle(item, date, log) {
  const { link, title } = item
  
  // Generate filename from URL hash
  const hash = generateFilenameHash(link)
  const dateFolder = buildDatedPath(ARTICLE_DIR, date)
  await fs.ensureDir(dateFolder)
  const outPath = path.join(dateFolder, `${date}_${hash}.json`)

  // Skip if already scraped
  if (await fs.pathExists(outPath)) {
    log(`⏭️  [${date}] Already exists: ${date}_${hash}.json`)
    return true
  }

  const page = await newPage()

  try {
    await sleep(jitter(500, 1500))
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(jitter(1000, 2000))

    // Extract article content and metadata from the page
    const scrapedData = await page.evaluate(() => {
      const story = document.querySelector('.story__content, .story')
      let content = null
      
      if (story) {
        // Remove unwanted elements
        const unwanted = story.querySelectorAll(
          'script, style, .social-share, .related-stories, .advertisement'
        )
        unwanted.forEach((el) => el.remove())
        content = story.innerText.trim()
      }

      // Extract published date
      let datePublished = null
      const dateElement = document.querySelector('time[datetime]') ||
                         document.querySelector('.story__time') ||
                         document.querySelector('.timestamp')
      
      if (dateElement) {
        const datetime = dateElement.getAttribute('datetime')
        if (datetime) {
          try {
            const parsed = new Date(datetime)
            if (!isNaN(parsed.getTime())) {
              datePublished = parsed.toISOString()
            }
          } catch (e) {
            // Will use listDate as fallback
          }
        }
      }

      // Extract author
      const authorElement = document.querySelector('.story__byline a') ||
                           document.querySelector('.author__name') ||
                           document.querySelector('[rel="author"]')
      const author = authorElement?.innerText?.trim() || null

      // Extract image
      const imageElement = document.querySelector('.story__cover img') ||
                          document.querySelector('meta[property="og:image"]')
      const image = imageElement?.getAttribute('src') || 
                   imageElement?.getAttribute('content') || null

      return { content, datePublished, author, image }
    })

    // Build complete article object with all metadata fields
    const article = normalizeArticle({
      ...item,
      content: scrapedData.content || '',
      author: scrapedData.author || item.author || null,
      image: scrapedData.image || null,
      source: 'Dawn',
      dateList: date,
      date_published: scrapedData.datePublished || item.datePublished || new Date(date).toISOString(),
      retrievedAt: new Date().toISOString(),
    })

    await fs.writeJson(outPath, article, { spaces: 2 })
    log(`✅ [${date}] Scraped: ${title.substring(0, 60)}...`)
    
    return true
  } catch (err) {
    log(`❌ [${date}] Failed: ${title.substring(0, 60)}... - ${err.message}`)
    return false
  } finally {
    await page.close()
  }
}

/**
 * Processes articles for multiple dates in batches
 * @param {string[]} dates - Array of dates in YYYY-MM-DD format
 */
async function processDates(dates) {
  const log = makeLogger()
  const stats = fs.existsSync(STATS_FILE) ? await fs.readJson(STATS_FILE) : {}

  for (const date of dates) {
    const listPath = path.join(
      buildDatedPath(LIST_DIR, date),
      `list_${date}.json`
    )

    if (!(await fs.pathExists(listPath))) {
      log(`⚠️  [${date}] List file not found: ${listPath}`)
      stats[date] = { completed: false, error: 'List file not found' }
      continue
    }

    const items = await fs.readJson(listPath)
    log(`📚 [${date}] Processing ${items.length} articles`)

    let success = 0
    let failed = 0

    // Process articles in batches
    for (const batch of chunkArray(items, BATCH_SIZE)) {
      await Promise.all(
        batch.map(async (item) => {
          await sleep(jitter(200, 800))
          const result = await scrapeArticle(item, date, log)
          if (result) success++
          else failed++
        })
      )

      await sleep(jitter(2000, 4000))
    }

    stats[date] = { completed: true, success, failed, total: items.length }
    await fs.writeJson(STATS_FILE, stats, { spaces: 2 })
    
    log(`📊 [${date}] Summary: ${success} success, ${failed} failed`)
  }
}

/**
 * Main entry point for the scraper
 * @param {string} arg - Optional date range argument
 */
async function main(arg) {
  const rawArgs = arg ? [String(arg)] : process.argv.slice(2).map(String)
  const joined = rawArgs.join('').replace(/\s+/g, '').trim()

  try {
    if (!joined) {
      console.error('Usage: node scrape_articles_dawn.js YYYY-MM-DD[:YYYY-MM-DD]')
      process.exit(1)
    }

    const parts = joined.includes(':') ? joined.split(':') : [joined, joined]
    
    if (parts.length > 2) {
      console.error('❌ Invalid input. Use YYYY-MM-DD or YYYY-MM-DD:YYYY-MM-DD')
      process.exit(1)
    }

    const startRaw = String(parts[0]).trim()
    const endRaw = String(parts[1] ?? parts[0]).trim()
    let start = dayjs(startRaw, 'YYYY-MM-DD')
    let end = dayjs(endRaw, 'YYYY-MM-DD')

    if (!start.isValid() || !end.isValid()) {
      console.error('❌ Invalid date format.')
      process.exit(1)
    }

    if (start.isAfter(end)) {
      const tmp = start
      start = end
      end = tmp
      console.log(
        `ℹ️ Swapped date range to ascending: ${start.format('YYYY-MM-DD')} : ${end.format('YYYY-MM-DD')}`
      )
    }

    const dates = []
    let current = start
    while (current.isSameOrBefore(end)) {
      dates.push(current.format('YYYY-MM-DD'))
      current = current.add(1, 'day')
    }

    await processDates(dates)
    
    console.log('✅ Dawn article scraping completed.')
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
    await closeBrowser()
    process.exit(1)
  } finally {
    // Always close browser on exit
    await closeBrowser()
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('❌ Unhandled error:', error)
    await closeBrowser()
    process.exit(1)
  })
}

module.exports = { main, processDates, scrapeArticle, generateFilenameHash }