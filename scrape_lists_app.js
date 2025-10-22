// scrape_lists_app.js — scrapes article lists from APP news section
// Usage:
//   node scrape_lists_app.js --latest
//   node scrape_lists_app.js --startPage 1 --endPage 10
// Examples (pnpm):
//   pnpm run app:lists

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs-extra')
const path = require('path')
const dayjs = require('dayjs')
const minimist = require('minimist')

const { buildDatedPath, sleep, jitter } = require('./utils/helpers')
const { createLogStream } = require('./utils/logger')
const { newPage, closeBrowser } = require('./utils/browser')

puppeteer.use(StealthPlugin())

const LIST_DIR = path.join(__dirname, 'data', 'app', 'lists')
const LOG_DIR = path.join(__dirname, 'data', 'app', 'logs')
const BASE_URL = 'https://www.app.com.pk/national/'

fs.ensureDirSync(LIST_DIR)
fs.ensureDirSync(LOG_DIR)

/**
 * Creates a logger instance specifically for APP list scraping
 * @returns {Function} Log function that writes to file and console
 */
function makeLogger() {
  const log = createLogStream('app_lists', { subDir: 'app/logs' })
  return log
}

/**
 * Scrapes article list from a single APP page
 * @param {number} pageNum - Page number to scrape
 * @param {Function} log - Logger function
 * @returns {Promise<Array>} Array of article metadata
 */
async function scrapeListPage(pageNum, log) {
  const page = await newPage()
  const articles = []

  try {
    const url = pageNum === 1 ? BASE_URL : `${BASE_URL}page/${pageNum}/`
    
    log(`📄 Scraping page ${pageNum}: ${url}`)
    
    await sleep(jitter(1000, 2000))
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(jitter(1000, 2000))

    // Extract article list from the page
    const scrapedArticles = await page.evaluate(() => {
      const items = []
      
      // APP uses .td-block-row for article listings
      const articleElements = document.querySelectorAll('.td-block-row .td-module-thumb, .td-module-container')
      
      articleElements.forEach((element) => {
        // Find the link and title
        const linkElement = element.querySelector('a[href]') ||
                           element.querySelector('.entry-title a')
        
        if (!linkElement) return
        
        const url = linkElement.href
        const titleElement = element.querySelector('.entry-title') ||
                            element.querySelector('h3') ||
                            linkElement
        
        const title = titleElement?.innerText?.trim() || linkElement.title || ''
        
        if (url && title) {
          // Extract date from the page (APP shows dates in article listings)
          const dateElement = element.querySelector('.td-post-date time') ||
                             element.querySelector('time') ||
                             element.querySelector('.post-date')
          
          let datePublished = null
          if (dateElement) {
            const datetime = dateElement.getAttribute('datetime') ||
                           dateElement.innerText?.trim()
            
            if (datetime) {
              try {
                const parsed = new Date(datetime)
                if (!isNaN(parsed.getTime())) {
                  datePublished = parsed.toISOString()
                }
              } catch (e) {
                // Date parsing failed
              }
            }
          }
          
          items.push({
            title,
            link: url,
            category: 'National',
            datePublished: datePublished,
            scrapedAt: new Date().toISOString()
          })
        }
      })
      
      return items
    })

    articles.push(...scrapedArticles)
    log(`✅ Found ${scrapedArticles.length} articles on page ${pageNum}`)
    
  } catch (error) {
    log(`❌ Failed to scrape page ${pageNum}: ${error.message}`)
  } finally {
    await page.close()
  }

  return articles
}

/**
 * Groups articles by date and saves to dated list files
 * @param {Array} articles - Array of article metadata
 * @param {Function} log - Logger function
 */
async function saveArticlesByDate(articles, log) {
  // Group articles by date
  const articlesByDate = {}
  
  for (const article of articles) {
    let dateKey = null
    
    if (article.datePublished) {
      // Extract YYYY-MM-DD from ISO string
      dateKey = article.datePublished.split('T')[0]
    } else {
      // Fallback to today's date
      dateKey = dayjs().format('YYYY-MM-DD')
    }
    
    if (!articlesByDate[dateKey]) {
      articlesByDate[dateKey] = []
    }
    
    articlesByDate[dateKey].push(article)
  }
  
  // Save each date's articles to its own file
  for (const [dateStr, dateArticles] of Object.entries(articlesByDate)) {
    const dateFolder = buildDatedPath(LIST_DIR, dateStr)
    await fs.ensureDir(dateFolder)
    
    const listPath = path.join(dateFolder, `list_${dateStr}.json`)
    
    // If file exists, merge with existing articles
    let existingArticles = []
    if (await fs.pathExists(listPath)) {
      existingArticles = await fs.readJson(listPath)
    }
    
    // Deduplicate by URL
    const urlSet = new Set(existingArticles.map(a => a.link))
    const newArticles = dateArticles.filter(a => !urlSet.has(a.link))
    
    const allArticles = [...existingArticles, ...newArticles]
    
    await fs.writeJson(listPath, allArticles, { spaces: 2 })
    
    log(`💾 Saved ${allArticles.length} articles for ${dateStr} (${newArticles.length} new)`)
  }
}

/**
 * Main function to scrape APP lists
 * @param {Object} options - Scraping options
 */
async function main(options = {}) {
  const argv = minimist(process.argv.slice(2))
  const log = makeLogger()
  
  let startPage = 1
  let endPage = 1
  
  if (argv.latest) {
    // Scrape only the latest page
    startPage = 1
    endPage = 1
    log('📰 Scraping latest APP articles (page 1)')
  } else if (argv.startPage && argv.endPage) {
    // Scrape a range of pages
    startPage = parseInt(argv.startPage, 10)
    endPage = parseInt(argv.endPage, 10)
    log(`📰 Scraping APP articles from page ${startPage} to ${endPage}`)
  } else {
    console.error('Usage:')
    console.error('  node scrape_lists_app.js --latest')
    console.error('  node scrape_lists_app.js --startPage 1 --endPage 10')
    process.exit(1)
  }
  
  const allArticles = []
  
  // Scrape each page
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const articles = await scrapeListPage(pageNum, log)
    allArticles.push(...articles)
    
    // Delay between pages
    if (pageNum < endPage) {
      await sleep(jitter(3000, 5000))
    }
  }
  
  log(`📊 Total articles scraped: ${allArticles.length}`)
  
  // Save articles grouped by date
  if (allArticles.length > 0) {
    await saveArticlesByDate(allArticles, log)
  }
  
  log('✅ APP list scraping completed.')
  
  await closeBrowser()
}

if (require.main === module) {
  main()
}

module.exports = { main, scrapeListPage, saveArticlesByDate }