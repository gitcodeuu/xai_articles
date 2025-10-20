const dayjs = require('dayjs')

function toTrimmedString(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function toISOorNull(v) {
  if (!v) return null
  try {
    const d = dayjs(v)
    return d.isValid() ? d.toISOString() : null
  } catch {
    return null
  }
}

function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return []
  const out = []
  const seen = new Set()
  for (const it of arr) {
    const s = toTrimmedString(it)
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

function normalizeListItem(item) {
  if (!item || typeof item !== 'object') return null
  const title = toTrimmedString(item.title)
  const link = toTrimmedString(item.link)
  const date_published = toISOorNull(
    item.date_published || item.datePublished || null
  )
  if (!link) return null
  return { title: title || null, link, date_published: date_published || null }
}

function normalizeListArray(arr) {
  if (!Array.isArray(arr)) return []
  const result = []
  const seen = new Set()
  for (const raw of arr) {
    const it = normalizeListItem(raw)
    if (!it) continue
    if (seen.has(it.link)) continue
    seen.add(it.link)
    result.push(it)
  }
  return result
}

function normalizeArticle(obj) {
  const out = {
    title: toTrimmedString(obj?.title) || null,
    author: toTrimmedString(obj?.author) || null,
    content: toTrimmedString(obj?.content) || null,
    tags: normalizeStringArray(obj?.tags),
    categories: normalizeStringArray(obj?.categories),
    image: toTrimmedString(obj?.image) || null,
    retrievedAt: toISOorNull(obj?.retrievedAt) || new Date().toISOString(),
    source: toTrimmedString(obj?.source) || null,
    link: toTrimmedString(obj?.link) || null,
    dateList: toTrimmedString(obj?.dateList) || null,
    date_published: toISOorNull(obj?.date_published),
  }
  return out
}

module.exports = {
  normalizeListItem,
  normalizeListArray,
  normalizeArticle,
}
