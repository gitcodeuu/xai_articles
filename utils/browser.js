const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { SCRAPER_CONFIG, randOf } = require('../config')

puppeteer.use(StealthPlugin())

let browserInstance = null

/**
 * Detect if running inside Docker container
 */
function isDockerEnvironment() {
  return process.env.DOCKER_ENV === 'true' || 
         process.env.PUPPETEER_EXECUTABLE_PATH !== undefined
}

async function getBrowser() {
  if (!browserInstance) {
    const isDocker = isDockerEnvironment()
    
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--safebrowsing-disable-auto-update',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--disable-hang-monitor',
        '--disable-logging',
        '--log-level=3'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      timeout: 30000
    }

    // Docker-specific configuration
    if (isDocker && process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
      
      // Tell Chromium to ignore missing crash handler
      launchOptions.env = {
        ...process.env,
        CHROME_CRASHPAD_PIPE_NAME: '',
        BREAKPAD_DUMP_LOCATION: ''
      }
      
      console.log('🐳 Running in Docker with Chromium:', launchOptions.executablePath)
    }

    try {
      browserInstance = await puppeteer.launch(launchOptions)
      console.log('✅ Browser launched successfully')
    } catch (err) {
      console.error('❌ Failed to launch browser:', err.message)
      throw err
    }
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
      // Silently handle request errors
    }
  })

  return page
}

async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close()
      browserInstance = null
      console.log('✅ Browser closed')
    } catch (err) {
      console.error('⚠️  Error closing browser:', err.message)
      browserInstance = null
    }
  }
}

module.exports = {
  getBrowser,
  newPage,
  closeBrowser,
}