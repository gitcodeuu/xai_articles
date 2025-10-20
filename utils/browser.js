// utils/browser.js
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { SCRAPER_CONFIG, randOf } = require('../config')

puppeteer.use(StealthPlugin())

let browserInstance = null

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    })
  }
  return browserInstance
}

async function newPage() {
  const browser = await getBrowser()
  const page = await browser.newPage()

  // Configure page with settings from config.js
  await page.setUserAgent(randOf(SCRAPER_CONFIG.USER_AGENTS))
  await page.setViewport(randOf(SCRAPER_CONFIG.VIEWPORTS))
  await page.setExtraHTTPHeaders({
    'Accept-Language': randOf(SCRAPER_CONFIG.LANGUAGE_PREFS),
  })

  // Setup request interception to block resources
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    try {
      if (
        SCRAPER_CONFIG.BLOCK_RESOURCE_TYPES.has(req.resourceType()) ||
        SCRAPER_CONFIG.BLOCK_URL_PATTERNS.some((pattern) =>
          req.url().includes(pattern)
        )
      ) {
        req.abort().catch(() => {})
      } else {
        req.continue().catch(() => {})
      }
    } catch (e) {
      // console.warn(`Request handling error: ${e.message}`)
    }
  })

  return page
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close()
    browserInstance = null
  }
}

module.exports = {
  getBrowser,
  newPage,
  closeBrowser,
}
