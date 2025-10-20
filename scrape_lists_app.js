const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

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

const BASE_URL = 'https://www.app.com.pk/national'
const LIST_DIR = path.join(__dirname, 'data', 'app', 'lists')
const LOG_DIR = path.join(__dirname, 'data', 'app', 'logs')
const PROGRESS_FILE = path.join(__dirname, 'utils', 'progress.json')
const BATCH_SIZE = 5

const { USER_AGENTS } = SCRAPER_CONFIG

fs.ensureDirSync(LIST_DIR)
fs.ensureDirSync(LOG_DIR)

// ✅ Safe fallback for corrupted progress.json
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

async function saveProgress(lastPage) {
  await fs.writeJson(PROGRESS_FILE, { lastPage }, { spaces: 2 })
}

async function scrapePage(pageNum, log) {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}/page/${pageNum}/`
  const page = await newPage()

  log(`🔗 Visiting: ${url}`)

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

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

    await new Promise((res) => setTimeout(res, Math.random() * 3000 + 2000))

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
        .filter(Boolean)
    })

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
    await page.close()
  }
}

async function processBatch(batchPages, batchIndex, seenTitlesGlobal) {
  const log = createLogStream(`app_batch_${batchIndex}`, { subDir: 'app/logs' })
  log(`🚀 Batch ${batchIndex} started`)
  log(`🔢 Pages: ${batchPages.join(', ')}`)

  const seenLinks = new Set()
  const groupedByDate = {}

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

        const timestamp = parseAppTimestamp(time)
        if (!timestamp) continue

        const dateKey = dayjs(timestamp).format('YYYY-MM-DD')
        const id = hashURL(link)
        const norm = normalizeTitle(title)
        if (seenLinks.has(id) || seenTitlesGlobal.has(norm)) continue

        seenLinks.add(id)
        seenTitlesGlobal.add(norm)

        if (!groupedByDate[dateKey]) groupedByDate[dateKey] = []
        groupedByDate[dateKey].push({ title, link, date_published: timestamp })
      }
    } catch (err) {
      log(`❌ Page ${pageNum} failed: ${err.message}`)
    }
  }

  for (const [date, articles] of Object.entries(groupedByDate)) {
    // Save to new dated path, fallback read from old flat file if present
    const [y, m, d] = String(date).split('-')
    const dateFolder = buildDatedPath(LIST_DIR, date)
    await fs.ensureDir(dateFolder)
    const newFilePath = path.join(dateFolder, `list_${date}.json`)
    const oldFilePath = path.join(LIST_DIR, `list_${date}.json`)

    let existing = []
    if (await fs.pathExists(newFilePath)) {
      existing = await fs.readJson(newFilePath)
    } else if (await fs.pathExists(oldFilePath)) {
      existing = await fs.readJson(oldFilePath)
    }

    const combined = [...existing, ...articles]
    // Ensure we never persist photo gallery links even if they exist in historical data
    const filteredCombined = combined.filter(
      (a) => !/^https?:\/\/www\.app\.com\.pk\/photos-section\//i.test(a.link)
    )

    const dedupedMap = new Map()
    for (const a of filteredCombined) {
      const key = normalizeTitle(a.title)
      if (!dedupedMap.has(key)) dedupedMap.set(key, a)
    }

    const deduped = Array.from(dedupedMap.values())
    const normalized = normalizeListArray(deduped)
    log(
      `⚠️ Deduplicated ${filteredCombined.length !== combined.length ? combined.length - filteredCombined.length : 0} photos-section and ${combined.length - filteredCombined.length} removed before dedupe; ${combined.length - deduped.length} deduped for ${date}`
    )
    await fs.writeJson(newFilePath, normalized, { spaces: 2 })
    log(`✅ Saved ${normalized.length} articles for ${date} → ${newFilePath}`)
  }

  log(`🎯 Batch ${batchIndex} finished`)
}

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

function parsePageArgs(argv, lastProgress) {
  const pages = new Set()
  const isLatest = !!argv.latest

  if (argv.help) return { help: true }

  if (isLatest) return { pages: [1], isLatest }

  if (argv.page != null) {
    const n = parseInt(argv.page)
    if (!(n > 0)) throw new Error('--page must be a positive integer')
    pages.add(n)
  }

  if (argv.pages) {
    // format: a-b
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

  // Legacy support: startPage/endPage
  if (argv.startPage != null || argv.endPage != null) {
    const start = parseInt(argv.startPage || 1, 10)
    const end = parseInt(argv.endPage || start, 10)
    if (!(start > 0 && end > 0 && start <= end))
      throw new Error('startPage/endPage must be valid and ascending')
    for (let i = start; i <= end; i++) pages.add(i)
  }

  // Default behavior if no specific pages provided: legacy default 1-10 after progress
  if (pages.size === 0) {
    const start = Math.max(parseInt(argv.startPage || 1, 10), lastProgress + 1)
    const end = parseInt(argv.endPage || 10, 10)
    if (start > end) return { pages: [] }
    for (let i = start; i <= end; i++) pages.add(i)
  }

  // Respect progress.json by skipping pages already done
  const filtered = Array.from(pages)
    .filter((p) => p > lastProgress)
    .sort((a, b) => a - b)
  return { pages: filtered }
}

async function main(argvIn) {
  const argv = argvIn || minimist(process.argv.slice(2))
  const concurrency = parseInt(argv.concurrency || 3)

  const lastProgress = await getProgress()
  const seenTitlesGlobal = await loadSeenTitles()

  if (argv.help) {
    printUsage()
    return
  }

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

  const allDates = new Set()
  const batches = chunkArray(pages, BATCH_SIZE)
  for (let i = 0; i < batches.length; i += concurrency) {
    const parallelBatches = batches.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      parallelBatches.map((batchPages, idx) => {
        const batchIndex = i + idx + 1
        return processBatch(batchPages, batchIndex, seenTitlesGlobal)
      })
    )

    results.forEach((result) => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        result.value.forEach((date) => allDates.add(date))
      }
    })

    const lastPageDone = parallelBatches.flat().slice(-1)[0]
    await saveProgress(lastPageDone)
  }

  await saveSeenTitles(seenTitlesGlobal)
  // Do not close browser here, let refetch handle it.
  // await closeBrowser()
  console.log('✅ All batches completed.')

  const months = [...new Set([...allDates].map((d) => d.substring(0, 7)))].join(
    ','
  )

  console.log('\n🚀 Starting content refetch process for APP source...')
  try {
    // Pass arguments programmatically
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

if (require.main === module) {
  main()
}

module.exports = {
  main,
  scrapePage,
  processBatch,
  parsePageArgs,
  chunkArray,
  getProgress,
  saveProgress,
}
