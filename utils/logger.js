const fs = require('fs-extra')
const path = require('path')
const dayjs = require('dayjs')

const DATA_DIR = path.join(__dirname, '..', 'data')

/**
 * Creates a simple console+file logger.
 * @param {string} prefix - filename prefix for the log file
 * @param {{ subDir?: string }} [options] - optional subDir under data/ to store logs.
 *   Defaults to "logs" (shared). For per-source separation, pass e.g. { subDir: "app/logs" } or { subDir: "dawn/logs" }.
 */
function createLogStream(prefix = 'app_log', options = {}) {
  const { subDir = 'logs' } = options
  const logDir = path.join(DATA_DIR, subDir)
  fs.ensureDirSync(logDir)

  const ts = dayjs().format('YYYYMMDD_HHmmss')
  const file = path.join(logDir, `latest_${prefix}_${ts}.log`)
  const stream = fs.createWriteStream(file, { flags: 'a' })

  return (msg) => {
    const line = `[${dayjs().format('HH:mm:ss')}] ${msg}`
    console.log(line)
    stream.write(line + '\n')
  }
}

module.exports = {
  createLogStream,
}
