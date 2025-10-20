const crypto = require('crypto')
const path = require('path')
const dayjs = require('dayjs')
const customParseFormat = require('dayjs/plugin/customParseFormat')
const fs = require('fs-extra')
dayjs.extend(customParseFormat)

/**
 * Converts APP timestamp like "Fri, 1 Aug 2025, 11:43 PM" to ISO format
 */
function parseAppTimestamp(raw) {
  const parsed = dayjs(String(raw).trim(), 'ddd, D MMM YYYY, hh:mm A')
  return parsed.isValid() ? parsed.toISOString() : null
}

function hashURL(url) {
  return crypto.createHash('md5').update(url).digest('hex')
}

function fileNameFromLink(url) {
  return hashURL(url) + '.json'
}

function buildDatedPath(baseDir, dateStr) {
  const d = dayjs(dateStr)
  const yyyy = d.format('YYYY')
  const mm = d.format('MM')
  const dd = d.format('DD')
  return path.join(baseDir, yyyy, mm, dd)
}

// --- New Utility Functions ---

/**
 * Pauses execution for a specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to sleep.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Returns a random integer within a specified range.
 * @param {number} min - The minimum value.
 * @param {number} max - The maximum value.
 */
function jitter(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Splits an array into smaller chunks of a specified size.
 * @param {Array} array - The array to chunk.
 * @param {number} size - The size of each chunk.
 */
function chunkArray(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

/**
 * Safely reads and parses a JSON file.
 * @param {string} filePath - The path to the JSON file.
 * @param {*} [defaultValue=[]] - The value to return if the file doesn't exist or is invalid.
 */
async function readJSON(filePath, defaultValue = []) {
  try {
    return await fs.readJson(filePath)
  } catch {
    return defaultValue
  }
}

/**
 * Ensures a file exists and writes JSON data to it.
 * @param {string} filePath - The path to the file.
 * @param {object} data - The JSON data to write.
 */
async function saveJSON(filePath, data) {
  await fs.ensureFile(filePath)
  await fs.writeJson(filePath, data, { spaces: 2 })
}

/**
 * Normalize and sanitize text content for UTF-8 safety and reduced formatting issues.
 * @param {string} text - The text to sanitize.
 */
function sanitizeContent(text) {
  if (typeof text !== 'string') return text
  // Normalize line endings to \n
  let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Collapse multiple blank lines into a single newline
  t = t.replace(/\n{2,}/g, '\n')
  // Trim trailing spaces on each line
  t = t
    .split('\\n')
    .map((line) => line.replace(/[\\t ]+$/g, ''))
    .join('\\n')
  // Unicode normalization to NFC
  try {
    t = t.normalize('NFC')
  } catch {}
  // Final trim
  return t.trim()
}

/**
 * Generates a list of date strings between a start and end date.
 * @param {string} fromDate - The start date (YYYY-MM-DD).
 * @param {string} toDate - The end date (YYYY-MM-DD).
 * @returns {string[]} An array of date strings.
 */
function getDateRange(fromDate, toDate) {
  const start = dayjs(fromDate)
  const end = dayjs(toDate)
  const range = []
  if (!start.isValid() || !end.isValid()) return range
  for (let d = start; d.isBefore(end) || d.isSame(end); d = d.add(1, 'day')) {
    range.push(d.format('YYYY-MM-DD'))
  }
  return range
}

/**
 * Checks if an article object is missing its content.
 * @param {object} article - The article object to check.
 * @returns {boolean} - True if content is missing, otherwise false.
 */
function isArticleContentMissing(articleObject) {
  if (!articleObject || typeof articleObject !== 'object') {
    return true // Or false, depending on desired strictness. Let's say invalid object is "missing".
  }
  const content = articleObject.content
  if (content === null || content === undefined) {
    return true
  }
  if (typeof content === 'string' && content.trim() === '') {
    return true
  }
  if (Array.isArray(content) && content.length === 0) {
    return true
  }
  return false
}

/**
 * Asynchronously walks through a directory and yields file paths that match a predicate.
 * @param {string} dir - The directory to walk.
 * @param {(filePath: string) => boolean} [predicate] - A function to test each file path.
 * @returns {AsyncGenerator<string, void, void>}
 */
async function* walk(dir, predicate = () => true) {
  if (!(await fs.pathExists(dir))) {
    return
  }
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(fullPath, predicate)
    } else if (entry.isFile() && predicate(fullPath)) {
      yield fullPath
    }
  }
}

module.exports = {
  parseAppTimestamp,
  hashURL,
  fileNameFromLink,
  buildDatedPath,
  sleep,
  jitter,
  chunkArray,
  readJSON,
  saveJSON,
  sanitizeContent,
  isArticleContentMissing,
  walk,
  getDateRange,
}
