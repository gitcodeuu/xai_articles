const fs = require('fs-extra')
const path = require('path')
const dayjs = require('dayjs')
const { newPage, closeBrowser } = require('../utils/browser')

const DATA_DIR = path.join(__dirname, '../data')
const PROGRESS_DIR = path.join(DATA_DIR, 'progress/refetch_nulls')

/**
 * Get current timestamp for logging
 */
function now() {
  return dayjs().format('HH:mm:ss')
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Discover batches to process, filtered by date if provided
 */
function discoverBatches(source, dateFilter) {
  const articlesDir = path.join(DATA_DIR, source, 'articles')
  
  if (!fs.existsSync(articlesDir)) {
    console.log(`⚠️  Articles directory not found: ${articlesDir}`)
    return []
  }

  const batches = []
  
  // If dateFilter is provided, only process that specific date
  if (dateFilter) {
    const targetDate = dayjs(dateFilter)
    if (!targetDate.isValid()) {
      console.error(`❌ Invalid date filter: ${dateFilter}`)
      return []
    }

    const year = targetDate.format('YYYY')
    const month = targetDate.format('MM')
    const monthDir = path.join(articlesDir, year, month)

    if (fs.existsSync(monthDir)) {
      batches.push({
        source,
        month: `${year}-${month}`,
        dir: monthDir,
        dateFilter: dateFilter // Pass the specific date filter
      })
      console.log(`   Found batch: ${year}-${month} for date ${dateFilter}`)
    } else {
      console.log(`⚠️  No articles found for ${year}-${month} in ${source}`)
    }

    return batches
  }

  // No date filter - process all months (existing behavior)
  const years = fs.readdirSync(articlesDir).filter(y => /^\d{4}$/.test(y))
  
  for (const year of years.sort()) {
    const yearDir = path.join(articlesDir, year)
    const months = fs.readdirSync(yearDir).filter(m => /^\d{2}$/.test(m))
    
    for (const month of months.sort()) {
      const monthDir = path.join(yearDir, month)
      batches.push({
        source,
        month: `${year}-${month}`,
        dir: monthDir
      })
    }
  }

  return batches
}

/**
 * Find candidate files with null/empty content in a batch directory
 */
function findCandidateFiles(batchDir, dateFilter = null) {
  const candidates = []

  // If dateFilter provided, only check that specific day
  if (dateFilter) {
    const targetDate = dayjs(dateFilter)
    const day = targetDate.format('DD')
    const dayDir = path.join(batchDir, day)

    if (!fs.existsSync(dayDir)) {
      console.log(`   Day directory not found: ${dayDir}`)
      return candidates
    }

    const files = fs.readdirSync(dayDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(dayDir, f))

    for (const file of files) {
      try {
        const article = fs.readJsonSync(file)
        if (!hasValidContent(article.content)) {
          candidates.push(file)
        }
      } catch (err) {
        console.error(`[${now()}] ⚠️  Error reading ${file}:`, err.message)
      }
    }

    return candidates
  }

  // No date filter - check all days in the month (existing behavior)
  const days = fs.readdirSync(batchDir).filter(d => /^\d{2}$/.test(d))

  for (const day of days) {
    const dayDir = path.join(batchDir, day)
    
    if (!fs.existsSync(dayDir)) {
      continue
    }

    const files = fs.readdirSync(dayDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(dayDir, f))

    for (const file of files) {
      try {
        const article = fs.readJsonSync(file)
        if (!hasValidContent(article.content)) {
          candidates.push(file)
        }
      } catch (err) {
        console.error(`[${now()}] ⚠️  Error reading ${file}:`, err.message)
      }
    }
  }

  return candidates
}

/**
 * Check if article has valid content
 */
function hasValidContent(content) {
  if (!content) return false
  if (typeof content !== 'string') return false
  if (content.trim().length < 50) return false
  return true
}

/**
 * Extract content from page based on source
 */
async function extractContent(page, source) {
  if (source === 'dawn') {
    return await page.evaluate(() => {
      const story = document.querySelector('.story')
      return story ? story.innerText.trim() : null
    })
  } else if (source === 'app') {
    return await page.evaluate(() => {
      const content = document.querySelector('.entry-content')
      return content ? content.innerText.trim() : null
    })
  }
  return null
}

/**
 * Refetch content for a single article
 */
async function refetchArticleContent(filePath, source, maxRetries, dryRun) {
  const article = await fs.readJson(filePath)
  
  if (hasValidContent(article.content)) {
    return 'skipped'
  }

  if (dryRun) {
    console.log(`[${now()}] [DRY] Would refetch: ${filePath}`)
    return 'skipped'
  }

  let lastError = null
  let page = null
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      page = await newPage()
      
      await page.goto(article.link, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      })

      const content = await extractContent(page, source)
      
      if (content && content.trim().length > 50) {
        article.content = content
        article.refetched = true
        article.refetchedAt = new Date().toISOString()
        
        await fs.writeJson(filePath, article, { spaces: 2 })
        console.log(`[${now()}] ✅ Updated: ${path.basename(filePath)}`)
        
        // Close page immediately after successful update
        await page.close()
        page = null
        return 'updated'
      }
      
      // Close page if content extraction failed
      await page.close()
      page = null
      lastError = new Error('Extracted content too short or empty')
      
    } catch (err) {
      // Ensure page is closed on error
      if (page) {
        try {
          await page.close()
        } catch (closeErr) {
          console.error(`[${now()}] ⚠️  Error closing page:`, closeErr.message)
        }
        page = null
      }
      
      lastError = err
      
      if (attempt < maxRetries) {
        console.log(`[${now()}] ⚠️  Attempt ${attempt}/${maxRetries} failed, retrying in ${2 * attempt}s...`)
        await sleep(2000 * attempt)
      }
    }
  }

  console.error(`[${now()}] ❌ Failed after ${maxRetries} attempts: ${path.basename(filePath)}`)
  if (lastError) {
    console.error(`[${now()}] Last error: ${lastError.message}`)
  }
  return 'failed'
}

/**
 * Log progress
 */
function logProgress(source, month, queued, inFlight, stats) {
  console.log(
    `[${now()}] [${source} ${month}] queued=${queued} | in-flight=${inFlight} | ` +
    `updated=${stats.updated} | skipped=${stats.skipped} | failed=${stats.failed}`
  )
}

/**
 * Save progress for a batch
 */
function saveProgress(source, month, data) {
  fs.ensureDirSync(PROGRESS_DIR)
  const file = path.join(PROGRESS_DIR, `${source}_${month}.json`)
  fs.writeJsonSync(file, data, { spaces: 2 })
  console.log(`Saved month progress → ${file}`)
}

/**
 * Save last run summary
 */
function saveLastRun(source, dateFilter, summary) {
  fs.ensureDirSync(PROGRESS_DIR)
  const file = path.join(PROGRESS_DIR, 'last_run.json')
  
  const data = {
    source,
    dateFilter,
    timestamp: new Date().toISOString(),
    ...summary
  }
  
  fs.writeJsonSync(file, data, { spaces: 2 })
  console.log(`Progress saved → ${file}`)
}

/**
 * Process a single source
 */
async function processSource(source, dateFilter, concurrency, maxRetries, dryRun) {
  console.log(`\n🚀 Starting content refetch process for ${source.toUpperCase()} source...`)
  
  if (dateFilter) {
    console.log(`   Filtering to date: ${dateFilter}`)
  }
  
  try {
    const batches = discoverBatches(source, dateFilter)
    console.log(`Discovered ${batches.length} batch(es) to process across 1 source(s).`)

    if (batches.length === 0) {
      console.log(`⚠️  No batches found for ${source} with date filter: ${dateFilter || 'none'}`)
      return {
        total: 0,
        updated: 0,
        skipped: 0,
        failed: 0
      }
    }

    let totalStats = {
      total: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    }

    for (const batch of batches) {
      console.log(`\n===== ${source.toUpperCase()} ${batch.month} =====`)
      
      const candidates = findCandidateFiles(batch.dir, batch.dateFilter)
      console.log(`Found ${candidates.length} candidate file(s) in batch ${batch.month}.`)

      if (candidates.length === 0) {
        const emptyStats = {
          total: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          timestamp: new Date().toISOString()
        }
        logProgress(source, batch.month, 0, 0, emptyStats)
        saveProgress(source, batch.month, emptyStats)
        continue
      }

      console.log(`Pipeline: total=${candidates.length} | concurrency=${concurrency} | retry=${maxRetries} | dry=${dryRun}`)

      const stats = {
        total: candidates.length,
        updated: 0,
        skipped: 0,
        failed: 0
      }

      const queue = [...candidates]
      const inFlight = new Set()

      const workers = Array.from({ length: concurrency }, () => 
        (async () => {
          while (queue.length > 0 || inFlight.size > 0) {
            if (queue.length === 0) {
              await sleep(100)
              continue
            }

            const file = queue.shift()
            if (!file) continue
            
            inFlight.add(file)

            logProgress(source, batch.month, queue.length, inFlight.size, stats)

            try {
              const result = await refetchArticleContent(file, source, maxRetries, dryRun)
              
              if (result === 'updated') stats.updated++
              else if (result === 'skipped') stats.skipped++
              else if (result === 'failed') stats.failed++
            } catch (err) {
              console.error(`[${now()}] ❌ Error processing ${file}:`, err.message)
              stats.failed++
            } finally {
              inFlight.delete(file)
            }

            await sleep(500)
          }
        })()
      )

      await Promise.all(workers)

      logProgress(source, batch.month, 0, 0, stats)
      saveProgress(source, batch.month, {
        ...stats,
        timestamp: new Date().toISOString()
      })

      // Accumulate stats
      totalStats.total += stats.total
      totalStats.updated += stats.updated
      totalStats.skipped += stats.skipped
      totalStats.failed += stats.failed
    }

    console.log(`\nAll done. Summary: total=${totalStats.total}, updated=${totalStats.updated}, skipped=${totalStats.skipped}, failed=${totalStats.failed}, dry=${dryRun}`)
    console.log(`✅ Content refetch process for ${source.toUpperCase()} source completed.`)
    
    saveLastRun(source, dateFilter, { ...totalStats, dryRun })
    
    return totalStats
  } catch (err) {
    console.error(`❌ Content refetch process for ${source.toUpperCase()} source failed:`, err)
    throw err
  }
}

/**
 * Main entry point
 */
async function main() {
  const argv = require('minimist')(process.argv.slice(2))
  
  const source = (argv.source || 'both').toLowerCase()
  const dateFilter = argv.dates || null
  const concurrency = parseInt(argv.concurrency || '2', 10)
  const maxRetries = parseInt(argv.retry || '2', 10)
  const dryRun = argv.dry === true || argv.dryRun === true

  if (!['dawn', 'app', 'both'].includes(source)) {
    console.error('❌ Invalid --source. Use: dawn, app, or both')
    process.exit(1)
  }

  console.log('\n' + '='.repeat(50))
  console.log('🔄 Content Refetch Utility')
  console.log('='.repeat(50))
  console.log(`Source:      ${source}`)
  console.log(`Date filter: ${dateFilter || 'none (all dates)'}`)
  console.log(`Concurrency: ${concurrency}`)
  console.log(`Max retries: ${maxRetries}`)
  console.log(`Dry run:     ${dryRun}`)
  console.log('='.repeat(50))

  const sources = source === 'both' ? ['dawn', 'app'] : [source]

  try {
    for (const src of sources) {
      await processSource(src, dateFilter, concurrency, maxRetries, dryRun)
    }

    console.log('\n' + '='.repeat(50))
    console.log('✅ All refetch operations completed successfully')
    console.log('='.repeat(50))
  } catch (err) {
    console.error('\n' + '='.repeat(50))
    console.error('❌ Refetch process failed:', err.message)
    console.error('='.repeat(50))
    process.exit(1)
  } finally {
    // CRITICAL: Ensure browser is always closed
    console.log('\n🔄 Closing browser...')
    await closeBrowser()
    console.log('✅ Browser closed successfully')
  }
}

if (require.main === module) {
  main()
}

module.exports = { 
  refetchArticleContent, 
  processSource,
  discoverBatches,
  findCandidateFiles 
}