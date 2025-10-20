// Lightweight SRE dashboard server: tracks jobs, logs, retries. No external deps.
// Storage layout (Windows paths):
//  data\sre\index.json                  -> summary with counts and recent runs list
//  data\sre\runs\<runId>.json           -> per-run metadata
//  data\sre\logs\<runId>.log            -> captured stdout+stderr
//
// Run: pnpm run sre (see package.json)
// UI:  http://localhost:8080/

const http = require('http')
const url = require('url')
const path = require('path')
const fs = require('fs-extra')
const { spawn } = require('child_process')
const dayjs = require('dayjs')
const { isArticleContentMissing, walk } = require('../utils/helpers')

const ROOT = __dirname // scripts folder
const DATA_SRE_DIR = path.join(ROOT, '..', 'data', 'sre')
const RUNS_DIR = path.join(DATA_SRE_DIR, 'runs')
const LOGS_DIR = path.join(DATA_SRE_DIR, 'logs')
const INDEX_FILE = path.join(DATA_SRE_DIR, 'index.json')

const PORT = process.env.SRE_PORT ? parseInt(process.env.SRE_PORT, 10) : 8080

fs.ensureDirSync(RUNS_DIR)
fs.ensureDirSync(LOGS_DIR)

// Ensure an initial empty index exists so the UI shows a consistent state on first run
try {
  const hasIndex = fs.pathExistsSync(INDEX_FILE)
  if (!hasIndex) {
    let hasRuns = false
    try {
      hasRuns = (fs.readdirSync(RUNS_DIR) || []).some((f) =>
        f.endsWith('.json')
      )
    } catch {}
    if (!hasRuns) {
      const DEFAULT_INDEX = {
        total: 0,
        completed: 0,
        failed: 0,
        running: 0,
        recent: [],
      }
      fs.writeJsonSync(INDEX_FILE, DEFAULT_INDEX, { spaces: 2 })
    }
  }
} catch {}

/** In-memory map of active child processes by runId */
const ACTIVE = new Map()

function nowIso() {
  return dayjs().toISOString()
}
function newId() {
  return (
    dayjs().format('YYYYMMDD_HHmmss_SSS') +
    '_' +
    Math.random().toString(36).slice(2, 8)
  )
}

async function loadIndex() {
  if (await fs.pathExists(INDEX_FILE)) return fs.readJson(INDEX_FILE)
  // If no index file yet, rebuild from runs directory for historical accuracy
  try {
    const files = (await fs.readdir(RUNS_DIR)).filter((f) =>
      f.endsWith('.json')
    )
    const runs = []
    for (const f of files) {
      try {
        runs.push(await fs.readJson(path.join(RUNS_DIR, f)))
      } catch {}
    }
    runs.sort((a, b) =>
      String(b.startedAt || '').localeCompare(String(a.startedAt || ''))
    )
    const idx = {
      total: runs.length,
      completed: runs.filter((r) => r.status === 'completed').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      running: runs.filter((r) => r.status === 'running').length,
      recent: runs
        .slice(0, 50)
        .map((r) => ({
          id: r.id,
          command: r.command,
          args: r.args,
          status: r.status,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          exitCode: r.exitCode,
        })),
    }
    // Save for next time
    await saveIndex(idx)
    return idx
  } catch {
    return { total: 0, completed: 0, failed: 0, running: 0, recent: [] }
  }
}

async function saveIndex(idx) {
  // Keep only last 50 recent for brevity
  if (Array.isArray(idx.recent) && idx.recent.length > 50)
    idx.recent = idx.recent.slice(0, 50)
  await fs.writeJson(INDEX_FILE, idx, { spaces: 2 })
}

async function loadRun(runId) {
  const file = path.join(RUNS_DIR, `${runId}.json`)
  if (!(await fs.pathExists(file))) return null
  return fs.readJson(file)
}

async function saveRun(meta) {
  const file = path.join(RUNS_DIR, `${meta.id}.json`)
  await fs.writeJson(file, meta, { spaces: 2 })
}

function tokenize(cmd) {
  // naive tokenizer splitting on whitespace, respecting simple quotes
  const parts = []
  let buf = ''
  let quote = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if ((ch === '"' || ch === "'") && !quote) {
      quote = ch
      continue
    }
    if (quote) {
      if (ch === quote) {
        quote = null
        continue
      }
      buf += ch
      continue
    }
    if (/\s/.test(ch)) {
      if (buf) {
        parts.push(buf)
        buf = ''
      }
    } else {
      buf += ch
    }
  }
  if (buf) parts.push(buf)
  return parts
}

function extractFlags(parts) {
  const flags = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.startsWith('--')) {
      const next = parts[i + 1]
      if (next && !next.startsWith('--')) {
        flags.push(p + ' ' + next)
        i++ // skip value
      } else {
        flags.push(p)
      }
    }
  }
  // dedupe preserve order
  return [...new Set(flags)]
}

function presetCommands() {
  // Build presets from package.json scripts dynamically
  try {
    const pkgPath = path.join(ROOT, '..', 'package.json')
    const pkg = fs.readJsonSync(pkgPath)
    const scripts = pkg && pkg.scripts ? pkg.scripts : {}
    const presets = []
    for (const [name, script] of Object.entries(scripts)) {
      if (!script || typeof script !== 'string') continue
      // Split into command and args
      const parts = tokenize(script)
      if (parts.length === 0) continue
      const command = parts[0]
      const args = parts.slice(1)
      const flags = extractFlags(parts)
      const flagStr = flags.length ? ' — flags: ' + flags.join(' ') : ''
      const title = name + flagStr
      presets.push({ key: name, title, command, args })
    }
    return presets
  } catch (e) {
    // Fallback to empty list on error
    return []
  }
}

async function startRun({ command, args = [], cwd } = {}) {
  // Ensure cwd defaults to repo root even if falsy values are passed
  if (!cwd) cwd = path.join(ROOT, '..')
  const id = newId()
  const startedAt = nowIso()
  const logPath = path.join(LOGS_DIR, `${id}.log`)
  const out = fs.createWriteStream(logPath, { flags: 'a' })

  const meta = {
    id,
    command,
    args,
    cwd,
    status: 'running', // running | completed | failed
    startedAt,
    endedAt: null,
    exitCode: null,
    logPath,
  }
  await saveRun(meta)

  const idx = await loadIndex()
  idx.total += 1
  idx.running = (idx.running || 0) + 1
  idx.recent = [
    { id, command, args, status: meta.status, startedAt },
    ...(idx.recent || []),
  ]
  await saveIndex(idx)

  const child = spawn(command, args, { cwd, shell: false })
  ACTIVE.set(id, child)

  function write(line) {
    const ts = dayjs().format('HH:mm:ss')
    out.write(`[${ts}] ${line}` + '\n')
  }

  write(`$ ${command} ${args.join(' ')}`)

  child.stdout.on('data', (buf) => out.write(buf))
  child.stderr.on('data', (buf) => out.write(buf))

  child.on('close', async (code) => {
    ACTIVE.delete(id)
    meta.status = code === 0 ? 'completed' : 'failed'
    meta.exitCode = code
    meta.endedAt = nowIso()
    await saveRun(meta)

    const idx2 = await loadIndex()
    idx2.running = Math.max(0, (idx2.running || 0) - 1)
    if (meta.status === 'completed') idx2.completed = (idx2.completed || 0) + 1
    if (meta.status === 'failed') idx2.failed = (idx2.failed || 0) + 1
    // update status in recent list
    idx2.recent = (idx2.recent || []).map((r) =>
      r.id === id
        ? { ...r, status: meta.status, endedAt: meta.endedAt, exitCode: code }
        : r
    )
    await saveIndex(idx2)

    out.end()
  })

  return meta
}

function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  })
  res.end(text)
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(html)
}

function notFound(res) {
  send(res, 404, { error: 'Not found' })
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return res.end()
  }

  if (pathname === '/api/presets' && req.method === 'GET') {
    return send(res, 200, presetCommands())
  }

  if (pathname === '/api/runs' && req.method === 'GET') {
    const idx = await loadIndex()
    return send(res, 200, idx)
  }

  if (pathname === '/api/runs' && req.method === 'POST') {
    const body = await parseBody(req)
    if (!body || !body.command) {
      return send(res, 400, { error: 'command is required' })
    }
    try {
      const meta = await startRun({
        command: body.command,
        args: Array.isArray(body.args) ? body.args : [],
        cwd: body.cwd && String(body.cwd),
      })
      return send(res, 201, meta)
    } catch (e) {
      return send(res, 500, { error: e.message })
    }
  }

  // --- Bad articles APIs ---
  if (pathname === '/api/bad-articles' && req.method === 'GET') {
    try {
      const payload = await scanBadArticles()
      return send(res, 200, payload)
    } catch (e) {
      return send(res, 500, { error: e.message })
    }
  }

  if (pathname === '/api/bad-articles/retry' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      const result = await retryBadArticles(body)
      return send(res, 200, result)
    } catch (e) {
      return send(res, 500, { error: e.message })
    }
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^\/]+)$/)
  if (runMatch && req.method === 'GET') {
    const runId = runMatch[1]
    const meta = await loadRun(runId)
    if (!meta) return notFound(res)
    return send(res, 200, meta)
  }

  const retryMatch = pathname.match(/^\/api\/runs\/([^\/]+)\/retry$/)
  if (retryMatch && req.method === 'POST') {
    const runId = retryMatch[1]
    const meta = await loadRun(runId)
    if (!meta) return notFound(res)
    try {
      const newMeta = await startRun({
        command: meta.command,
        args: meta.args,
        cwd: meta.cwd,
      })
      return send(res, 201, newMeta)
    } catch (e) {
      return send(res, 500, { error: e.message })
    }
  }

  const logMatch = pathname.match(/^\/api\/runs\/([^\/]+)\/log$/)
  if (logMatch && req.method === 'GET') {
    const runId = logMatch[1]
    const meta = await loadRun(runId)
    if (!meta) return notFound(res)
    const exists = await fs.pathExists(meta.logPath)
    if (!exists) return send(res, 200, '')
    const text = await fs.readFile(meta.logPath, 'utf8')
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
    })
    return res.end(text)
  }

  return notFound(res)
}

// --- Bad articles scanning & retry helpers ---
const DATA_ROOT = path.join(ROOT, '..', 'data')
const APP_ARTICLES_DIR = path.join(DATA_ROOT, 'app', 'articles')
const DAWN_ARTICLES_DIR = path.join(DATA_ROOT, 'dawn', 'articles')

async function scanDirForBad(dir, sourceHint) {
  const files = []
  const isJsonFile = (file) => file.toLowerCase().endsWith('.json')
  for await (const f of walk(dir, isJsonFile)) {
    files.push(f)
  }
  const items = []
  for (const f of files) {
    try {
      const obj = await fs.readJson(f)
      if (!isArticleContentMissing(obj)) continue
      const source =
        obj.source ||
        sourceHint ||
        (f.includes('\\app\\') ? 'APP' : f.includes('\\dawn\\') ? 'Dawn' : null)
      const dateList = obj.dateList || null
      const link = obj.link || null
      items.push({
        source,
        link,
        dateList,
        filePath: f,
        fileName: path.basename(f),
      })
    } catch {
      // skip unreadable files
    }
  }
  return items
}

async function scanBadArticles() {
  const appItems = await scanDirForBad(APP_ARTICLES_DIR, 'APP')
  const dawnItems = await scanDirForBad(DAWN_ARTICLES_DIR, 'Dawn')
  const items = [...appItems, ...dawnItems]
  items.sort((a, b) => String(b.filePath).localeCompare(String(a.filePath)))
  return { count: items.length, items }
}

function dateFromFileOrObj(item) {
  if (item.dateList) return item.dateList
  const m = String(item.fileName || '').match(/(\d{4}-\d{2}-\d{2})_/)
  return m ? m[1] : null
}

async function retryBadArticles(body) {
  if (body && body.filePath) {
    const filePath = String(body.filePath)
    const obj = await fs.readJson(filePath).catch(() => ({}))
    const source = obj.source || (filePath.includes('\\app\\') ? 'APP' : 'Dawn')
    const date =
      obj.dateList || dateFromFileOrObj({ fileName: path.basename(filePath) })
    await fs.remove(filePath).catch(() => {})
    let command = 'node'
    let args = []
    if (source === 'Dawn') {
      args = ['scrape_articles_dawn.js']
      if (date) args.push(date)
    } else {
      args = ['scrape_articles_app.js', '--retry']
      if (date) args.push(date)
    }
    const meta = await startRun({ command, args })
    return { started: [meta] }
  }
  if (body && body.all) {
    const scan = await scanBadArticles()
    const groups = new Map()
    for (const it of scan.items) {
      const date = dateFromFileOrObj(it)
      const key = `${it.source}::${date || ''}`
      if (!groups.has(key)) groups.set(key, { source: it.source, date })
    }
    const metas = []
    for (const g of groups.values()) {
      let command = 'node'
      let args = []
      if (g.source === 'Dawn') {
        args = ['scrape_articles_dawn.js']
        if (g.date) args.push(g.date)
      } else {
        args = ['scrape_articles_app.js', '--retry']
        if (g.date) args.push(g.date)
      }
      const meta = await startRun({ command, args })
      metas.push(meta)
    }
    await Promise.all(
      (await scanBadArticles()).items.map((it) =>
        fs.remove(it.filePath).catch(() => {})
      )
    )
    return { started: metas }
  }
  return { started: [] }
}

function htmlPage() {
  // Simple UI with minimal styling and pure JS
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SRE Dashboard</title>
<style>
body { font-family: system-ui, Segoe UI, Roboto, Arial; margin: 0; background: #0f172a; color: #e2e8f0; }
header { background:#111827; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; }
small { color:#93c5fd; }
main { padding:16px; display:grid; grid-template-columns: 320px 1fr; gap:16px; }
.card { background:#111827; border:1px solid #1f2937; border-radius:8px; padding:12px; }
button { background:#2563eb; color:#fff; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; }
button.secondary{ background:#374151; }
button.danger{ background:#b91c1c; }
input, select { background:#0b1220; border:1px solid #1f2937; color:#e5e7eb; padding:8px; border-radius:6px; width:100%; box-sizing: border-box; }
pre { white-space: pre-wrap; background:#0b1220; border:1px solid #1f2937; padding:8px; border-radius:6px; max-height: 60vh; overflow:auto; }
.badge { padding:2px 6px; border-radius:6px; font-size:12px; }
.badge.running{ background:#a16207; }
.badge.completed{ background:#166534; }
.badge.failed{ background:#7f1d1d; }
.list { max-height: calc(100vh - 180px); overflow:auto; }
.row { display:flex; gap:8px; align-items:center; justify-content:space-between; padding:6px 0; border-bottom:1px solid #1f2937; }
.row:last-child{ border-bottom:none; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
</head>
<body>
<header>
  <div>
    <strong>SRE Dashboard</strong>
    <div style="font-size:12px;color:#9ca3af">Track jobs • Retry • View logs</div>
  </div>
  <div id="counts"><small>loading…</small></div>
</header>
<main>
  <section class="card">
    <h3>Start job</h3>
    <label>Preset</label>
    <select id="preset"></select>
    <div style="height:8px"></div>
    <label>Or custom command</label>
    <input id="cmd" placeholder="node scrape_lists_dawn.js 2025-08-01:2025-08-10" />
    <div style="height:8px"></div>
    <button id="start">Start</button>
    <div style="height:16px"></div>
    <div><small>Note: jobs are executed in repo root. Output is captured in data\\sre\\logs. Viewing a running job auto-refreshes logs and status.</small></div>
    <div style="height:16px"></div>
    <h4>Recent runs</h4>
    <div id="runs" class="list"></div>
  </section>
  <section class="card">
    <h3>Bad articles</h3>
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px">
      <div><small id="badCount">loading…</small></div>
      <div><button class="danger" id="retryAllBad">Retry all</button></div>
    </div>
    <div id="badList" class="list"></div>
  </section>
  <section class="card">
    <h3>Run details</h3>
    <div id="detail"></div>
    <div style="height:8px"></div>
    <pre id="log"></pre>
  </section>
</main>
<script>
const $ = sel => document.querySelector(sel);
let RECENT = [];
let CURRENT_RUN = null;
let CURRENT_TIMER = null;

async function fetchJSON(u){ const r = await fetch(u); return r.json(); }
async function fetchText(u){ const r = await fetch(u); return r.text(); }

async function loadPresets(){
  const sel = $('#preset');
  try {
    const presets = await fetchJSON('/api/presets');
    sel.innerHTML = '<option value="">— choose —</option>' + (presets||[]).map(function(p,i){ return \`<option value="\${i}">\${p.title}</option>\`; }).join('');
    sel.dataset.presets = JSON.stringify(presets||[]);
  } catch (e) {
    console.error('Failed to load presets', e);
    sel.innerHTML = '<option value="">(failed to load presets)</option>';
    sel.dataset.presets = '[]';
  }
}

function badge(status){ return \`<span class="badge \${status}">\${status}</span>\`; }

async function loadRuns(){
  try {
    const idx = await fetchJSON('/api/runs');
    RECENT = idx.recent || [];
    $('#counts').innerHTML = \`<small>Total \${idx.total||0} • Running \${idx.running||0} • Completed \${idx.completed||0} • Failed \${idx.failed||0}</small>\`;
    const wrap = $('#runs');
    wrap.innerHTML = RECENT.map(function(r){ return \`
    <div class="row">
      <div>
        <div><strong class="mono">\${r.id}</strong> \${badge(r.status||'')}</div>
        <div class="mono" style="font-size:12px;color:#9ca3af">$ \${r.command} \${(r.args||[]).join(' ')}</div>
      </div>
      <div>
        <button class="secondary" data-id="\${r.id}" onclick="viewRun(this.dataset.id)">View</button>
        <button data-id="\${r.id}" onclick="retryRun(this.dataset.id)">Retry</button>
      </div>
    </div>
  \`; }).join('');
  } catch (e) {
    console.error('Failed to load runs', e);
    $('#counts').innerHTML = '<small>(failed to load stats)</small>';
    $('#runs').innerHTML = '<div class="row"><div><small>Could not load recent runs.</small></div></div>';
  }
}

async function loadBad(){
  try {
    const r = await fetchJSON('/api/bad-articles');
    $('#badCount').innerHTML = \`<small>Bad articles: \${r.count||0}</small>\`;
    const list = (r.items||[]).slice(0, 300);
    $('#badList').innerHTML = list.map(function(it){
      const link = (it.link||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
      return \`
      <div class="row">
        <div style="flex:1">
          <div><strong>\${it.source||''}</strong> — \${it.dateList||''}</div>
          <div class="mono" style="font-size:12px;color:#9ca3af; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:520px">\${link}</div>
        </div>
        <div>
          <button data-path="\${it.filePath.replace(/\\\\/g,'\\\\\\\\')}" onclick="retryBad(this.dataset.path)">Retry</button>
        </div>
      </div>\`;
    }).join('');
  } catch (e) {
    console.error('Failed to load bad articles', e);
    $('#badCount').innerHTML = '<small>(failed to load)</small>';
    $('#badList').innerHTML = '<div class="row"><div><small>Could not load.</small></div></div>';
  }
}

async function retryBad(filePath){
  const res = await fetch('/api/bad-articles/retry', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ filePath }) });
  if (!res.ok){ const t = await res.text(); alert('Failed to retry: ' + t); return; }
  await loadRuns();
  await loadBad();
}

async function retryAllBad(){
  if (!confirm('Retry all bad articles by date/source? This starts multiple runs.')) return;
  const res = await fetch('/api/bad-articles/retry', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ all: true }) });
  if (!res.ok){ const t = await res.text(); alert('Failed: ' + t); return; }
  await loadRuns();
  await loadBad();
}

async function start(){
  const presets = JSON.parse($('#preset').dataset.presets||'[]');
  var cmdline = $('#cmd').value.trim();
  var command, args=[];
  if (!cmdline && $('#preset').value){
    const p = presets[parseInt($('#preset').value,10)];
    command = p.command; args = p.args||[];
  } else if (cmdline){
    const parts = cmdline.split(/\\s+/);
    command = parts.shift(); args = parts;
  } else {
    alert('Choose a preset or enter a command'); return;
  }
  const res = await fetch('/api/runs', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ command: command, args: args }) });
  if (!res.ok){ const t = await res.text(); alert('Failed to start: ' + t); return; }
  const meta = await res.json();
  await loadRuns();
  viewRun(meta.id);
}

function renderDetail(meta){
  $('#detail').innerHTML = \`
    <div><strong>ID:</strong> <span class="mono">\${meta.id}</span></div>
    <div><strong>Status:</strong> \${badge(meta.status)}</div>
    <div><strong>Command:</strong> <span class="mono">$ \${meta.command} \${(meta.args||[]).join(' ')}</span></div>
    <div><strong>Started:</strong> \${meta.startedAt||''}</div>
    <div><strong>Ended:</strong> \${meta.endedAt||''}</div>
    <div><strong>Exit code:</strong> \${meta.exitCode===null? '': meta.exitCode}</div>
    <div style="margin-top:8px"><button onclick="retryRun('\${meta.id}')">Retry</button></div>\`;
}

async function refreshCurrent(){
  if (!CURRENT_RUN) return;
  const meta = await fetchJSON('/api/runs/' + CURRENT_RUN);
  renderDetail(meta);
  const log = await fetchText('/api/runs/' + CURRENT_RUN + '/log');
  const logEl = $('#log');
  const atBottom = Math.abs((logEl.scrollTop + logEl.clientHeight) - logEl.scrollHeight) < 10;
  logEl.textContent = log;
  if (atBottom) { logEl.scrollTop = logEl.scrollHeight; }
  if (meta.status === 'running'){
    if (!CURRENT_TIMER) CURRENT_TIMER = setInterval(refreshCurrent, 2000);
  } else {
    if (CURRENT_TIMER){ clearInterval(CURRENT_TIMER); CURRENT_TIMER = null; }
  }
}

async function viewRun(id){
  if (CURRENT_TIMER){ clearInterval(CURRENT_TIMER); CURRENT_TIMER = null; }
  CURRENT_RUN = id;
  await refreshCurrent();
}

async function retryRun(id){
  const res = await fetch('/api/runs/' + id + '/retry', { method:'POST' });
  if (!res.ok){ const t = await res.text(); alert('Failed to retry: ' + t); return; }
  await loadRuns();
}

document.getElementById('start').addEventListener('click', start);
document.getElementById('retryAllBad').addEventListener('click', retryAllBad);

loadPresets();
loadRuns();
loadBad();
setInterval(loadRuns, 4000);
</script>
</body>
</html>`
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true)
    const pathname = parsed.pathname || '/'

    if (pathname === '/' && req.method === 'GET') {
      return sendHtml(res, htmlPage())
    }

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname)
    }

    return notFound(res)
  } catch (e) {
    console.error(`[SRE] Error processing request for ${req.url}:`, e)
    send(res, 500, { error: 'Internal Server Error' })
  }
})

server.listen(PORT, () => {
  console.log(`[SRE] Dashboard running at http://localhost:${PORT}`)
  console.log(`[SRE] Data dir: ${DATA_SRE_DIR}`)
})
