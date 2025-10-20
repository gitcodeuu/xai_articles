// scrapers/app.js
const dayjs = require('dayjs')
const { sanitizeContent, buildDatedPath, fileNameFromLink } = require('../utils/helpers')
const { normalizeArticle } = require('../utils/schema')
const fs = require('fs-extra')
const path = require('path')

const articlesDir = path.join(__dirname, '..', 'data', 'app', 'articles')

/**
 * Core scraping logic for APP articles.
 */
async function scrapeArticle(page, url, targetDate, listDateMap) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page
      .waitForSelector(
        '.td-post-content p, .tdb_single_content p, .tdb-block-inner p, article p',
        { timeout: 10000 }
      )
      .catch(() => {})

    // Prefer on-page heading; fallback to og:title; then document.title
    const title = await page.evaluate(() => {
      const h = document.querySelector(
        'h1.entry-title, h1.tdb-title-text, h1.td-page-title'
      )
      if (h && h.textContent) return h.textContent.trim()
      const og = document.querySelector('meta[property="og:title"]')
      return (og?.getAttribute('content') || document.title || '').trim()
    })

    const pageRawDate = await page.evaluate(() => {
      const timeTag = document.querySelector('time[datetime], time.entry-date')
      if (timeTag) {
        const dt = timeTag.getAttribute('datetime') || timeTag.textContent
        return dt ? dt.trim() : null
      }
      const meta = document.querySelector(
        'meta[property="article:published_time"], meta[name="publish-date"], meta[name="date"]'
      )
      return meta?.getAttribute('content') || null
    })

    // Wait until meaningful content paragraphs are present (best-effort)
    try {
      await page.waitForFunction(
        () => {
          const pList = document.querySelectorAll(
            '.td-post-content p, .tdb_single_content p, .tdb-block-inner p, article p'
          )
          const text = Array.from(pList)
            .map((n) => (n.textContent || '').trim())
            .filter((t) => t && t.length > 20 && !/advertisement/i.test(t))
            .join('\\n')
          return text.length > 100
        },
        { timeout: 12000 }
      )
    } catch {
      /* ignore, we'll still try to extract */
    }

    let content = await page.evaluate(() => {
      function collectParagraphs() {
        const selectors = [
          '.td-post-content p',
          '.tdb_single_content p',
          '.tdb-block-inner p',
          'article .td-post-content p',
          'article p',
        ]
        const paras = []
        const seen = new Set()
        const isHidden = (el) => {
          const cs = window.getComputedStyle(el)
          return cs && (cs.display === 'none' || cs.visibility === 'hidden')
        }
        selectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((p) => {
            if (!p) return
            if (isHidden(p)) return
            if (
              p.closest(
                'figure, header, footer, aside, nav, .td-post-featured-image, .tdb-author-box'
              )
            )
              return
            const t = (p.textContent || '').trim()
            if (!t) return
            if (t.length < 20) return
            const norm = t.replace(/\\s+/g, ' ')
            if (seen.has(norm)) return
            if (/^(advertisement|ad:)/i.test(norm)) return
            paras.push(t)
            seen.add(norm)
          })
        })
        return paras
      }
      const paras = collectParagraphs()
      // Fallback: try generic blocks inside tdb-block-inner
      if (paras.length < 3) {
        document.querySelectorAll('.tdb-block-inner > div').forEach((d) => {
          const t = (d.textContent || '').trim()
          if (t && t.length > 40 && !/advertisement/i.test(t)) paras.push(t)
        })
      }
      return paras.join('\\n\\n')
    })

    // Sanitize content: collapse double newlines, normalize Unicode, etc.
    content = sanitizeContent(content)

    // Treat empty/too-short content as failure so it can be retried
    if (!content || content.trim().length < 50) {
      throw new Error('Empty or too short content extracted')
    }

    // Normalize page date if present
    let pageISO = null
    try {
      if (pageRawDate) {
        const d = dayjs(pageRawDate)
        if (d.isValid()) pageISO = d.toISOString()
      }
    } catch {}

    // Prefer list timestamp (from precomputed map) to keep consistency with extracted records
    const listISO = listDateMap?.get(url) || null

    const finalDatePublished = listISO || pageISO || null

    const retrievedAt = new Date().toISOString()
    const articleData = {
      title,
      author: null,
      content,
      tags: [],
      categories: [],
      image: null,
      retrievedAt,
      source: 'APP',
      link: url,
      dateList: targetDate,
      date_published: finalDatePublished,
    }

    const dateFolder = buildDatedPath(articlesDir, targetDate)
    await fs.ensureDir(dateFolder)
    const fileName = `${targetDate}_${fileNameFromLink(url)}`
    const filePath = path.join(dateFolder, fileName)

    await fs.writeJson(filePath, normalizeArticle(articleData), { spaces: 2 })
    console.log(`✅ Saved: ${fileName}`)
    return { success: true, url, articleData }
  } catch (err) {
    console.warn(`❌ Failed: ${url} — ${err.message}`)
    return { success: false, url }
  }
}

module.exports = { scrapeArticle }
