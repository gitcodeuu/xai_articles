// scrape_articles_app.js
// Usage:
//   node scrape_articles_app.js 2025-08-11
//   node scrape_articles_app.js --fromDate 2025-08-10 --toDate 2025-08-12
// Examples (pnpm):
//   pnpm run app:articles -- 2025-08-11
//   pnpm run app:articles -- --fromDate 2025-08-10 --toDate 2025-08-12
//   pnpm run app:articles:retry -- 2025-08-11
//   pnpm run app:articles:retry -- --fromDate 2025-08-10 --toDate 2025-08-12


const fs = require('fs-extra')
const path = require('path')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const dayjs = require('dayjs')
const minimist = require('minimist')
const os = require('os')
const {
  buildDatedPath,
  fileNameFromLink,
  sleep,
  readJSON,
  saveJSON,
  sanitizeContent,
} = require('./utils/helpers')
const { normalizeArticle } = require('./utils/schema')
const { SCRAPER_CONFIG } = require('./config')
const { newPage, closeBrowser } = require('./utils/browser')

puppeteer.use(StealthPlugin())

const { MAX_RETRIES, CONCURRENCY } = SCRAPER_CONFIG

const dataDir = path.join(__dirname, 'data', 'app')
const listDir = path.join(dataDir, 'lists')
const articlesDir = path.join(dataDir, 'articles')
const progressDir = path.join(dataDir, 'progress')

// Filenames now come from URL via fileNameFromLink(url)

function getDateRange(fromDate, toDate) {
  const start = dayjs(fromDate)
  const end = dayjs(toDate)
  const range = []
  for (let d = start; d.isBefore(end) || d.isSame(end); d = d.add(1, 'day')) {
    range.push(d.format('YYYY-MM-DD'))
  }
  return range
}

const { scrapeArticle } = require('./scrapers/app')

async function processDate(targetDate, retryMode = false) {
  console.log(
    `[📅 Processing ${retryMode ? 'RETRY' : 'LIST'} for: ${targetDate}]`
  )

  // Prefer new dated list path; fall back to legacy flat layout
  const [y, m, d] = String(targetDate).split('-')
  const listPathNew = path.join(listDir, y, m, d, `list_${targetDate}.json`)
  const listPathOld = path.join(listDir, `list_${targetDate}.json`)
  const listPathLegacy = path.join(
    __dirname,
    'data',
    'lists',
    `list_${targetDate}.json`
  )
  const listPath = (await fs.pathExists(listPathNew))
    ? listPathNew
    : (await fs.pathExists(listPathOld))
      ? listPathOld
      : listPathLegacy
  const progressPath = path.join(
    progressDir,
    `progress_articles_${targetDate}.json`
  )
  const failPath = path.join(progressDir, `fail_articles_${targetDate}.json`)
  const retryPath = path.join(
    progressDir,
    `retry_count_articles_${targetDate}.json`
  )

  await fs.ensureDir(progressDir)

  // Precompute list date map once for this date
  const listArrAll = await readJSON(listPath, [])
  const listDateMap = new Map()
  for (const a of Array.isArray(listArrAll) ? listArrAll : []) {
    if (a && a.link && a.date_published && dayjs(a.date_published).isValid()) {
      listDateMap.set(a.link, dayjs(a.date_published).toISOString())
    }
  }

  // Helper: find existing article files with empty/too-short content and return their links
  async function getEmptyContentLinks(dateStr) {
    // Support new dated path (YYYY\\MM\\DD) with fallback to legacy (YYYY-MM-DD) and pre-migration root
    const [yy, mm, dd] = String(dateStr).split('-')
    const dateFolderNew = path.join(articlesDir, yy, mm, dd)
    const dateFolderOld = path.join(articlesDir, dateStr)
    const dateFolderLegacy = path.join(__dirname, 'data', 'articles', dateStr)
    const dateFolder = (await fs.pathExists(dateFolderNew))
      ? dateFolderNew
      : (await fs.pathExists(dateFolderOld))
        ? dateFolderOld
        : dateFolderLegacy

    const links = new Set()
    if (!(await fs.pathExists(dateFolder))) return []
    const files = await fs.readdir(dateFolder)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const filePath = path.join(dateFolder, f)
      try {
        const obj = await fs.readJson(filePath)
        const txt = (obj && obj.content ? String(obj.content) : '').trim()
        const bad = !txt || txt.length < 50
        if (bad && obj && obj.link) {
          links.add(obj.link)
          // Optional: remove bad file so it will be cleanly re-saved on success
          try {
            await fs.remove(filePath)
          } catch {}
        }
      } catch {
        // corrupted json: delete and skip; it will be re-scraped if in list/failed
        try {
          await fs.remove(filePath)
        } catch {}
      }
    }
    return Array.from(links)
  }

  // Helper: find existing article files with wrong/missing date_published compared to list and return their links
  async function getWrongDateLinks(dateStr) {
    const [yy, mm, dd] = String(dateStr).split('-')
    const dateFolderNew = path.join(articlesDir, yy, mm, dd)
    const dateFolderOld = path.join(articlesDir, dateStr)
    const dateFolderLegacy = path.join(__dirname, 'data', 'articles', dateStr)
    const dateFolder = (await fs.pathExists(dateFolderNew))
      ? dateFolderNew
      : (await fs.pathExists(dateFolderOld))
        ? dateFolderOld
        : dateFolderLegacy

    // Load list data for this date
    const listPathNew = path.join(listDir, yy, mm, dd, `list_${dateStr}.json`)
    const listPathOld = path.join(listDir, `list_${dateStr}.json`)
    const listPathLegacy = path.join(
      __dirname,
      'data',
      'lists',
      `list_${dateStr}.json`
    )
    let listArr = []
    try {
      if (await fs.pathExists(listPathNew))
        listArr = await fs.readJson(listPathNew)
      else if (await fs.pathExists(listPathOld))
        listArr = await fs.readJson(listPathOld)
      else if (await fs.pathExists(listPathLegacy))
        listArr = await fs.readJson(listPathLegacy)
    } catch {}

    const listMap = new Map()
    for (const a of Array.isArray(listArr) ? listArr : []) {
      if (
        a &&
        a.link &&
        a.date_published &&
        dayjs(a.date_published).isValid()
      ) {
        listMap.set(a.link, dayjs(a.date_published).toISOString())
      }
    }

    const wrong = new Set()
    if (!(await fs.pathExists(dateFolder))) return []
    const files = await fs.readdir(dateFolder)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const filePath = path.join(dateFolder, f)
      try {
        const obj = await fs.readJson(filePath)
        if (!obj || !obj.link) continue
        const listISO = listMap.get(obj.link)
        // If no list match, skip; we only fix when we know the expected date
        if (!listISO) continue
        const artISO = obj.date_published
        const artValid = artISO && dayjs(artISO).isValid()
        const differs = !artValid || dayjs(artISO).toISOString() !== listISO
        if (differs) {
          wrong.add(obj.link)
        }
      } catch {
        // ignore malformed files here; empty/malformed handled elsewhere
      }
    }
    return Array.from(wrong)
  }

  const scraped = new Set(await readJSON(progressPath, []))
  const failed = new Set(await readJSON(failPath, []))
  const retryCounts = await readJSON(retryPath, {})

  const emptyContentLinks = new Set(await getEmptyContentLinks(targetDate))
  const wrongDateLinks = new Set(await getWrongDateLinks(targetDate))

  let links = []
  if (retryMode) {
    const failedList = await readJSON(failPath, [])
    const toRetry = failedList.filter(
      (url) => (retryCounts[url] || 0) < MAX_RETRIES
    )
    // Include empty-content links and wrong-date links as well
    links = Array.from(
      new Set([...toRetry, ...emptyContentLinks, ...wrongDateLinks])
    )
    if (links.length === 0) {
      console.log('✅ No links to retry. Skipping.')
      return
    }
  } else {
    const list = await readJSON(listPath, [])
    // Normal mode: include links not scraped, or scraped-but-empty (force retry)
    links = list
      .map((a) => a.link)
      .filter((url) => !scraped.has(url) || emptyContentLinks.has(url))
  }

  const pages = await Promise.all(
    Array.from({ length: CONCURRENCY }).map(() => newPage())
  )

  let idx = 0
  let processedSinceFlush = 0
  const FLUSH_EVERY = 15
  async function worker(page) {
    while (idx < links.length) {
      const url = links[idx++]
      const result = await scrapeArticle(page, url, targetDate, listDateMap)

      if (result.success) {
        scraped.add(url)
        failed.delete(url)
        delete retryCounts[url]
      } else {
        retryCounts[url] = (retryCounts[url] || 0) + 1
        if (retryCounts[url] >= MAX_RETRIES) {
          failed.add(url)
          console.log(`⛔ Max retries reached: ${url}`)
        }
      }

      processedSinceFlush++
      if (processedSinceFlush >= FLUSH_EVERY) {
        processedSinceFlush = 0
        await saveJSON(progressPath, [...scraped])
        await saveJSON(failPath, [...failed])
        await saveJSON(retryPath, retryCounts)
      }
    }
  }

  process.on('SIGINT', async () => {
    console.log('\nFlushing progress...')
    try {
      await saveJSON(progressPath, [...scraped])
      await saveJSON(failPath, [...failed])
      await saveJSON(retryPath, retryCounts)
    } finally {
      process.exit(0)
    }
  })

  await Promise.all(pages.map(worker))

  // Final flush at end
  await saveJSON(progressPath, [...scraped])
  await saveJSON(failPath, [...failed])
  await saveJSON(retryPath, retryCounts)
  await closeBrowser()
  console.log(`🎯 Finished ${targetDate}`)
}

async function main() {
  const args = minimist(process.argv.slice(2))
  const retryMode = !!args.retry
  let range = []

  if (args.fromDate && args.toDate) {
    range = getDateRange(args.fromDate, args.toDate)
    for (const date of range) {
      await processDate(date, retryMode)
    }
  } else if (args._.length) {
    range = [args._[0]]
    await processDate(args._[0], retryMode)
  } else {
    console.log(
      '❌ Please provide either --fromDate and --toDate or a single date'
    )
    return
  }

  const months = [...new Set(range.map((d) => d.substring(0, 7)))].join(',')
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
  }
}

if (require.main === module) {
  main()
}

module.exports = { main, processDate, scrapeArticle }
