const puppeteer = require('puppeteer');

/**
 * Get storage usage information
 * @param {Object} client - CDP session client
 * @returns {Object} Storage usage details
 */
async function getStorageUsage(client) {
  try {
    const { usage } = await client.send('Storage.getUsageAndQuota', {
      origin: 'https://example.com'
    });
    return usage || 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Get cookies count
 * @param {Object} client - CDP session client
 * @returns {number} Number of cookies
 */
async function getCookiesCount(client) {
  try {
    const { cookies } = await client.send('Network.getAllCookies');
    return cookies ? cookies.length : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Format bytes to human-readable size
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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
    
    // Create CDP session
    const client = await page.target().createCDPSession();
    
    // Get storage info before clearing
    console.log('\n📊 Collecting storage information...');
    const cookiesCountBefore = await getCookiesCount(client);
    const storageUsageBefore = await getStorageUsage(client);
    
    console.log(`   Cookies: ${cookiesCountBefore}`);
    console.log(`   Storage usage: ${formatBytes(storageUsageBefore)}`);
    
    // Clear cache and cookies
    console.log('\n🗑️  Clearing cache and cookies...');
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    
    // Small delay to ensure clearing is complete
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Get storage info after clearing
    const cookiesCountAfter = await getCookiesCount(client);
    const storageUsageAfter = await getStorageUsage(client);
    
    // Calculate what was cleared
    const cookiesCleared = cookiesCountBefore - cookiesCountAfter;
    const storageCleared = storageUsageBefore - storageUsageAfter;
    
    // Display results
    console.log('\n✅ Cleanup completed!');
    console.log(`   🍪 Cookies cleared: ${cookiesCleared}`);
    console.log(`   💾 Storage freed: ${formatBytes(storageCleared)}`);
    
    if (storageCleared > 0 || cookiesCleared > 0) {
      console.log(`   📉 Total reduction: ${formatBytes(storageCleared)}`);
    } else {
      console.log('   ℹ️  Cache was already empty');
    }
    
    // Close browser
    await browser.close();
    console.log('\n✅ Browser closed');
    
    return { 
      success: true,
      cookiesCleared,
      storageCleared,
      storageClearedFormatted: formatBytes(storageCleared)
    };
    
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
    .then((result) => {
      console.log('\n✅ Cache cleanup completed successfully');
      console.log(`   Final stats: ${result.cookiesCleared} cookies, ${result.storageClearedFormatted} storage`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Cache cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { clearBrowserCache };