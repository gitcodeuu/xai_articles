// ============================================================================
// APP News Scraper - List Scraping Module
// ============================================================================
// This script scrapes article lists from www.app.com.pk/national, organizing
// them by date and deduplicating entries. It supports various CLI modes:
// single page, page ranges, and resumable progress tracking.

// ────────────────────────────────────────────────────────────────────────────
// Dependencies
// ────────────────────────────────────────────────────────────────────────────
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin()) // Makes browser appear more human-like

const fs = require('fs-extra')
const path = require('path')
const dayjs = require('dayjs')
const minimist = require('minimist')
const {
  parseAppTimestamp,
  hashURL,
  buildDatedPath,
  chunkArray,
} = require('./utils/helpers')
const { normalizeListArray } = require('./utils/schema')
const { createLogStream } = require('./utils/logger')
const {
  normalizeTitle,
  loadSeenTitles,
  saveSeenTitles,
} = require('./utils/title_cache')
const { SCRAPER_CONFIG, randOf } = require('./config')
const { newPage, closeBrowser } = require('./utils/browser')

// ────────────────────────────────────────────────────────────────────────────
// Configuration Constants
// ────────────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://www.app.com.pk/national'
const LIST_DIR = path.join(__dirname, 'data', 'app', 'lists') // Stores scraped article lists
const LOG_DIR = path.join(__dirname, 'data', 'app', 'logs') // Stores debug logs and screenshots
const PROGRESS_FILE = path.join(__dirname, 'utils', 'progress.json') // Tracks last scraped page
const BATCH_SIZE = 5 // Number of pages per batch

const { USER_AGENTS } = SCRAPER_CONFIG

// Ensure required directories exist
fs.ensureDirSync(LIST_DIR)
fs.ensureDirSync(LOG_DIR)

// ────────────────────────────────────────────────────────────────────────────
// Progress Tracking Functions
// ────────────────────────────────────────────────────────────────────────────
/**
 * Loads the last successfully scraped page number from progress.json.
 * Returns 0 if file doesn't exist or is corrupted.
 */
async function getProgress() {
  try {
    if (await fs.pathExists(PROGRESS_FILE)) {
      const data = await fs.readJson(PROGRESS_FILE)
      return data?.lastPage || 0
    }
  } catch (err) {
    console.warn(
      '⚠️ Corrupted progress.json or invalid JSON. Starting from page 1.'
    )
  }
  return 0
}

/**
 * Saves the last successfully scraped page number to progress.json.
 * @param {number} lastPage - The page number to save
 */
async function saveProgress(lastPage) {
  await fs.writeJson(PROGRESS_FILE, { lastPage }, { spaces: 2 })
}

// ────────────────────────────────────────────────────────────────────────────
// Page Scraping Function
// ────────────────────────────────────────────────────────────────────────────
/**
 * Scrapes article metadata from a single page of the APP news website.
 * @param {number} pageNum - The page number to scrape (1-indexed)
 * @param {Function} log - Logger function for this scraping session
 * @returns {Promise<Array>} Array of article objects {title, link, time}
 */
async function scrapePage(pageNum, log) {
  // Construct URL (page 1 has no suffix, others use /page/N/)
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}/page/${pageNum}/`
  const page = await newPage()

  log(`🔗 Visiting: ${url}`)

  try {
    // Navigate to the page and wait for network to be idle
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

    // Retry mechanism: wait for content to appear (up to 3 attempts)
    let retries = 3,
      found = false
    while (retries-- > 0 && !found) {
      try {
        await page.waitForSelector('.td-module-meta-info', { timeout: 10000 })
        found = true
      } catch {
        log(`⏳ Retry: waiting again for content on page ${pageNum}`)
        await new Promise((res) => setTimeout(res, 3000))
      }
    }

    // If content never appears, save debug info and throw error
    if (!found) {
      const html = await page.content()
      await fs.writeFile(
        path.join(
          LOG_DIR,
          `debug_html_${String(pageNum).padStart(3, '0')}.html`
        ),
        html
      )
      await page.screenshot({
        path: path.join(
          LOG_DIR,
          `debug_page_${String(pageNum).padStart(3, '0')}.png`
        ),
        fullPage: true,
      })
      throw new Error(
        `Page ${pageNum} error: Content never appeared after retries`
      )
    }

    // Random delay to appear more human-like (2-5 seconds)
    await new Promise((res) => setTimeout(res, Math.random() * 3000 + 2000))

    // Extract article metadata from the DOM
    const articles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.td-module-meta-info'))
        .map((el) => {
          const a = el.querySelector('h3.entry-title.td-module-title > a')
          const timeEl = el.querySelector(
            'time.entry-date.updated.td-module-date'
          )
          const title = a?.innerText?.trim()
          const link = a?.href
          const time = timeEl?.innerText?.trim()
          return title && link && time ? { title, link, time } : null
        })
        .filter(Boolean) // Remove null entries
    })

    // Remove duplicate titles within the same page
    const seenTitles = new Set()
    return articles.filter((a) => {
      const norm = normalizeTitle(a.title)
      if (seenTitles.has(norm)) return false
      seenTitles.add(norm)
      return true
    })
  } catch (error) {
    throw new Error(`Page ${pageNum} error: ${error.message}`)
  } finally {
    await page.close() // Always close the page to free resources
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Batch Processing Function
// ────────────────────────────────────────────────────────────────────────────
/**
 * Processes a batch of pages, scraping and organizing articles by date.
 * @param {Array<number>} batchPages - Array of page numbers to process
 * @param {number} batchIndex - Index of this batch (for logging)
 * @param {Set} seenTitlesGlobal - Global set of seen titles for deduplication
 */
async function processBatch(batchPages, batchIndex, seenTitlesGlobal) {
  const log = createLogStream(`app_batch_${batchIndex}`, { subDir: 'app/logs' })
  log(`🚀 Batch ${batchIndex} started`)
  log(`🔢 Pages: ${batchPages.join(', ')}`)

  const seenLinks = new Set() // Track seen links within this batch
  const groupedByDate = {} // Group articles by publication date

  // Process each page in the batch sequentially
  for (const pageNum of batchPages) {
    try {
      const articles = await scrapePage(pageNum, log)
      log(`🌐 Page ${pageNum} → ${articles.length} articles`)

      for (const { title, link, time } of articles) {
        // Skip photo gallery links (not news articles)
        if (/^https?:\/\/www\.app\.com\.pk\/photos-section\//i.test(link)) {
          log(`🖼️ Skipping photos-section link: ${link}`)
          continue
        }

        // Parse timestamp and create date key (YYYY-MM-DD)
        const timestamp = parseAppTimestamp(time)
        if (!timestamp) continue

        const dateKey = dayjs(timestamp).format('YYYY-MM-DD')
        const id = hashURL(link)
        const norm = normalizeTitle(title)
        
        // Skip if already seen (by link or title)
        if (seenLinks.has(id) || seenTitlesGlobal.has(norm)) continue

        seenLinks.add(id)
        seenTitlesGlobal.add(norm)

        // Add to date group
        if (!groupedByDate[dateKey]) groupedByDate[dateKey] = []
        groupedByDate[dateKey].push({ title, link, date_published: timestamp })
      }
    } catch (err) {
      log(`❌ Page ${pageNum} failed: ${err.message}`)
    }
  }

  // Save articles grouped by date to dated folder structure
  for (const [date, articles] of Object.entries(groupedByDate)) {
    // Create dated folder path (YYYY/MM/DD)
    const [y, m, d] = String(date).split('-')
    const dateFolder = buildDatedPath(LIST_DIR, date)
    await fs.ensureDir(dateFolder)
    const newFilePath = path.join(dateFolder, `list_${date}.json`)
    const oldFilePath = path.join(LIST_DIR, `list_${date}.json`) // Legacy flat file

    // Load existing articles (try new path, fallback to old path)
    let existing = []
    if (await fs.pathExists(newFilePath)) {
      existing = await fs.readJson(newFilePath)
    } else if (await fs.pathExists(oldFilePath)) {
      existing = await fs.readJson(oldFilePath)
    }

    // Combine existing and new articles
    const combined = [...existing, ...articles]
    
    // Filter out photo gallery links (even from historical data)
    const filteredCombined = combined.filter(
      (a) => !/^https?:\/\/www\.app\.com\.pk\/photos-section\//i.test(a.link)
    )

    // Deduplicate by normalized title
    const dedupedMap = new Map()
    for (const a of filteredCombined) {
      const key = normalizeTitle(a.title)
      if (!dedupedMap.has(key)) dedupedMap.set(key, a)
    }

    const deduped = Array.from(dedupedMap.values())
    const normalized = normalizeListArray(deduped) // Apply schema normalization
    
    log(
      `⚠️ Deduplicated ${filteredCombined.length !== combined.length ? combined.length - filteredCombined.length : 0} photos-section and ${combined.length - filteredCombined.length} removed before dedupe; ${combined.length - deduped.length} deduped for ${date}`
    )
    
    await fs.writeJson(newFilePath, normalized, { spaces: 2 })
    log(`✅ Saved ${normalized.length} articles for ${date} → ${newFilePath}`)
  }

  log(`🎯 Batch ${batchIndex} finished`)
}

// ────────────────────────────────────────────────────────────────────────────
// CLI Argument Parsing
// ────────────────────────────────────────────────────────────────────────────
/**
 * Displays usage instructions for the CLI.
 */
function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scrape_lists_app.js --latest',
      '  node scrape_lists_app.js --page <n>',
      '  node scrape_lists_app.js --pages <start-end>',
      '  node scrape_lists_app.js --startPage <n> --endPage <m>',
      '',
      'Options:',
      '  --latest                Scrape only the latest page (page 1)',
      '  --page n                Scrape a single specific page (e.g., --page 5)',
      '  --pages a-b             Scrape a range of pages inclusive (e.g., --pages 3-10)',
      '  --startPage n           Start page (legacy/compatible)',
      '  --endPage m             End page (legacy/compatible)',
      '  --concurrency k         Number of batches processed in parallel (default 3)',
      '  --help                  Show this help',
    ].join('\n')
  )
}

/**
 * Parses CLI arguments to determine which pages to scrape.
 * @param {Object} argv - Parsed CLI arguments from minimist
 * @param {number} lastProgress - Last successfully scraped page
 * @returns {Object} Object with { pages: Array<number>, isLatest?: boolean, help?: boolean }
 */
function parsePageArgs(argv, lastProgress) {
  const pages = new Set()
  const isLatest = !!argv.latest

  if (argv.help) return { help: true }

  // Mode 1: --latest (only page 1)
  if (isLatest) return { pages: [1], isLatest }

  // Mode 2: --page n (single page)
  if (argv.page != null) {
    const n = parseInt(argv.page)
    if (!(n > 0)) throw new Error('--page must be a positive integer')
    pages.add(n)
  }

  // Mode 3: --pages a-b (range)
  if (argv.pages) {
    const m = String(argv.pages)
      .trim()
      .match(/^(\d+)\s*-\s*(\d+)$/)
    if (!m) throw new Error('--pages must be in the form a-b, e.g., 3-10')
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (!(a > 0 && b > 0 && a <= b))
      throw new Error('--pages range must be valid and ascending')
    for (let i = a; i <= b; i++) pages.add(i)
  }

  // Mode 4: Legacy support (--startPage/--endPage)
  if (argv.startPage != null || argv.endPage != null) {
    const start = parseInt(argv.startPage || 1, 10)
    const end = parseInt(argv.endPage || start, 10)
    if (!(start > 0 && end > 0 && start <= end))
      throw new Error('startPage/endPage must be valid and ascending')
    for (let i = start; i <= end; i++) pages.add(i)
  }

  // Default behavior: scrape pages 1-10 (or resume from progress)
  if (pages.size === 0) {
    const start = Math.max(parseInt(argv.startPage || 1, 10), lastProgress + 1)
    const end = parseInt(argv.endPage || 10, 10)
    if (start > end) return { pages: [] }
    for (let i = start; i <= end; i++) pages.add(i)
  }

  // Filter out pages already scraped (based on progress.json)
  const filtered = Array.from(pages)
    .filter((p) => p > lastProgress)
    .sort((a, b) => a - b)
  return { pages: filtered }
}

// ────────────────────────────────────────────────────────────────────────────
// Main Execution Function
// ────────────────────────────────────────────────────────────────────────────
/**
 * Main entry point. Orchestrates the scraping process:
 * 1. Parse CLI arguments
 * 2. Load progress and seen titles
 * 3. Scrape pages in parallel batches
 * 4. Save progress incrementally
 * 5. Trigger content refetch for articles with missing content
 * 
 * @param {Object} argvIn - Optional pre-parsed arguments (for programmatic use)
 */
async function main(argvIn) {
  const argv = argvIn || minimist(process.argv.slice(2))
  const concurrency = parseInt(argv.concurrency || 3) // Number of parallel batches

  const lastProgress = await getProgress()
  const seenTitlesGlobal = await loadSeenTitles() // Load global deduplication cache

  if (argv.help) {
    printUsage()
    return
  }

  // Parse which pages to scrape
  let parsed
  try {
    parsed = parsePageArgs(argv, lastProgress)
  } catch (e) {
    console.error('❌', e.message)
    printUsage()
    process.exitCode = 1
    return
  }

  if (parsed.help) {
    printUsage()
    return
  }

  let pages = parsed.pages || []
  if (pages.length === 0) {
    console.log(`✅ Already scraped until page ${lastProgress}`)
    return
  }

  // Process pages in batches with controlled concurrency
  const allDates = new Set() // Track all dates encountered
  const batches = chunkArray(pages, BATCH_SIZE)
  
  for (let i = 0; i < batches.length; i += concurrency) {
    const parallelBatches = batches.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      parallelBatches.map((batchPages, idx) => {
        const batchIndex = i + idx + 1
        return processBatch(batchPages, batchIndex, seenTitlesGlobal)
      })
    )

    // Collect dates from successful batches
    results.forEach((result) => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        result.value.forEach((date) => allDates.add(date))
      }
    })

    // Save progress after each concurrent batch group
    const lastPageDone = parallelBatches.flat().slice(-1)[0]
    await saveProgress(lastPageDone)
  }

  // Save updated seen titles cache
  await saveSeenTitles(seenTitlesGlobal)
  
  console.log('✅ All batches completed.')

  // Prepare month filter for refetch process (e.g., "2024-01,2024-02")
  const months = [...new Set([...allDates].map((d) => d.substring(0, 7)))].join(
    ','
  )

  // Trigger content refetch for articles with null content
  console.log('\n🚀 Starting content refetch process for APP source...')
  try {
    const { run: refetchNullContent } = require('./scripts/refetch_null_content')
    const refetchArgs = ['--source', 'app']
    if (months) {
      refetchArgs.push('--months', months)
    }
    await refetchNullContent({ argv: refetchArgs })
    console.log('✅ Content refetch process for APP source completed.')
  } catch (err) {
    console.error('❌ Content refetch process for APP source failed:', err)
  } finally {
    await closeBrowser() // Ensure browser is closed even if refetch fails
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Module Exports
// ────────────────────────────────────────────────────────────────────────────
// Run main if executed directly
if (require.main === module) {
  main()
}

// Export functions for testing or programmatic use
module.exports = {
  main,
  scrapePage,
  processBatch,
  parsePageArgs,
  chunkArray,
  getProgress,
  saveProgress,
}
