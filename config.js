// config.js
const os = require('os')

// Global scraping configurations
const SCRAPER_CONFIG = {
  // Concurrency settings for running multiple puppeteer instances
  CONCURRENCY: Math.min(8, Math.max(4, os.cpus().length)),

  // Max retries for a failed scrape attempt
  MAX_RETRIES: 3,

  // A pool of user agents to rotate through
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  ],

  // Viewports to simulate different screen sizes
  VIEWPORTS: [
    { width: 1280, height: 800, deviceScaleFactor: 1 },
    { width: 1366, height: 768, deviceScaleFactor: 1 },
    { width: 1440, height: 900, deviceScaleFactor: 1 },
    { width: 1920, height: 1080, deviceScaleFactor: 1 },
    { width: 414, height: 896, deviceScaleFactor: 2 },
    { width: 390, height: 844, deviceScaleFactor: 3 },
  ],

  // Resource types to block for faster page loads
  BLOCK_RESOURCE_TYPES: new Set(['image', 'media', 'font', 'stylesheet']),

  // URL patterns to block (analytics, ads, etc.)
  BLOCK_URL_PATTERNS: [
    'googletagmanager.com',
    'google-analytics.com',
    'doubleclick.net',
    'facebook.net',
    'optimizely.com',
    'hotjar.com',
  ],

  // Language preferences for requests
  LANGUAGE_PREFS: ['en-PK,en;q=0.9', 'en-GB,en;q=0.9', 'en-US,en;q=0.9'],
}

// Helper function to get a random item from an array
function randOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

module.exports = {
  SCRAPER_CONFIG,
  randOf,
}
