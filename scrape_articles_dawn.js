#!/usr/bin/env node
// Scrape full article content for Dawn using list files
// Usage:
//   node scrape_articles_dawn.js --fromDate YYYY-MM-DD [--toDate YYYY-MM-DD]

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const minimist = require('minimist');

const { buildDatedPath, sleep, jitter, chunkArray } = require('./utils/helpers');
const { normalizeArticle } = require('./utils/schema');
const { createLogStream } = require('./utils/logger');
const { newPage, closeBrowser } = require('./utils/browser');

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);

const LIST_DIR = path.join(__dirname, 'data', 'dawn', 'lists');
const ARTICLE_DIR = path.join(__dirname, 'data', 'dawn', 'articles');
const LOG_DIR = path.join(__dirname, 'data', 'dawn', 'logs');
const BATCH_SIZE = 8;
const STATS_FILE = path.join(LOG_DIR, 'stats_articles.json');

fs.ensureDirSync(ARTICLE_DIR);
fs.ensureDirSync(LOG_DIR);

function makeLogger() {
  return createLogStream('dawn_articles', { subDir: 'dawn/logs' });
}

function getUrlFromItem(item) {
  const url = item?.url || item?.link || item?.href || item?.permalink || null;
  return (typeof url === 'string' && url.trim()) ? url.trim() : null;
}

function generateFilenameHash(input, fallbackSeed = '') {
  const s = (typeof input === 'string' && input.length) ? input : fallbackSeed;
  if (!s) return crypto.randomBytes(8).toString('hex');
  return crypto.createHash('md5').update(s).digest('hex');
}

function sanitizeContent(text) {
  if (typeof text !== 'string') return text;
  let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.split('\n').map(l => l.replace(/[\t ]+$/g, '')).join('\n');
  try { t = t.normalize('NFC'); } catch {}
  return t.trim();
}

async function scrapeArticle(item, date, log, indexSeed = 0) {
  const link = getUrlFromItem(item);
  const title = (item?.title || item?.headline || '').trim();

  if (!link) {
    log(`⏭️  [${date}] Skipping item without URL: "${title?.slice(0, 60) || '(no title)'}"`);
    return { success: true, skipped: true };
  }

  const hash = generateFilenameHash(link, `${date}-${indexSeed}`);
  const dateFolder = buildDatedPath(ARTICLE_DIR, date);
  await fs.ensureDir(dateFolder);
  const outPath = path.join(dateFolder, `${date}_${hash}.json`);

  if (await fs.pathExists(outPath)) {
    log(`⏭️  [${date}] Already exists: ${date}_${hash}.json`);
    return { success: true, skipped: true };
  }

  const page = await newPage();

  try {
    await sleep(jitter(400, 1200));
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for common content selectors on Dawn
    await page.waitForSelector(
      'article, .story__content, .story__content p, .content__body, .article-body',
      { timeout: 10000 }
    ).catch(() => {});

    await sleep(jitter(800, 1800));

    const scraped = await page.evaluate(() => {
      function isHidden(el) {
        const cs = window.getComputedStyle(el);
        return cs && (cs.display === 'none' || cs.visibility === 'hidden');
      }

      function collectParagraphs() {
        const selectors = [
          '.story__content p',
          '.content__body p',
          'article .story__content p',
          'article .content__body p',
          'article p',
        ];
        const paras = [];
        const seen = new Set();

        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(p => {
            if (!p || isHidden(p)) return;
            if (p.closest('figure, header, footer, aside, nav, .related, .share, .advert, .ad, .sponsored')) return;
            const t = (p.textContent || '').trim();
            if (!t || t.length < 20) return;
            const norm = t.replace(/\s+/g, ' ');
            if (seen.has(norm)) return;
            paras.push(t);
            seen.add(norm);
          });
        }

        if (paras.length < 3) {
          // fallback: long blocks
          document.querySelectorAll('article, .story__content, .content__body').forEach(el => {
            const t = (el.textContent || '').trim();
            if (t && t.length > 120) paras.push(t);
          });
        }

        return paras;
      }

      const paragraphs = collectParagraphs();
      const content = paragraphs.join('\n\n');

      // Title
      let pageTitle =
        document.querySelector('h1')?.textContent?.trim() ||
        document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
        document.title || '';

      // Published date
      let published =
        document.querySelector('time[datetime]')?.getAttribute('datetime') ||
        document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
        '';

      // Author
      let author =
        document.querySelector('[rel="author"]')?.textContent?.trim() ||
        document.querySelector('.author, .byline')?.textContent?.trim() ||
        document.querySelector('meta[name="author"]')?.getAttribute('content') ||
        '';

      // Lead image
      let image =
        document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
        document.querySelector('article img')?.getAttribute('src') ||
        '';

      return { content, pageTitle, published, author, image };
    });

    const cleanContent = sanitizeContent(scraped.content);
    if (!cleanContent || cleanContent.length < 50) {
      log(`⚠️  [${date}] Empty/short content: ${title.substring(0, 50)}... (${cleanContent?.length || 0} chars)`);
      throw new Error('Empty or too short content extracted');
    }

    const finalTitle = scraped.pageTitle || title;

    const article = {
      title: finalTitle,
      author: scraped.author || item.author || null,
      content: cleanContent,
      tags: item.tags || [],
      categories: item.categories || [item.category || 'News'],
      image: scraped.image || null,
      retrievedAt: new Date().toISOString(),
      source: 'DAWN',
      link,
      dateList: date,
      date_published: (scraped.published && !Number.isNaN(Date.parse(scraped.published)))
        ? new Date(scraped.published).toISOString()
        : new Date(date).toISOString(),
    };

    const normalized = normalizeArticle(article);
    await fs.writeJson(outPath, normalized, { spaces: 2 });
    log(`✅ Saved: ${date}_${hash}.json (${cleanContent.length} chars)`);
    return { success: true, skipped: false, contentLength: cleanContent.length };
  } catch (err) {
    log(`❌ [${date}] Failed: ${title.substring(0, 60)}... - ${err.message}`);
    return { success: false, error: err.message, url: link };
  } finally {
    await page.close();
  }
}

async function processDateArticles(date, log) {
  const listPath = path.join(buildDatedPath(LIST_DIR, date), `list_${date}.json`);
  if (!(await fs.pathExists(listPath))) {
    log(`⚠️  [${date}] List file not found: ${listPath}`);
    return { success: 0, failed: 0, skipped: 0, total: 0 };
  }

  const listJson = await fs.readJson(listPath);
  const items = Array.isArray(listJson) ? listJson : (Array.isArray(listJson?.articles) ? listJson.articles : []);
  log(`[📅 Processing LIST for: ${date}] (${items.length} items)`);

  let success = 0, failed = 0, skipped = 0, totalLen = 0;

  for (const batch of chunkArray(items, BATCH_SIZE)) {
    const results = await Promise.all(batch.map((item, i) => scrapeArticle(item, date, log, i)));
    for (const r of results) {
      if (r.success && r.skipped) skipped++;
      else if (r.success) { success++; totalLen += (r.contentLength || 0); }
      else failed++;
    }
    // small cooldown between batches
    await sleep(jitter(1200, 2400));
  }

  const avgLen = success ? Math.round(totalLen / success) : 0;
  log(`🎯 Finished ${date}`);
  log(`   📊 Success: ${success} | Skipped: ${skipped} | Failed: ${failed} | Total: ${items.length}`);
  log(`   📝 Avg content length: ${avgLen} chars`);
  return { success, failed, skipped, total: items.length, avgContentLength: avgLen };
}

async function main() {
  const argv = minimist(process.argv.slice(2));
  const log = makeLogger();

  try {
    let fromDate = argv.fromDate || argv.date || process.env.DATE || dayjs().format('YYYY-MM-DD');
    let toDate = argv.toDate || fromDate;

    const start = dayjs(fromDate, 'YYYY-MM-DD');
    const end = dayjs(toDate, 'YYYY-MM-DD');
    if (!start.isValid() || !end.isValid()) {
      console.error('❌ Invalid date. Use --fromDate YYYY-MM-DD [--toDate YYYY-MM-DD]');
      process.exit(1);
    }

    const stats = {};
    let cur = start;
    while (cur.isSameOrBefore(end)) {
      const ds = cur.format('YYYY-MM-DD');
      stats[ds] = await processDateArticles(ds, log);
      cur = cur.add(1, 'day');
    }

    await fs.writeJson(STATS_FILE, stats, { spaces: 2 });
    log('✅ DAWN article scraping completed.');
    log(`📊 Final Stats:\n${JSON.stringify(stats, null, 2)}`);
  } catch (err) {
    console.error('❌ Fatal error:', err);
    await closeBrowser();
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ Unhandled error:', err);
    await closeBrowser();
    process.exit(1);
  });
}

module.exports = { main, scrapeArticle, processDateArticles, generateFilenameHash, getUrlFromItem };