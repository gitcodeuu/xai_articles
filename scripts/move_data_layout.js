// scripts/move_data_layout.js
// Moves:
//  - data\lists\list_YYYY-MM-DD.json  -> data\lists\YYYY\MM\DD\list_YYYY-MM-DD.json
//  - data\articles\YYYY-MM-DD\*.json -> data\articles\YYYY\MM\DD\*.json

const fs = require('fs-extra')
const path = require('path')

;(async () => {
  const repoRoot = path.resolve(__dirname, '..')
  const dataDir = path.join(repoRoot, 'data')
  const listsDir = path.join(dataDir, 'lists')
  const articlesDir = path.join(dataDir, 'articles')

  function partsFromDate(dateStr) {
    const [y, m, d] = dateStr.split('-')
    return { y, m, d }
  }

  // Move list files from flat to dated path
  if (await fs.pathExists(listsDir)) {
    const listItems = await fs.readdir(listsDir)
    for (const f of listItems) {
      const m = f.match(/^list_(\d{4}-\d{2}-\d{2})\.json$/)
      if (!m) continue
      const date = m[1]
      const { y, m: mm, d } = partsFromDate(date)
      const src = path.join(listsDir, f)
      const dstDir = path.join(listsDir, y, mm, d)
      const dst = path.join(dstDir, f)
      await fs.ensureDir(dstDir)
      try {
        if (!(await fs.pathExists(dst))) {
          await fs.move(src, dst, { overwrite: false })
          console.log(`Moved list: ${src} -> ${dst}`)
        } else {
          console.log(`List exists, skipping: ${dst}`)
          await fs.remove(src).catch(() => {})
        }
      } catch (e) {
        console.warn(`Could not move list ${src} -> ${dst}:`, e.message)
      }
    }
  }

  // Move article day folders from YYYY-MM-DD to YYYY\MM\DD
  if (await fs.pathExists(articlesDir)) {
    const dayDirs = await fs.readdir(articlesDir)
    for (const day of dayDirs) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      const { y, m: mm, d } = partsFromDate(day)
      const srcDayDir = path.join(articlesDir, day)
      const dstDayDir = path.join(articlesDir, y, mm, d)
      await fs.ensureDir(dstDayDir)

      let files = []
      try {
        files = await fs.readdir(srcDayDir)
      } catch {
        continue
      }

      for (const f of files) {
        if (!f.endsWith('.json')) continue
        const src = path.join(srcDayDir, f)
        const dst = path.join(dstDayDir, f)
        try {
          if (await fs.pathExists(dst)) {
            console.log(`Article exists, skipping: ${dst}`)
            await fs.remove(src).catch(() => {})
          } else {
            await fs.move(src, dst, { overwrite: false })
            console.log(`Moved article: ${src} -> ${dst}`)
          }
        } catch (e) {
          console.warn(`Could not move article ${src} -> ${dst}:`, e.message)
        }
      }

      // remove old empty day folder
      try {
        const remaining = await fs.readdir(srcDayDir)
        if (remaining.length === 0) {
          await fs.remove(srcDayDir)
        }
      } catch {}
    }
  }

  console.log('✅ Migration completed.')
})().catch((e) => {
  console.error('Migration failed:', e)
  process.exit(1)
})
