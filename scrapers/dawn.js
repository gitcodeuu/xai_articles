// scrapers/dawn.js

/**
 * Core scraping logic for Dawn articles.
 * This module is intended to be a dependency-free library function.
 */

async function scrapeArticleOnPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Wait until meaningful content is present (best-effort)
    try {
      await page.waitForFunction(
        () => {
          const paras = Array.from(
            document.querySelectorAll('.story__content p')
          )
            .map((p) => (p.textContent || '').trim())
            .filter(Boolean)
          return paras.join('\\n').length > 100
        },
        { timeout: 12000 }
      )
    } catch {}

    const article = await page.evaluate(() => {
      const authorRaw =
        document.querySelector('.story__credit, .author-name')?.innerText ||
        null
      const author = authorRaw ? authorRaw.replace(/^By\\s+/i, '').trim() : null

      const paragraphs = Array.from(
        document.querySelectorAll('.story__content p')
      )
        .map((p) => p.innerText.trim())
        .filter(Boolean)
      const content = paragraphs.join('\\n\\n')

      const tags = Array.from(document.querySelectorAll('.tags a'))
        .map((el) => el.innerText.trim())
        .filter(Boolean)
      const categories = Array.from(document.querySelectorAll('.breadcrumb a'))
        .map((el) => el.innerText.trim())
        .filter(Boolean)
      const image =
        document.querySelector('figure img')?.getAttribute('src') || null

      // Try to get published time
      const dateMeta = document.querySelector(
        'meta[property="article:published_time"], time[datetime]'
      )
      const published = dateMeta
        ? (
            dateMeta.getAttribute('content') ||
            dateMeta.getAttribute('datetime') ||
            ''
          ).trim()
        : null

      const title = (
        document.querySelector('h1')?.textContent ||
        document.title ||
        ''
      ).trim()

      return { author, content, tags, categories, image, published, title }
    })

    return article
  } catch (e) {
    throw e
  }
}

module.exports = { scrapeArticleOnPage }
