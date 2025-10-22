const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

puppeteer.use(StealthPlugin())

let browser = null
let pagePool = []

/**
 * Get browser configuration based on environment
 * @returns {Object} Browser launch configuration
 */
function getBrowserConfig() {
  const isDocker = process.env.DOCKER_ENV === 'true'
  
  if (isDocker) {
    return {
      headless: true,
      executablePath: '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-features=AudioServiceOutOfProcess',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-notifications',
        '--disable-offer-store-unmasked-wallet-cards',
        '--disable-popup-blocking',
        '--disable-print-preview',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-setuid-sandbox',
        '--disable-speech-api',
        '--disable-sync',
        '--hide-scrollbars',
        '--ignore-gpu-blacklist',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run',
        '--no-pings',
        '--no-zygote',
        '--password-store=basic',
        '--use-gl=swiftshader',
        '--use-mock-keychain'
      ]
    }
  }
  
  return {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  }
}

/**
 * Launch a shared browser instance
 * @returns {Promise<Browser>} Puppeteer browser instance
 */
async function launchBrowser() {
  if (browser && browser.isConnected()) {
    return browser
  }
  
  const config = getBrowserConfig()
  const isDocker = process.env.DOCKER_ENV === 'true'
  
  if (isDocker) {
    console.log('🐳 Running in Docker with Chromium:', config.executablePath)
  } else {
    console.log('💻 Running locally with bundled Chromium')
  }
  
  browser = await puppeteer.launch(config)
  
  console.log('✅ Browser launched successfully')
  
  return browser
}

/**
 * Create a new page from the shared browser instance
 * @returns {Promise<Page>} Puppeteer page instance
 */
async function newPage() {
  if (!browser || !browser.isConnected()) {
    await launchBrowser()
  }
  
  const page = await browser.newPage()
  
  // Set viewport
  await page.setViewport({ width: 1280, height: 800 })
  
  // Set user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )
  
  // Track page in pool
  pagePool.push(page)
  
  return page
}

/**
 * Close all pages and the browser instance
 * Ensures clean shutdown of the browser
 * @returns {Promise<void>}
 */
async function closeBrowser() {
  try {
    // Close all pages first
    if (pagePool.length > 0) {
      console.log(`🧹 Closing ${pagePool.length} open page(s)...`)
      
      await Promise.all(
        pagePool.map(async (page) => {
          try {
            if (page && !page.isClosed()) {
              await page.close()
            }
          } catch (err) {
            // Ignore errors when closing individual pages
          }
        })
      )
      
      pagePool = []
    }
    
    // Close the browser
    if (browser && browser.isConnected()) {
      await browser.close()
      browser = null
      console.log('✅ Browser closed')
    }
    
    // Force exit after a short delay to ensure cleanup
    setTimeout(() => {
      process.exit(0)
    }, 100)
    
  } catch (err) {
    console.error('❌ Error closing browser:', err.message)
    // Force exit even on error
    process.exit(1)
  }
}

/**
 * Get the current browser instance (if any)
 * @returns {Browser|null} Current browser instance or null
 */
function getBrowser() {
  return browser
}

module.exports = {
  launchBrowser,
  newPage,
  closeBrowser,
  getBrowser,
  getBrowserConfig
}