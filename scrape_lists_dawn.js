// scrape_lists_dawn.js — scrapes article titles and URLs from Dawn's daily archive into data/dawn/lists/YYYY/MM/DD
// Usage:
//   node scrape_lists_dawn.js YYYY-MM-DD[:YYYY-MM-DD]
// Examples (pnpm):
//   pnpm run dawn:lists -- 2025-08-15
//   pnpm run dawn:lists -- 2025-08-01:2025-08-07

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs-extra')
const path = require('path')
const dayjs = require('dayjs')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
const customParseFormat = require('dayjs/plugin/customParseFormat')

const { buildDatedPath, sleep, jitter, chunkArray } = require('./utils/helpers')
const { normalizeListArray } = require('./utils/schema')
const { createLogStream } = require('./utils/logger')
const { SCRAPER_CONFIG, randOf } = require('./config')
const { newPage, closeBrowser } = require('./utils/browser')

puppeteer.use(StealthPlugin())
dayjs.extend(isSameOrBefore)
dayjs.extend(customParseFormat)

const BASE_URL = 'https://www.dawn.com/archive/'
const LIST_DIR = path.join(__dirname, 'data', 'dawn', 'lists')
const LOG_DIR = path.join(__dirname, 'data', 'dawn', 'logs')
const BATCH_SIZE = 2
const STATS_FILE = path.join(LOG_DIR, 'stats_lists.json')

const { USER_AGENTS, LANGUAGE_PREFS, VIEWPORTS } = SCRAPER_CONFIG

fs.ensureDirSync(LIST_DIR)
fs.ensureDirSync(LOG_DIR)

/**
 * Creates a logger instance specifically for Dawn list scraping
 * @returns {Function} Log function that writes to file and console
 */
function makeLogger() {
  const log = createLogStream('dawn_lists', { subDir: 'dawn/logs' })
  return log
}

/**
 * Scrapes article links and titles from a single Dawn archive page
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Function} log - Logger function for output
 * @returns {Promise<number>} Number of articles scraped
 */
async function scrapeList(date, log) {
  const url = `${BASE_URL}${date}`
  const page = await newPage()
  
  try {
    await sleep(jitter(200, 800))
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(jitter(1000, 2500))

    try {
      await page.mouse.move(jitter(50, 300), jitter(50, 300), {
        steps: jitter(2, 6),
      })
    } catch {}
    
    try {
      await page.evaluate(async () => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms))
        for (let i = 0; i < 2; i++) {
          window.scrollBy(0, Math.floor(200 + Math.random() * 400))
          await delay(150 + Math.random() * 300)
        }
        window.scrollTo(0, 0)
      })
    } catch {}

    const links = await page.evaluate(() => {
      const makeAbs = (href) => {
        try {
          return new URL(href, location.origin).href
        } catch {
          return href
        }
      }

      const cards = Array.from(
        document.querySelectorAll('main .story, main [class*="story"]')
      )
      const results = []
      
      for (const card of cards) {
        const linkEl = card.querySelector('.story__link, a.story__link')
        if (!linkEl) continue
        
        const href = linkEl.getAttribute('href')
        if (!href) continue

        const labelEl = card.querySelector(
          '.story__section, .story__category, .story__kicker, .kicker, .label, .badge'
        )
        const label = (labelEl?.textContent || '').trim().toLowerCase()
        const isPakistan = label ? /pakistan/i.test(label) : true
        if (!isPakistan) continue

        const title = (linkEl.innerText || linkEl.textContent || '').trim()
        const abs = makeAbs(href)
        
        if (abs && !abs.startsWith('https://images.dawn.com')) {
          results.push({ link: abs, title })
        }
      }

      let output = results
      if (output.length === 0) {
        output = Array.from(document.querySelectorAll('main .story__link'))
          .map((el) => {
            const href = el.getAttribute('href')
            const title = (el.innerText || '').trim()
            return href ? { link: makeAbs(href), title } : null
          })
          .filter(Boolean)
      }

      if (output.length === 0) {
        const anchors = Array.from(document.querySelectorAll('main a, body a'))
        output = anchors
          .map((el) => {
            const href = el.getAttribute('href') || ''
            const title = (el.innerText || el.textContent || '').trim()
            const abs = makeAbs(href)
            return { href, abs, title }
          })
          .filter((x) => !!x.abs && !!x.title)
          .filter((x) => !x.abs.startsWith('https://images.dawn.com'))
          .filter((x) => /\/news\//.test(x.abs))
          .map((x) => ({ link: x.abs, title: x.title }))
      }

      const seen = new Set()
      return output
        .filter((a) => {
          if (!a || !a.link) return false
          if (seen.has(a.link)) return false
          seen.add(a.link)
          return true
        })
        .filter((a) => !a.link.startsWith('https://images.dawn.com'))
    })

    const dateFolder = buildDatedPath(LIST_DIR, date)
    await fs.ensureDir(dateFolder)
    const outPath = path.join(dateFolder, `list_${date}.json`)
    
    const normalized = normalizeListArray(links)
    await fs.writeJson(outPath, normalized, { spaces: 2 })
    
    log(`✅ [${date}] ${links.length} articles saved → ${outPath}`)
    return links.length
  } finally {
    await page.close()
  }
}

/**
 * Processes multiple dates in batches
 * @param {string[]} dates - Array of dates in YYYY-MM-DD format
 */
async function processDates(dates) {
  const log = makeLogger()
  const stats = fs.existsSync(STATS_FILE) ? await fs.readJson(STATS_FILE) : {}

  for (const batch of chunkArray(dates, BATCH_SIZE)) {
    await Promise.all(
      batch.map(async (date) => {
        try {
          await sleep(jitter(200, 1000))
          const count = await scrapeList(date, log)
          stats[date] = { completed: true, count }
        } catch (e) {
          log(`❌ [${date}] ${e.message}`)
          stats[date] = { completed: false, error: e.message }
        }
      })
    )
    
    await fs.writeJson(STATS_FILE, stats, { spaces: 2 })
    await sleep(jitter(1500, 4000))
  }
}

/**
 * Main entry point for the scraper
 * @param {string} arg - Optional date range argument
 */
async function main(arg) {
  const rawArgs = arg ? [String(arg)] : process.argv.slice(2).map(String)
  const joined = rawArgs.join('').replace(/\s+/g, '').trim()

  if (!joined) {
    console.error('Usage: node scrape_lists_dawn.js YYYY-MM-DD[:YYYY-MM-DD]')
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

  // Refetch removed - will be handled by pipeline script
  console.log('✅ Dawn list scraping completed.')
  console.log('   Note: Run refetch script separately to retry failed articles.')
  
  await closeBrowser()
}

if (require.main === module) {
  main()
}

module.exports = { main, processDates, scrapeList }