// scrape_articles_app.js — scrapes full article content from APP using list files
// Usage:
//   node scrape_articles_app.js --fromDate YYYY-MM-DD [--toDate YYYY-MM-DD]
// Examples (pnpm):
//   pnpm run app:articles -- --fromDate 2025-08-15
//   pnpm run app:articles -- --fromDate 2025-08-01 --toDate 2025-08-07

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto')
const dayjs = require('dayjs')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
const customParseFormat = require('dayjs/plugin/customParseFormat')
const minimist = require('minimist')

const { buildDatedPath, sleep, jitter, chunkArray } = require('./utils/helpers')
const { normalizeArticle } = require('./utils/schema')
const { createLogStream } = require('./utils/logger')
const { newPage, closeBrowser } = require('./utils/browser')

puppeteer.use(StealthPlugin())
dayjs.extend(isSameOrBefore)
dayjs.extend(customParseFormat)

const LIST_DIR = path.join(__dirname, 'data', 'app', 'lists')
const ARTICLE_DIR = path.join(__dirname, 'data', 'app', 'articles')
const LOG_DIR = path.join(__dirname, 'data', 'app', 'logs')
const BATCH_SIZE = 8
const STATS_FILE = path.join(LOG_DIR, 'stats_articles.json')

fs.ensureDirSync(ARTICLE_DIR)
fs.ensureDirSync(LOG_DIR)

/**
 * Creates a logger instance specifically for APP article scraping
 * @returns {Function} Log function that writes to file and console
 */
function makeLogger() {
  const log = createLogStream('app_articles', { subDir: 'app/logs' })
  return log
}

/**
 * Safely extract a URL from a list item
 * @param {Object} item
 * @returns {string|null}
 */
function getUrlFromItem(item) {
  const candidate =
    item?.link ||
    item?.url ||
    item?.href ||
    item?.permalink ||
    null

  return (typeof candidate === 'string' && candidate.trim().length > 0) ? candidate.trim() : null
}

/**
 * Generate MD5 hash from input (robust)
 * @param {string} input
 * @param {string} fallbackSeed
 * @returns {string}
 */
function generateFilenameHash(input, fallbackSeed = '') {
  const s = (typeof input === 'string' && input.length) ? input : fallbackSeed
  if (!s) return crypto.randomBytes(8).toString('hex')
  return crypto.createHash('md5').update(s).digest('hex')
}

/**
 * Normalize and sanitize article content
 * @param {string} text - Raw text content
 * @returns {string} Sanitized content
 */
function sanitizeContent(text) {
  if (typeof text !== 'string') return text
  
  // Normalize line endings to \n
  let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  
  // Collapse multiple blank lines into double newline (paragraph separation)
  t = t.replace(/\n{3,}/g, '\n\n')
  
  // Trim trailing spaces on each line
  t = t.split('\n').map(line => line.replace(/[\t ]+$/g, '')).join('\n')
  
  // Unicode normalization to NFC
  try { 
    t = t.normalize('NFC') 
  } catch (e) {
    // Ignore normalization errors
  }
  
  // Final trim
  return t.trim()
}

/**
 * Scrapes full content from a single article
 * @param {Object} item - Article metadata from list file
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Function} log - Logger function
 * @param {number} [indexSeed] - Optional index used for fallback hashing
 * @returns {Promise<Object>} Result object with success status
 */
async function scrapeArticle(item, date, log, indexSeed = 0) {
  const link = getUrlFromItem(item)
  const title = (item?.title || item?.headline || '').trim()

  // Skip items without a URL
  if (!link) {
    log(`⏭️  [${date}] Skipping item without URL: "${title?.slice(0, 60) || '(no title)'}"`)
    return { success: true, skipped: true }
  }
  
  // Generate filename from URL hash (robust)
  const hash = generateFilenameHash(link, `${date}-${indexSeed}`)
  const dateFolder = buildDatedPath(ARTICLE_DIR, date)
  await fs.ensureDir(dateFolder)
  const outPath = path.join(dateFolder, `${date}_${hash}.json`)

  // Skip if already scraped
  if (await fs.pathExists(outPath)) {
    log(`⏭️  [${date}] Already exists: ${date}_${hash}.json`)
    return { success: true, skipped: true }
  }

  const page = await newPage()

  try {
    await sleep(jitter(500, 1500))
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 })
    
    // Wait for content to load
    await page.waitForSelector('.td-post-content p, .tdb_single_content p, .tdb-block-inner p, article p', { 
      timeout: 10000 
    }).catch(() => {})
    
    await sleep(jitter(1000, 2000))

    // Extract article content and metadata from the page
    const scrapedData = await page.evaluate(() => {
      // Helper function to check if element is hidden
      function isHidden(el) {
        const cs = window.getComputedStyle(el)
        return cs && (cs.display === 'none' || cs.visibility === 'hidden')
      }

      // Helper function to collect paragraphs
      function collectParagraphs() {
        const selectors = [
          '.td-post-content p',
          '.tdb_single_content p',
          '.tdb-block-inner p',
          'article .td-post-content p',
          'article p'
        ]
        
        const paras = []
        const seen = new Set()
        
        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(p => {
            if (!p) return
            if (isHidden(p)) return
            
            // Skip paragraphs inside unwanted containers
            if (p.closest('figure, header, footer, aside, nav, .td-post-featured-image, .tdb-author-box, .social-share, .related-posts')) {
              return
            }
            
            const t = (p.textContent || '').trim()
            if (!t) return
            if (t.length < 20) return
            
            const norm = t.replace(/\s+/g, ' ')
            if (seen.has(norm)) return
            if (/^(advertisement|ad:|sponsored)/i.test(norm)) return
            
            paras.push(t)
            seen.add(norm)
          })
        })
        
        // Fallback: try generic blocks inside tdb-block-inner
        if (paras.length < 3) {
          document.querySelectorAll('.tdb-block-inner > div').forEach(d => {
            const t = (d.textContent || '').trim()
            if (t && t.length > 40 && !/advertisement/i.test(t)) {
              paras.push(t)
            }
          })
        }
        
        return paras
      }

      const paras = collectParagraphs()
      const content = paras.join('\n\n')

      // Extract title - prefer on-page heading, fallback to og:title, then document.title
      let pageTitle = null
      const h1 = document.querySelector('h1.entry-title, h1.tdb-title-text, h1.td-page-title')
      if (h1 && h1.textContent) {
        pageTitle = h1.textContent.trim()
      } else {
        const og = document.querySelector('meta[property="og:title"]')
        pageTitle = (og?.getAttribute('content') || document.title || '').trim()
      }

      // Extract published date
      let datePublished = null
      const dateSelectors = [
        'time[datetime]',
        'time.entry-date',
        '.td-post-date time',
        '.entry-date',
        'meta[property="article:published_time"]',
        'meta[name="publish-date"]',
        'meta[name="date"]'
      ]
      
      for (const selector of dateSelectors) {
        const dateElement = document.querySelector(selector)
        if (dateElement) {
          const datetime = dateElement.getAttribute('datetime') ||
                          dateElement.getAttribute('content') ||
                          dateElement.textContent?.trim()
          
          if (datetime) {
            try {
              const parsed = new Date(datetime)
              if (!isNaN(parsed.getTime())) {
                datePublished = parsed.toISOString()
                break
              }
            } catch (e) {
              // Continue to next selector
            }
          }
        }
      }

      // Extract author
      const authorSelectors = [
        '.td-post-author-name a',
        '.author-name',
        '[rel="author"]',
        '.entry-author',
        'meta[name="author"]'
      ]
      
      let author = null
      for (const selector of authorSelectors) {
        const authorElement = document.querySelector(selector)
        if (authorElement) {
          author = authorElement.textContent?.trim() || 
                  authorElement.getAttribute('content') || null
          if (author) break
        }
      }

      // Extract image
      const imageSelectors = [
        '.td-post-featured-image img',
        '.entry-thumb img',
        'article img.wp-post-image',
        'meta[property="og:image"]'
      ]
      
      let image = null
      for (const selector of imageSelectors) {
        const imageElement = document.querySelector(selector)
        if (imageElement) {
          image = imageElement.getAttribute('src') || 
                 imageElement.getAttribute('content') || null
          if (image && !image.includes('Fall-Back-Image')) break
        }
      }

      return { content, pageTitle, datePublished, author, image }
    })

    // Sanitize content
    const cleanContent = sanitizeContent(scrapedData.content)

    // Validate content - must have meaningful text
    if (!cleanContent || cleanContent.length < 50) {
      log(`⚠️  [${date}] Empty/short content: ${title.substring(0, 50)}... (${cleanContent?.length || 0} chars)`)
      throw new Error('Empty or too short content extracted')
    }

    // Use extracted title if available, fallback to list title
    const finalTitle = scrapedData.pageTitle || title

    // Build complete article object with all metadata fields properly filled
    const article = {
      title: finalTitle,
      author: scrapedData.author || item.author || null,
      content: cleanContent,
      tags: item.tags || [],
      categories: item.categories || [item.category || 'National'],
      image: scrapedData.image || null,
      retrievedAt: new Date().toISOString(),
      source: 'APP',
      link,
      dateList: date,
      date_published: scrapedData.datePublished || item.datePublished || new Date(date).toISOString()
    }

    // Normalize using schema
    const normalizedArticle = normalizeArticle(article)

    await fs.writeJson(outPath, normalizedArticle, { spaces: 2 })
    
    log(`✅ Saved: ${date}_${hash}.json (${cleanContent.length} chars)`)
    
    return { 
      success: true, 
      skipped: false, 
      filename: `${date}_${hash}.json`,
      contentLength: cleanContent.length
    }
  } catch (err) {
    log(`❌ [${date}] Failed: ${title.substring(0, 60)}... - ${err.message}`)
    return { success: false, error: err.message, url: link }
  } finally {
    await page.close()
  }
}

/**
 * Processes articles for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Function} log - Logger function
 * @returns {Promise<Object>} Statistics object
 */
async function processDateArticles(date, log) {
  const listPath = path.join(
    buildDatedPath(LIST_DIR, date),
    `list_${date}.json`
  )

  if (!(await fs.pathExists(listPath))) {
    log(`⚠️  [${date}] List file not found: ${listPath}`)
    return { success: 0, failed: 0, skipped: 0, total: 0 }
  }

  const listJson = await fs.readJson(listPath)
  const items = Array.isArray(listJson)
    ? listJson
    : (Array.isArray(listJson?.articles) ? listJson.articles : [])

  log(`[📅 Processing LIST for: ${date}]`)
  
  let success = 0
  let failed = 0
  let skipped = 0
  let totalContentLength = 0

  // Process articles in batches with concurrency
  for (const batch of chunkArray(items, BATCH_SIZE)) {
    const results = await Promise.all(
      batch.map(async (item, idx) => {
        await sleep(jitter(200, 800))
        return await scrapeArticle(item, date, log, idx)
      })
    )

    // Count results
    results.forEach(result => {
      if (result.success && result.skipped) {
        skipped++
      } else if (result.success) {
        success++
        totalContentLength += (result.contentLength || 0)
      } else {
        failed++
      }
    })

    // Log failed URLs for debugging
    const failedResults = results.filter(r => !r.success && r.url)
    if (failedResults.length > 0) {
      log(`⚠️  Failed URLs in this batch:`)
      failedResults.forEach(r => log(`   - ${r.url}: ${r.error}`))
    }

    // Delay between batches
    await sleep(jitter(2000, 4000))
  }

  const avgLength = success > 0 ? Math.round(totalContentLength / success) : 0

  log(`🎯 Finished ${date}`)
  log(`   📊 Success: ${success} | Skipped: ${skipped} | Failed: ${failed} | Total: ${items.length}`)
  log(`   📝 Avg content length: ${avgLength} chars`)
  
  return { success, failed, skipped, total: items.length, avgContentLength: avgLength }
}

/**
 * Main entry point for the scraper
 * @param {Object} options - Command line options
 */
async function main(options = {}) {
  const argv = minimist(process.argv.slice(2))
  const log = makeLogger()

  try {
    // Parse date range from arguments (env DATE can also be used outside this script)
    let fromDate = argv.fromDate || dayjs().format('YYYY-MM-DD')
    let toDate = argv.toDate || fromDate

    // Validate dates
    const start = dayjs(fromDate, 'YYYY-MM-DD')
    const end = dayjs(toDate, 'YYYY-MM-DD')

    if (!start.isValid() || !end.isValid()) {
      console.error('❌ Invalid date format. Use --fromDate YYYY-MM-DD --toDate YYYY-MM-DD')
      process.exit(1)
    }

    // Build date array
    const dates = []
    let current = start
    while (current.isSameOrBefore(end)) {
      dates.push(current.format('YYYY-MM-DD'))
      current = current.add(1, 'day')
    }

    const stats = {}

    // Process each date
    for (const date of dates) {
      const result = await processDateArticles(date, log)
      stats[date] = result
    }

    // Save statistics
    await fs.writeJson(STATS_FILE, stats, { spaces: 2 })

    log('✅ APP article scraping completed.')
    log(`📊 Final Stats:\n${JSON.stringify(stats, null, 2)}`)
    
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

module.exports = { main, scrapeArticle, processDateArticles, generateFilenameHash, getUrlFromItem }