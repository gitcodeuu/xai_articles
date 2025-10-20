// scripts/refetch_null_content.js
// Scan data/dawn/articles and data/app/articles for JSON files with content === null (or empty)
// Re-fetch content from the source link and update the JSON file.
// Usage examples:
//   node scripts\refetch_null_content.js
//   node scripts\refetch_null_content.js --source dawn
//   node scripts\refetch_null_content.js --source app
//   node scripts\refetch_null_content.js --limit 50 --dry
//   node scripts\refetch_null_content.js --concurrency 4 --retry 3

const fs = require('fs-extra')
const path = require('path')
const minimist = require('minimist')
const dayjs = require('dayjs')

const { isArticleContentMissing, walk, sleep, getDateRange } = require('../utils/helpers')
const { normalizeArticle } = require('../utils/schema')
const { newPage, closeBrowser } = require('../utils/browser')
const { scrapeArticleOnPage } = require('../scrapers/dawn')
const { scrapeArticle } = require('../scrapers/app')

// Dynamically import scrapers
// const dawnScraper = require('../scrape_articles_dawn.js')
// const appScraper = require('../scrape_articles_app.js')

const ROOT = __dirname.replace(/scripts$/i, '')
const DAWN_DIR = path.join(ROOT, 'data', 'dawn', 'articles')
const APP_DIR = path.join(ROOT, 'data', 'app', 'articles')
const PROGRESS_DIR = path.join(ROOT, 'data', 'progress', 'refetch_nulls')

async function refetchForFile(filePath, options, ctx) {
  const { dry = false } = options
  const raw = await fs.readJson(filePath).catch(() => null)
  if (!raw || !raw.link) return { skipped: true, reason: 'invalid-json' }
  if (!isArticleContentMissing(raw))
    return { skipped: true, reason: 'content-present' }

  const source =
    raw.source ||
    (filePath.includes(`${path.sep}dawn${path.sep}`)
      ? 'Dawn'
      : filePath.includes(`${path.sep}app${path.sep}`)
        ? 'App'
        : null)
  if (!source) return { skipped: true, reason: 'unknown-source' }

  const now = dayjs().toISOString()

  try {
    // Use a single page provided by the worker context
    const page = ctx.page
    let articleData

    if (source.toLowerCase() === 'dawn') {
      const result = await scrapeArticleOnPage(page, raw.link)
      articleData = result
    } else if (source.toLowerCase() === 'app') {
      const result = await scrapeArticle(page, raw.link, raw.dateList)
      if (!result.success) {
        return { failed: true, error: 'app-scrape-failed' }
      }
      articleData = result.articleData
    } else {
      return { skipped: true, reason: 'unsupported-source' }
    }

    const fetchedContent = articleData?.content?.trim() || ''
    if (!fetchedContent) {
      return { failed: true, error: 'no-content-fetched' }
    }

    // Merge new data with old, preferring new non-null values
    const updated = normalizeArticle({
      ...raw,
      title: articleData.title || raw.title,
      author: articleData.author ?? raw.author,
      content: fetchedContent,
      tags:
        Array.isArray(articleData.tags) && articleData.tags.length > 0
          ? articleData.tags
          : raw.tags,
      categories:
        Array.isArray(articleData.categories) &&
        articleData.categories.length > 0
          ? articleData.categories
          : raw.categories,
      image: articleData.image ?? raw.image,
      retrievedAt: now,
      date_published: articleData.date_published || raw.date_published,
    })

    if (!dry) {
      await fs.writeJson(filePath, updated, { spaces: 2 })
    }
    return { updated: true }
  } catch (err) {
    return { failed: true, error: err?.message || String(err) }
  }
}

async function run(options = {}) {
  const argv = options.argv
    ? minimist(options.argv)
    : minimist(process.argv.slice(2))
  const source = (argv.source || argv.s || 'both').toString().toLowerCase()
  const dry = Boolean(argv.dry)
  const limit = argv.limit ? Number(argv.limit) : Infinity
  const monthsArg = argv.months
    ? String(argv.months).split(',').filter(Boolean)
    : []
  const datesArg = argv.dates ? String(argv.dates) : null // e.g., "2025-10-17:2025-10-20"
  const concurrency = Math.max(1, Math.min(8, Number(argv.concurrency || 2)))
  const retry = Math.max(1, Math.min(5, Number(argv.retry || 2)))

  const sources = []
  if (source === 'dawn' || source === 'both')
    sources.push({ key: 'dawn', dir: DAWN_DIR })
  if (source === 'app' || source === 'both')
    sources.push({ key: 'app', dir: APP_DIR })

  // Build a plan of directories to scan. Prioritize --dates over --months.
  const batchPlan = []

  if (datesArg) {
    const [startStr, endStr] = datesArg.includes(':')
      ? datesArg.split(':')
      : [datesArg, datesArg]
    const dateList = getDateRange(startStr, endStr)

    for (const s of sources) {
      for (const date of dateList) {
        const [year, month, day] = date.split('-')
        batchPlan.push({
          sourceKey: s.key,
          batchKey: date, // A day is a batch now
          dir: path.join(s.dir, year, month, day),
        })
      }
    }
  } else if (monthsArg.length > 0) {
    // Fallback to --months if --dates is not provided
    for (const s of sources) {
      for (const monthStr of monthsArg) {
        const [year, month] = monthStr.split('-')
        if (year && month) {
          batchPlan.push({
            sourceKey: s.key,
            batchKey: monthStr, // A month is a batch
            dir: path.join(s.dir, year, month),
          })
        }
      }
    }
  } else {
    // If no args, discover all month directories from the filesystem
    for (const s of sources) {
      const months = await listMonthDirs(s.dir)
      for (const m of months)
        batchPlan.push({ sourceKey: s.key, batchKey: m.key, dir: m.dir })
    }
  }

  // Sort by key for deterministic processing
  batchPlan.sort((a, b) =>
    a.batchKey < b.batchKey ? -1 : a.batchKey > b.batchKey ? 1 : 0
  )

  console.log(
    `Discovered ${batchPlan.length} batch(es) to process across ${sources.length} source(s).`
  )

  // Create pages for workers
  const pages = await Promise.all(
    Array.from({ length: concurrency }).map(() => newPage())
  )

  let grandTotal = 0,
    grandUpdated = 0,
    grandSkipped = 0,
    grandFailed = 0
  let remaining = limit

  for (const entry of batchPlan) {
    if (Number.isFinite(remaining) && remaining <= 0) break
    const remainingLimit = Number.isFinite(remaining)
      ? remaining
      : Number.MAX_SAFE_INTEGER

    // Each entry (day or month) gets its own context with the worker pages
    const stats = await processDirectoryBatch(
      entry.sourceKey,
      entry.batchKey,
      entry.dir,
      { dry, concurrency, retry, remainingLimit },
      { pages } // Pass pages to the batch processor
    )
    remaining = Number.isFinite(remaining)
      ? Math.max(0, remaining - stats.total)
      : remaining

    grandTotal += stats.total
    grandUpdated += stats.updated
    grandSkipped += stats.skipped
    grandFailed += stats.failed
  }

  // Cleanup browser
  await closeBrowser()

  // Write a last_run summary
  await fs.ensureDir(PROGRESS_DIR)
  const lastRunFile = path.join(PROGRESS_DIR, 'last_run.json')
  await fs.writeJson(
    lastRunFile,
    {
      ranAt: dayjs().toISOString(),
      sources: sources.map((s) => s.key),
      limit,
      concurrency,
      retry,
      dry,
      totals: {
        discoveredMonths: batchPlan.length,
        total: grandTotal,
        updated: grandUpdated,
        skipped: grandSkipped,
        failed: grandFailed,
      },
    },
    { spaces: 2 }
  )
  console.log(
    `\nAll done. Summary: total=${grandTotal}, updated=${grandUpdated}, skipped=${grandSkipped}, failed=${grandFailed}, dry=${dry}`
  )
  console.log(`Progress saved → ${lastRunFile}`)
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Unhandled error in run:', err)
    process.exit(1)
  })
}

module.exports = {
  run,
}

// Helpers for month-based batching
async function listMonthDirs(baseArticlesDir) {
  const months = []
  if (!(await fs.pathExists(baseArticlesDir))) return months
  const years = await fs
    .readdir(baseArticlesDir, { withFileTypes: true })
    .catch(() => [])
  for (const yEnt of years) {
    if (!yEnt.isDirectory()) continue
    const yDir = path.join(baseArticlesDir, yEnt.name)
    if (!/^\d{4}$/.test(yEnt.name)) continue
    const monthsEnt = await fs
      .readdir(yDir, { withFileTypes: true })
      .catch(() => [])
    for (const mEnt of monthsEnt) {
      if (!mEnt.isDirectory()) continue
      if (!/^\d{2}$/.test(mEnt.name)) continue
      const mDir = path.join(yDir, mEnt.name)
      months.push({ key: `${yEnt.name}-${mEnt.name}`, dir: mDir })
    }
  }
  // sort ascending by key YYYY-MM
  months.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return months
}

async function writeProgress(sourceKey, batchKey, payload) {
  await fs.ensureDir(PROGRESS_DIR)
  const file = path.join(PROGRESS_DIR, `${sourceKey}_${batchKey}.json`)
  const data = { source: sourceKey, batch: batchKey, ...payload }
  await fs.writeJson(file, data, { spaces: 2 })
  return file
}

async function processDirectoryBatch(sourceKey, batchKey, directory, options, ctx) {
  const { dry, concurrency, retry, remainingLimit } = options
  const { pages } = ctx

  if (!(await fs.pathExists(directory))) {
    console.log(`\n===== Skipping ${sourceKey.toUpperCase()} ${batchKey} (directory not found) =====`)
    return { total: 0, updated: 0, skipped: 0, failed: 0 }
  }

  // Gather candidates under the directory
  const candidates = []
  const isJsonFile = (file) => file.toLowerCase().endsWith('.json')
  for await (const f of walk(directory, isJsonFile)) {
    try {
      const json = await fs.readJson(f)
      if (isArticleContentMissing(json)) {
        candidates.push(f)
        if (candidates.length >= remainingLimit) break
      }
    } catch {}
    if (candidates.length >= remainingLimit) break
  }

  const startedAt = dayjs().toISOString()
  console.log(`\n===== ${sourceKey.toUpperCase()} ${batchKey} =====`)
  console.log(
    `Found ${candidates.length} candidate file(s) in batch ${batchKey}.`
  )
  console.log(
    `Pipeline: total=${candidates.length} | concurrency=${concurrency} | retry=${retry} | dry=${dry}`
  )

  let idx = 0
  let updated = 0,
    skipped = 0,
    failed = 0
  let inFlight = 0

  function printStats() {
    const done = updated + skipped + failed
    const queued = Math.max(0, candidates.length - done - inFlight)
    const ts = dayjs().format('HH:mm:ss')
    console.log(
      `[${ts}] [${sourceKey} ${batchKey}] queued=${queued} | in-flight=${inFlight} | updated=${updated} | skipped=${skipped} | failed=${failed}`
    )
  }

  printStats()
  const tick = setInterval(printStats, 2000)

  async function worker(page) {
    while (true) {
      const i = idx++
      if (i >= candidates.length) break
      const fp = candidates[i]
      inFlight++
      console.log(`→ [${i + 1}/${candidates.length}] Refetching: ${fp}`)
      let lastErr = null
      let finished = false
      for (let attempt = 1; attempt <= retry; attempt++) {
        // Pass the page to refetchForFile
        const res = await refetchForFile(fp, { dry }, { page })
        if (res.updated) {
          updated++
          lastErr = null
          finished = true
          console.log(`✓ Updated: ${path.basename(fp)}`)
          break
        }
        if (res.skipped) {
          skipped++
          lastErr = null
          finished = true
          console.log(`⏭️  Skipped (has content): ${path.basename(fp)}`)
          break
        }
        if (res.failed) {
          lastErr = res.error
          console.warn(
            `Retry ${attempt}/${retry} for ${path.basename(fp)} due to: ${lastErr}`
          )
          await sleep(500 * attempt)
          continue
        }
      }
      if (!finished && lastErr) {
        failed++
        console.error(`✗ Failed: ${fp} -> ${lastErr}`)
      }
      inFlight--
    }
  }

  const workers = pages.map((page) => worker(page))
  await Promise.all(workers)
  clearInterval(tick)
  printStats()

  const finishedAt = dayjs().toISOString()
  const progressFile = await writeProgress(sourceKey, batchKey, {
    startedAt,
    finishedAt,
    settings: { dry, concurrency, retry },
    counts: { total: candidates.length, updated, skipped, failed },
    completed: true,
  })
  console.log(`Saved month progress → ${progressFile}`)

  return { total: candidates.length, updated, skipped, failed }
}
