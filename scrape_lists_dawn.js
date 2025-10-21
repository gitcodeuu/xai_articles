// scrape_lists_dawn.js — scrapes article titles and URLs from Dawn's daily archive into data/dawn/lists/YYYY/MM/DD
// Usage:
//   node scrape_lists_dawn.js YYYY-MM-DD[:YYYY-MM-DD]
// Examples (pnpm):
//   pnpm run dawn:lists -- 2025-08-15
//   pnpm run dawn:lists -- 2025-08-01:2025-08-07

// puppeteer - browser automation library
// StealthPlugin - puppeteer plugin to evade bot detection
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

// fs - file system operations with promises
const fs = require('fs-extra')

// path - utilities for working with file and directory paths
const path = require('path')

// dayjs - date manipulation library
// isSameOrBefore - dayjs plugin for date comparison
// customParseFormat - dayjs plugin for custom date parsing
const dayjs = require('dayjs')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
const customParseFormat = require('dayjs/plugin/customParseFormat')

// buildDatedPath - creates folder structure based on date (YYYY/MM/DD)
// sleep - promise-based delay function
// jitter - adds random variation to timing values
// chunkArray - splits array into smaller batches
const { buildDatedPath, sleep, jitter, chunkArray } = require('./utils/helpers')

// normalizeListArray - validates and normalizes scraped article data
const { normalizeListArray } = require('./utils/schema')

// createLogStream - creates file logger for scraping operations
const { createLogStream } = require('./utils/logger')

// SCRAPER_CONFIG - configuration for user agents, viewports, etc.
// randOf - utility to randomly select from array
const { SCRAPER_CONFIG, randOf } = require('./config')

// newPage - creates new browser page with configured settings
// closeBrowser - closes browser instance and cleans up resources
const { newPage, closeBrowser } = require('./utils/browser')

// Enable stealth plugin to avoid bot detection by websites
puppeteer.use(StealthPlugin())

// Extend dayjs with required plugins for date operations
dayjs.extend(isSameOrBefore)
dayjs.extend(customParseFormat)

// Base URL for Dawn's archive pages (appends date in YYYY-MM-DD format)
const BASE_URL = 'https://www.dawn.com/archive/'

// Directory paths for storing scraped data and logs
const LIST_DIR = path.join(__dirname, 'data', 'dawn', 'lists')
const LOG_DIR = path.join(__dirname, 'data', 'dawn', 'logs')

// Number of dates to process concurrently in each batch
const BATCH_SIZE = 2

// File path for storing scraping statistics
const STATS_FILE = path.join(LOG_DIR, 'stats_lists.json')

// Extract configuration values for browser fingerprinting
const { USER_AGENTS, LANGUAGE_PREFS, VIEWPORTS } = SCRAPER_CONFIG

// Ensure required directories exist before scraping begins
fs.ensureDirSync(LIST_DIR)
fs.ensureDirSync(LOG_DIR)

/**
 * Creates a logger instance specifically for Dawn list scraping
 * @returns {Function} Log function that writes to file and console
 */
function makeLogger() {
  // reuse shared logger infra but keep Dawn-specific filename prefix, and write under data/dawn/logs
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
  // Construct the full URL for the archive page
  const url = `${BASE_URL}${date}`
  
  // Create a new browser page with configured settings
  const page = await newPage()
  
  try {
    // Add random delay before navigation to simulate human behavior
    await sleep(jitter(200, 800))
    
    // Navigate to the archive page and wait for DOM to load
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    
    // Wait after page load to let JavaScript render content
    await sleep(jitter(1000, 2500))

    // Simulate human-like mouse movements to avoid detection
    try {
      await page.mouse.move(jitter(50, 300), jitter(50, 300), {
        steps: jitter(2, 6),
      })
    } catch {}
    
    // Simulate human-like scrolling behavior
    try {
      await page.evaluate(async () => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms))
        // Scroll down twice with random distances
        for (let i = 0; i < 2; i++) {
          window.scrollBy(0, Math.floor(200 + Math.random() * 400))
          await delay(150 + Math.random() * 300)
        }
        // Scroll back to top
        window.scrollTo(0, 0)
      })
    } catch {}

    // Extract article links and titles from the page
    const links = await page.evaluate(() => {
      // Helper function to convert relative URLs to absolute URLs
      const makeAbs = (href) => {
        try {
          return new URL(href, location.origin).href
        } catch {
          return href
        }
      }

      // Strategy 1: Look for story cards in main content area
      // Limit to main content area and filter by visible section/category containing "Pakistan"
      const cards = Array.from(
        document.querySelectorAll('main .story, main [class*="story"]')
      )
      const results = []
      
      // Iterate through each story card
      for (const card of cards) {
        // Find the main link element for the story
        const linkEl = card.querySelector('.story__link, a.story__link')
        if (!linkEl) continue
        
        const href = linkEl.getAttribute('href')
        if (!href) continue

        // Find any label indicating section/category on the card
        const labelEl = card.querySelector(
          '.story__section, .story__category, .story__kicker, .kicker, .label, .badge'
        )
        const label = (labelEl?.textContent || '').trim().toLowerCase()
        
        // Only include if the label explicitly mentions Pakistan; if no label is present on a Pakistan page, default include
        const isPakistan = label ? /pakistan/i.test(label) : true
        if (!isPakistan) continue

        // Extract title text from the link
        const title = (linkEl.innerText || linkEl.textContent || '').trim()
        const abs = makeAbs(href)
        
        // Exclude image CDN links
        if (abs && !abs.startsWith('https://images.dawn.com')) {
          results.push({ link: abs, title })
        }
      }

      // Fallback 1: if nothing matched (DOM differences), use main area links only
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

      // Fallback 2: Archive page structure — collect any news links from the page
      if (output.length === 0) {
        // Cast wider net to find all links on the page
        const anchors = Array.from(document.querySelectorAll('main a, body a'))
        output = anchors
          .map((el) => {
            const href = el.getAttribute('href') || ''
            const title = (el.innerText || el.textContent || '').trim()
            const abs = makeAbs(href)
            return { href, abs, title }
          })
          .filter((x) => !!x.abs && !!x.title) // Must have both URL and title
          .filter((x) => !x.abs.startsWith('https://images.dawn.com')) // Exclude images
          .filter((x) => /\/news\//.test(x.abs)) // Only include news articles
          .map((x) => ({ link: x.abs, title: x.title }))
      }

      // De-duplicate by link URL
      const seen = new Set()
      return output
        .filter((a) => {
          if (!a || !a.link) return false
          if (seen.has(a.link)) return false
          seen.add(a.link)
          return true
        })
        // Final filter to ensure no image CDN links
        .filter((a) => !a.link.startsWith('https://images.dawn.com'))
    })

    // Save scraped data to dated folder structure
    const dateFolder = buildDatedPath(LIST_DIR, date)
    await fs.ensureDir(dateFolder)
    const outPath = path.join(dateFolder, `list_${date}.json`)
    
    // Normalize and validate the data before saving
    const normalized = normalizeListArray(links)
    await fs.writeJson(outPath, normalized, { spaces: 2 })
    
    log(`✅ [${date}] ${links.length} articles saved → ${outPath}`)
    return links.length
  } finally {
    // Always close the page to free resources
    await page.close()
  }
}

/**
 * Processes multiple dates in batches
 * @param {string[]} dates - Array of dates in YYYY-MM-DD format
 */
async function processDates(dates) {
  const log = makeLogger()
  
  // Load existing stats or create empty object
  const stats = fs.existsSync(STATS_FILE) ? await fs.readJson(STATS_FILE) : {}

  // Process dates in batches to avoid overwhelming the server
  for (const batch of chunkArray(dates, BATCH_SIZE)) {
    // Process all dates in current batch concurrently
    await Promise.all(
      batch.map(async (date) => {
        try {
          // Stagger the start of each concurrent request
          await sleep(jitter(200, 1000))
          
          const count = await scrapeList(date, log)
          
          // Record successful scrape in stats
          stats[date] = { completed: true, count }
        } catch (e) {
          // Log and record error in stats
          log(`❌ [${date}] ${e.message}`)
          stats[date] = { completed: false, error: e.message }
        }
      })
    )
    
    // Save stats after each batch completes
    await fs.writeJson(STATS_FILE, stats, { spaces: 2 })
    
    // Human-like pause between batches to avoid rate limiting
    await sleep(jitter(1500, 4000))
  }
}

/**
 * Main entry point for the scraper
 * @param {string} arg - Optional date range argument
 */
async function main(arg) {
  // Accept either a single combined arg or multiple args (e.g., "2025-08-15", ":2025-08-01")
  const rawArgs = arg ? [String(arg)] : process.argv.slice(2).map(String)
  
  // Join arguments and remove whitespace to handle "A : B" format
  const joined = rawArgs
    .join('') // join without spaces to allow "A : B"
    .replace(/\s+/g, '') // remove any whitespace just in case
    .trim()

  // Validate that date argument was provided
  if (!joined) {
    console.error('Usage: node scrape_lists_dawn.js YYYY-MM-DD[:YYYY-MM-DD]')
    process.exit(1)
  }

  // Split on colon to get start and end dates (or use same date for both)
  const parts = joined.includes(':') ? joined.split(':') : [joined, joined]
  
  if (parts.length > 2) {
    console.error('❌ Invalid input. Use YYYY-MM-DD or YYYY-MM-DD:YYYY-MM-DD')
    process.exit(1)
  }

  // Extract and parse start and end dates
  const startRaw = String(parts[0]).trim()
  const endRaw = String(parts[1] ?? parts[0]).trim()
  let start = dayjs(startRaw, 'YYYY-MM-DD')
  let end = dayjs(endRaw, 'YYYY-MM-DD')

  // Validate date parsing
  if (!start.isValid() || !end.isValid()) {
    console.error('❌ Invalid date format.')
    process.exit(1)
  }

  // Normalize reversed ranges (swap if start is after end)
  if (start.isAfter(end)) {
    const tmp = start
    start = end
    end = tmp
    console.log(
      `ℹ️ Swapped date range to ascending: ${start.format('YYYY-MM-DD')} : ${end.format('YYYY-MM-DD')}`
    )
  }

  // Generate array of all dates in the range
  const dates = []
  let current = start
  while (current.isSameOrBefore(end)) {
    dates.push(current.format('YYYY-MM-DD'))
    current = current.add(1, 'day')
  }

  // Extract unique months for refetch process
  const months = [...new Set(dates.map((d) => d.substring(0, 7)))].join(',')

  // Process all dates
  await processDates(dates)

  // After scraping lists, trigger content refetch for articles with null content
  console.log('\n🚀 Starting content refetch process for DAWN source...')
  try {
    // Pass arguments programmatically to refetch script
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
    // Ensure browser is closed even if refetch fails
    await closeBrowser()
  }
}

// Run main function if script is executed directly (not imported as module)
if (require.main === module) {
  main()
}

// Export functions for use in other modules
module.exports = { main, processDates, scrapeList }
