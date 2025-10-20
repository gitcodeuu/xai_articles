const fs = require('fs-extra')
const path = require('path')

const CACHE_FILE = path.join(__dirname, 'seen_titles.json')

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim()
}

async function loadSeenTitles() {
  try {
    if (await fs.pathExists(CACHE_FILE)) {
      const data = await fs.readJson(CACHE_FILE)
      return new Set(data)
    }
  } catch {}
  return new Set()
}

async function saveSeenTitles(seenSet) {
  const data = Array.from(seenSet)
  await fs.writeJson(CACHE_FILE, data, { spaces: 2 })
}

module.exports = {
  normalizeTitle,
  loadSeenTitles,
  saveSeenTitles,
}
