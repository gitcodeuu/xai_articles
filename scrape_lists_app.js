#!/usr/bin/env node

/**
 * APP Lists Scraper
 * Following Puppeteer patterns: async/await, proper browser cleanup
 * 
 * Usage:
 *   node scrape_lists_app.js --latest
 *   node scrape_lists_app.js --date YYYY-MM-DD
 *   node scrape_lists_app.js --startPage 1 --endPage 10
 */

const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');

// Parse command line arguments
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--latest') {
      args.latest = true;
    } else if (arg === '--date') {
      args.date = argv[++i];
    } else if (arg === '--startPage') {
      args.startPage = parseInt(argv[++i], 10);
    } else if (arg === '--endPage') {
      args.endPage = parseInt(argv[++i], 10);
    }
  }
  return args;
}

function isValidDateStr(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function getTodayDate() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateParts(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return { y, m, d };
}

function getAppListPath(dateStr) {
  const { y, m, d } = getDateParts(dateStr);
  return path.join(__dirname, 'data', 'app', 'lists', y, m, d, `list_${dateStr}.json`);
}

// Launch browser following Puppeteer patterns
async function launchBrowser() {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const isDocker = process.env.DOCKER_ENV === 'true';

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ];

  if (isDocker) {
    console.log('🐳 Running in Docker with Chromium:', executablePath || '(default)');
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args,
  });

  console.log('✅ Browser launched successfully');
  return browser;
}

function getPageUrl(pageNum) {
  if (pageNum === 1) {
    return 'https://www.app.com.pk/national/';
  }
  return `https://www.app.com.pk/national/page/${pageNum}/`;
}

async function scrapeListingPage(page, pageNum) {
  const url = getPageUrl(pageNum);
  console.log(`[${new Date().toTimeString().slice(0, 8)}] 📄 Scraping page ${pageNum}: ${url}`);
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const articles = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // Common selectors for article links
    const selectors = [
      'article h3 a[href]',
      'article h2 a[href]',
      '.post-title a[href]',
      '.entry-title a[href]',
      'a[href].td-image-wrap + a[href]',
      '.td-module-title a[href]',
      'article a[href]',
    ];

    const anchors = [];
    for (const sel of selectors) {
      anchors.push(...document.querySelectorAll(sel));
    }

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      if (!href || !/^https?:\/\//.test(href)) continue;
      if (seen.has(href)) continue;

      let title = (anchor.textContent || '').trim();
      if (title.length < 5) {
        const heading = anchor.closest('h3, h2');
        if (heading) title = heading.textContent.trim();
      }
      if (!title || title.length < 5) continue;

      seen.add(href);
      results.push({ title, url: href });
    }

    return results;
  });

  console.log(`[${new Date().toTimeString().slice(0, 8)}] ✅ Found ${articles.length} articles on page ${pageNum}`);
  return articles;
}

async function saveArticlesByDate(dateStr, articles) {
  const outputPath = getAppListPath(dateStr);
  await fs.ensureDir(path.dirname(outputPath));

  // Read existing articles if file exists
  let existing = [];
  if (await fs.pathExists(outputPath)) {
    try {
      const data = await fs.readJson(outputPath);
      existing = Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn(`⚠️  Could not read existing file: ${err.message}`);
      existing = [];
    }
  }

  // Merge with existing (dedupe by URL)
  const urlMap = new Map();
  for (const article of existing) {
    urlMap.set(article.url, article);
  }

  let newCount = 0;
  for (const article of articles) {
    if (!urlMap.has(article.url)) {
      urlMap.set(article.url, article);
      newCount++;
    }
  }

  const merged = Array.from(urlMap.values());
  await fs.writeJson(outputPath, merged, { spaces: 2 });

  console.log(`[${new Date().toTimeString().slice(0, 8)}] 💾 Saved ${merged.length} articles for ${dateStr} (${newCount} new)`);

  return { total: merged.length, newCount };
}

async function main() {
  const args = parseArgs(process.argv);

  // Determine the target date for saving
  let targetDate;
  if (args.date && isValidDateStr(args.date)) {
    targetDate = args.date;
  } else if (process.env.DATE && isValidDateStr(process.env.DATE)) {
    targetDate = process.env.DATE;
  } else {
    targetDate = getTodayDate();
  }

  // Determine which pages to scrape
  let startPage = 1;
  let endPage = 1;

  if (args.latest) {
    console.log(`[${new Date().toTimeString().slice(0, 8)}] 📰 Scraping latest APP articles (page 1)`);
    startPage = 1;
    endPage = 1;
  } else if (args.startPage && args.endPage) {
    startPage = args.startPage;
    endPage = args.endPage;
    console.log(`[${new Date().toTimeString().slice(0, 8)}] 📰 Scraping APP pages ${startPage} to ${endPage}`);
  } else if (args.date) {
    console.log(`[${new Date().toTimeString().slice(0, 8)}] 📰 Scraping latest APP articles for ${targetDate}`);
    startPage = 1;
    endPage = 1;
  } else {
    console.log('Usage:');
    console.log('  node scrape_lists_app.js --latest');
    console.log('  node scrape_lists_app.js --date YYYY-MM-DD');
    console.log('  node scrape_lists_app.js --startPage 1 --endPage 10');
    process.exit(0);
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    let allArticles = [];

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      const articles = await scrapeListingPage(page, pageNum);
      allArticles = allArticles.concat(articles);
    }

    console.log(`[${new Date().toTimeString().slice(0, 8)}] 📊 Total articles scraped: ${allArticles.length}`);

    const result = await saveArticlesByDate(targetDate, allArticles);

    console.log('✅ APP list scraping completed.');
  } finally {
    console.log('🧹 Closing 1 open page(s)...');
    await page.close();
    await browser.close();
    console.log('✅ Browser closed');
  }
}

// Main execution following Puppeteer patterns
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { getAppListPath, saveArticlesByDate };