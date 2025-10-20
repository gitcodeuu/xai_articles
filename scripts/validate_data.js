// scripts/validate_data.js — normalize existing JSON files in data/ for consistency
const fs = require('fs-extra')
const path = require('path')
const dayjs = require('dayjs')
const { normalizeListArray, normalizeArticle } = require('../utils/schema')
const { walk } = require('../utils/helpers')

const ROOT = path.join(__dirname, '..')
const DATA = path.join(ROOT, 'data')

async function safeReadJson(file, def) {
  try {
    return await fs.readJson(file)
  } catch {
    return def
  }
}

async function normalizeListFile(file) {
  const arr = await safeReadJson(file, [])
  const norm = normalizeListArray(arr)
  await fs.writeJson(file, norm, { spaces: 2 })
  return { count: norm.length }
}

async function normalizeArticleFile(file) {
  const obj = await safeReadJson(file, null)
  if (!obj || typeof obj !== 'object') {
    // remove corrupted file
    await fs.remove(file).catch(() => {})
    return { removed: true }
  }
  const norm = normalizeArticle(obj)
  await fs.writeJson(file, norm, { spaces: 2 })
  return { ok: true }
}

async function main() {
  const targets = [
    { kind: 'list', dir: path.join(DATA, 'app', 'lists') },
    { kind: 'list', dir: path.join(DATA, 'dawn', 'lists') },
    { kind: 'article', dir: path.join(DATA, 'app', 'articles') },
    { kind: 'article', dir: path.join(DATA, 'dawn', 'articles') },
  ]

  let lists = 0,
    articles = 0,
    removed = 0

  for (const t of targets) {
    const files = []
    for await (const f of walk(t.dir, (f) => f.endsWith('.json'))) {
      files.push(f)
    }
    for (const f of files) {
      try {
        if (t.kind === 'list') {
          await normalizeListFile(f)
          lists++
        } else {
          const res = await normalizeArticleFile(f)
          if (res.removed) removed++
          else articles++
        }
      } catch (e) {
        // if file is malformed, attempt removal to avoid poisoning future runs
        await fs.remove(f).catch(() => {})
        removed++
      }
    }
  }

  console.log(
    `✅ Normalized: ${lists} list files, ${articles} article files. Removed: ${removed} corrupted files.`
  )
}

main().catch((e) => {
  console.error('Validation failed:', e)
  process.exit(1)
})
