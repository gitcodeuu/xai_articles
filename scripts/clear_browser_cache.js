const puppeteer = require('puppeteer');

/**
 * Clear browser cache and cookies
 * Useful for resetting browser state between scraping sessions
 */
async function clearBrowserCache() {
  console.log('🧹 Starting browser cache cleanup...');
  
  let browser;
  
  try {
    // Launch browser (following project patterns)
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ]
    });

    console.log('✅ Browser launched');

    // Get first page
    const [page] = await browser.pages();
    
    // Clear cookies
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    
    console.log('✅ Browser cache cleared');
    console.log('✅ Cookies cleared');
    
    // Close browser
    await browser.close();
    console.log('✅ Browser closed');
    
    return { success: true };
    
  } catch (error) {
    console.error('❌ Failed to clear browser cache:', error.message);
    
    // Ensure browser is closed even on error
    if (browser) {
      await browser.close();
    }
    
    throw error;
  }
}

// Main execution (following project patterns)
if (require.main === module) {
  clearBrowserCache()
    .then(() => {
      console.log('✅ Cache cleanup completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Cache cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { clearBrowserCache };