import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import webpush from 'web-push'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataDir = path.join(root, 'data')
const inboxDir = path.join(root, 'inbox')
const dbPath = path.join(dataDir, 'db.json')
const vapidPath = path.join(__dirname, 'vapid.json')
const subsPath = path.join(dataDir, 'push-subs.json')
const PORT = Number(process.env.PORT || 8788)

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(inboxDir, { recursive: true })

function emptyDb() {
  return {
    products: [],
    orders: [],
    planItems: [],
    purchaseLines: [],
    placeDiscounts: [],
    payments: [],
    audit: [],
    reports: [],
    notifications: [],
  }
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

if (!fs.existsSync(vapidPath)) {
  saveJson(vapidPath, webpush.generateVAPIDKeys())
}
const vapid = loadJson(vapidPath, null)
webpush.setVapidDetails('mailto:Reposicion@local', vapid.publicKey, vapid.privateKey)

let db = loadJson(dbPath, emptyDb())
function dedupeOrdersByDate() {
  const seen = new Set()
  const keep = []
  for (const o of db.orders || []) {
    if (seen.has(o.date)) {
      db.planItems = (db.planItems || []).filter((p) => p.orderId !== o.id)
      db.purchaseLines = (db.purchaseLines || []).filter((p) => p.orderId !== o.id)
      db.placeDiscounts = (db.placeDiscounts || []).filter((p) => p.orderId !== o.id)
      db.payments = (db.payments || []).filter((p) => p.orderId !== o.id)
      continue
    }
    seen.add(o.date)
    keep.push(o)
  }
  db.orders = keep
}
const orderCount = (db.orders || []).length
dedupeOrdersByDate()
if (!Array.isArray(db.orders)) db = emptyDb()
if (!Array.isArray(db.placeDiscounts)) {
  db.placeDiscounts = []
  persist()
}
if (db.orders.length !== orderCount) persist()
let subs = loadJson(subsPath, { tomas: null, martin: null })
let watcher = { status: 'off', lastSeenAt: 0, currentReportId: undefined, error: undefined, pendingCount: 0 }
let lastBeatAt = 0
let workingSince = 0

const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: '12mb' }))
const httpPresence = new Map()
const apkPath = path.join(root, 'reposicion.apk')
app.get('/reposicion.apk', (_req, res) => {
  if (!fs.existsSync(apkPath)) return res.status(404).send('APK todavía no está listo')
  res.download(apkPath, 'reposicion.apk')
})

const dist = path.join(root, 'dist')
function appVersion() {
  return loadJson(path.join(root, 'package.json'), { version: '0.0.0' }).version || '0.0.0'
}

if (fs.existsSync(dist)) {
  app.use(
    express.static(dist, {
      setHeaders(res, filePath) {
        if (/\.(js|css|mjs)$/i.test(filePath)) {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
        }
        if (/\.(html|webmanifest|js)$/i.test(filePath) && /index\.html|sw\.js|manifest\.webmanifest$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api') || req.path === '/reposicion.apk') return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ ok: true, version: appVersion(), watcher })
})
app.get('/api/app-bundle', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
    const js = html.match(/src="(\/assets\/[^"]+\.js)"/)
    const css = html.match(/href="(\/assets\/[^"]+\.css)"/)
    if (!js) return res.status(404).json({ error: 'bundle missing' })
    res.json({ version: appVersion(), js: js[1], css: css ? css[1] : '' })
  } catch {
    res.status(404).json({ error: 'bundle missing' })
  }
})
app.get('/api/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat/lon required' })
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=es`
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Reposicion/1.1.25' },
    })
    if (!r.ok) return res.status(502).json({ error: 'reverse failed' })
    const data = await r.json()
    res.json({ display_name: data.display_name || null })
  } catch {
    res.status(502).json({ error: 'reverse failed' })
  }
})
app.get('/api/state', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    ok: true,
    db,
    watcher,
    presence: presenceList(),
    vapidPublicKey: vapid.publicKey,
    version: appVersion(),
  })
})
app.post('/api/patch', (req, res) => {
  const user = parseUser(req.body?.user)
  const patch = req.body?.patch
  if (!patch) return res.status(400).json({ ok: false, error: 'Falta el cambio' })
  const err = validatePatch(patch, user)
  if (err) return res.status(400).json({ ok: false, error: err })
  applyPatch(patch, user)
  broadcast({ type: 'db', db })
  res.json({ ok: true, db })
})
app.post('/api/presence', (req, res) => {
  const p = req.body?.presence
  if (p?.user === 'tomas' || p?.user === 'martin') {
    httpPresence.set(p.user, { ...p, updatedAt: Date.now() })
  }
  res.json({ ok: true, presence: presenceList() })
})
app.post('/api/report', async (req, res) => {
  const user = parseUser(req.body?.user)
  const text = String(req.body?.text || '').trim()
  const photos = Array.isArray(req.body?.photos) ? req.body.photos.filter((p) => typeof p === 'string') : []
  if (!text && !photos.length) return res.status(400).json({ ok: false, error: 'Vacío' })
  const report = {
    id: crypto.randomUUID(),
    user,
    text,
    photos: [],
    screen: req.body.screen || 'home',
    orderId: req.body.orderId,
    version: req.body.version || '1.0.0',
    at: Date.now(),
    status: 'nuevo',
  }
  await handleReport(report, null, photos)
  res.json({ ok: true, db })
})
app.post('/api/push-sub', (req, res) => {
  const user = parseUser(req.body?.user)
  subs[user] = req.body.subscription || null
  saveJson(subsPath, subs)
  res.json({ ok: true })
})
app.post('/api/watcher/beat', (req, res) => {
  lastBeatAt = Date.now()
  const want = String(req.body?.status || '')
  const countRaw = req.body?.pendingCount
  const count =
    countRaw === undefined || countRaw === null ? watcher.pendingCount || 0 : Math.max(0, Number(countRaw) || 0)
  if (want === 'done' || want === 'online') {
    // El escuchador manda online solo cuando no hay trabajo activo
    workingSince = 0
    setWatcher({ status: 'online', currentReportId: undefined, error: undefined, pendingCount: count })
  } else if (want === 'pending') {
    if (watcher.status !== 'working' && watcher.status !== 'stuck') {
      workingSince = 0
      setWatcher({ status: 'online', currentReportId: undefined, error: undefined, pendingCount: count })
    } else {
      watcher = { ...watcher, pendingCount: count, lastSeenAt: Date.now() }
      broadcast({ type: 'watcher', watcher })
    }
  } else if (want === 'working') {
    if (watcher.status !== 'working') workingSince = Date.now()
    setWatcher({ status: 'working', error: undefined, pendingCount: count })
  } else if (want === 'stuck') {
    setWatcher({ status: 'stuck', error: req.body?.error || watcher.error, pendingCount: count })
  } else if (watcher.status === 'stuck' || watcher.status === 'working') {
    watcher = { ...watcher, pendingCount: count, lastSeenAt: Date.now() }
    broadcast({ type: 'watcher', watcher })
  } else {
    setWatcher({ status: 'online', pendingCount: count })
  }
  res.json({ ok: true, watcher })
})
app.post('/api/agent-note', (req, res) => {
  const title = String(req.body?.title || 'REPOSICIÓN').slice(0, 120)
  const body = String(req.body?.body || '').slice(0, 1200)
  const push = String(req.body?.push || body).slice(0, 280)
  const to = req.body?.to === 'martin' ? 'martin' : 'tomas'
  if (!body) return res.status(400).json({ ok: false, error: 'Vacío' })
  const notif = {
    id: crypto.randomUUID(),
    to,
    title,
    body,
    at: Date.now(),
    read: false,
  }
  db.notifications.unshift(notif)
  db.notifications = db.notifications.slice(0, 100)
  persist()
  broadcast({ type: 'db', db })
  notifyWindows(title, body)
  void sendPush(to, title, push)
  res.json({ ok: true })
})
app.get('/api/vapid', (_req, res) => {
  res.json({ publicKey: vapid.publicKey })
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set()

function persist() {
  saveJson(dbPath, db)
}

function broadcast(msg, except) {
  const raw = JSON.stringify(msg)
  for (const c of clients) {
    if (c !== except && c.ws.readyState === 1) c.ws.send(raw)
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

function presenceList() {
  const now = Date.now()
  const map = new Map()
  for (const c of clients) {
    if (c.presence && now - c.presence.updatedAt < 15000) map.set(c.user, c.presence)
  }
  for (const [user, p] of httpPresence) {
    if (p && now - p.updatedAt < 15000) map.set(user, p)
  }
  return [...map.values()]
}

const STATIONS = ['ligux', 'elugas', 'madro']
const STATION_LABEL = { ligux: 'Ligux', elugas: 'Elugas', madro: 'Madro' }

function splitSum(split) {
  if (!split || typeof split !== 'object') return 0
  return (Number(split.madro) || 0) + (Number(split.ligux) || 0) + (Number(split.elugas) || 0)
}

function splitDetail(split) {
  return STATIONS.map((st) => `${STATION_LABEL[st]} ${Number(split?.[st]) || 0}`).join(' + ')
}

function parseUser(raw) {
  if (raw === 'martin') return 'martin'
  return 'tomas'
}

const USER_LABEL = { tomas: 'Tomás', martin: 'Martín' }


function validatePatch(patch, user) {
  if (!patch || patch.op !== 'upsert') return null
  const row = patch.row || {}
  if (patch.col === 'purchaseLines') {
    const parts = splitSum(row.split)
    const actual = Number(row.actualQty) || 0
    const planned = Number(row.plannedQty) || 0
    const cupo = parts || actual || planned
    if (cupo <= 0) return null
    if (parts > cupo + 0.001) {
      const verb = actual > 0 || parts > 0 ? 'compraste' : 'planificaste'
      return `No da: ${verb} ${cupo} y el reparto suma ${parts} (${splitDetail(row.split)}).`
    }
  }
  if (patch.col === 'planItems') {
    const qty = Number(row.qty) || 0
    const parts = splitSum(row.split)
    if (parts > qty + 0.001) {
      return `No da: llevás ${qty} y el reparto suma ${parts} (${splitDetail(row.split)}).`
    }
  }
  return null
}

function setWatcher(partial) {
  watcher = { ...watcher, ...partial, lastSeenAt: Date.now() }
  broadcast({ type: 'watcher', watcher })
}

function findRow(col, id) {
  return db[col].find((r) => r.id === id)
}

function mergeOrderUpsert(before, row) {
  const merged = before ? { ...before, ...row } : { ...row }
  if (row.skipPurchase === undefined) {
    if (before?.skipPurchase?.length) merged.skipPurchase = before.skipPurchase
    else delete merged.skipPurchase
    return merged
  }
  if (!before?.skipPurchase?.length) return merged
  const beforeSet = new Set(before.skipPurchase)
  const rowSet = new Set(row.skipPurchase)
  const rowIsSubset = rowSet.size < beforeSet.size && [...rowSet].every((id) => beforeSet.has(id))
  if (rowIsSubset) {
    if (row.skipPurchase.length) merged.skipPurchase = row.skipPurchase
    else delete merged.skipPurchase
    return merged
  }
  merged.skipPurchase = [...new Set([...beforeSet, ...rowSet])]
  return merged
}

function purgeSkippedPurchaseLines(order) {
  if (!order?.skipPurchase?.length) return
  const blocked = new Set(order.skipPurchase)
  db.purchaseLines = db.purchaseLines.filter((l) => l.orderId !== order.id || !blocked.has(l.productId))
}

function noteSkipPurchase(orderId, productId) {
  const left = db.purchaseLines.some((l) => l.orderId === orderId && l.productId === productId)
  if (left) return
  const idx = db.orders.findIndex((o) => o.id === orderId)
  if (idx < 0) return
  const order = db.orders[idx]
  if (order.skipPurchase?.includes(productId)) return
  db.orders[idx] = { ...order, skipPurchase: [...(order.skipPurchase || []), productId] }
}

function auditMeta(col, row) {
  const meta = { orderId: row?.orderId, rowId: row?.id }
  if (col === 'orders') meta.orderId = row?.id
  if (col === 'purchaseLines' || col === 'planItems') {
    meta.productId = row?.productId
    const p = db.products.find((x) => x.id === row?.productId)
    if (p?.name) meta.productName = p.name
  }
  return meta
}

function applyPatch(patch, user) {
  if (patch.op === 'replace') {
    db = patch.db
    persist()
    return
  }
  if (patch.op === 'remove') {
    const before = findRow(patch.col, patch.id)
    if (patch.col === 'orders') {
      db.planItems = db.planItems.filter((r) => r.orderId !== patch.id)
      db.purchaseLines = db.purchaseLines.filter((r) => r.orderId !== patch.id)
      db.placeDiscounts = (db.placeDiscounts || []).filter((r) => r.orderId !== patch.id)
      db.payments = db.payments.filter((r) => r.orderId !== patch.id)
    }
    if (patch.col === 'products') {
      db.planItems = db.planItems.filter((r) => r.productId !== patch.id)
      db.purchaseLines = db.purchaseLines.filter((r) => r.productId !== patch.id)
    }
    db[patch.col] = db[patch.col].filter((r) => r.id !== patch.id)
    if (patch.col === 'purchaseLines' && before) {
      noteSkipPurchase(before.orderId, before.productId)
      const order = db.orders.find((o) => o.id === before.orderId)
      if (order) purgeSkippedPurchaseLines(order)
    }
    if (before || patch.col !== 'purchaseLines') {
      db.audit.unshift({
        id: crypto.randomUUID(),
        user,
        at: Date.now(),
        field: `${patch.col}.delete`,
        before,
        after: null,
        ...auditMeta(patch.col, before || { id: patch.id }),
      })
      db.audit = db.audit.slice(0, 500)
    }
    persist()
    return
  }
  if (patch.op === 'upsert') {
    const col = patch.col
    const row = patch.row
    if (col === 'notifications') {
      const idx = db.notifications.findIndex((r) => r.id === row.id)
      if (idx >= 0) db.notifications[idx] = row
      else db.notifications.unshift(row)
      persist()
      return
    }
    if (col === 'purchaseLines') {
      const order = db.orders.find((o) => o.id === row.orderId)
      if (order?.skipPurchase?.includes(row.productId)) {
        persist()
        return
      }
    }
    if (col === 'orders') {
      const sameDate = db.orders.find((o) => o.date === row.date && o.id !== row.id)
      if (sameDate) {
        persist()
        return
      }
    }
    const idx = db[col].findIndex((r) => r.id === row.id)
    const before = idx >= 0 ? db[col][idx] : null
    const finalRow = col === 'orders' ? mergeOrderUpsert(before, row) : row
    if (idx >= 0) db[col][idx] = finalRow
    else db[col].unshift(finalRow)
    if (col === 'orders') purgeSkippedPurchaseLines(finalRow)
    const changed = diffFields(before, finalRow)
    for (const field of changed) {
      db.audit.unshift({
        id: crypto.randomUUID(),
        user,
        at: Date.now(),
        field: `${col}.${field}`,
        before: before ? before[field] : null,
        after: finalRow[field],
        ...auditMeta(col, finalRow),
      })
    }
    if (!before) {
      db.audit.unshift({
        id: crypto.randomUUID(),
        user,
        at: Date.now(),
        field: `${col}.create`,
        before: null,
        after: finalRow.name || finalRow.id,
        ...auditMeta(col, finalRow),
      })
    }
    db.audit = db.audit.slice(0, 500)
    persist()
  }
}

function diffFields(before, after) {
  if (!before) return []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out = []
  for (const k of keys) {
    if (k === 'id') continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(k)
  }
  return out
}

function saveReportPhotos(stamp, photoData) {
  if (!Array.isArray(photoData) || !photoData.length) return []
  const saved = []
  photoData.forEach((data, i) => {
    const raw = String(data || '')
    const m = raw.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!m) return
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace(/[^a-z0-9]/gi, '') || 'jpg'
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length) return
    const name = `${stamp}-${i + 1}.${ext}`
    fs.writeFileSync(path.join(inboxDir, name), buf)
    saved.push(name)
  })
  return saved
}

async function handleReport(report, client, photoData = []) {
  const actionable = report.user === 'tomas'
  // El número de pendientes lo manda solo el escuchador (no sumar acá: se trababa en 2).
  if (actionable) {
    if (watcher.status !== 'working' && watcher.status !== 'stuck') {
      workingSince = 0
      setWatcher({ status: 'online', currentReportId: report.id, error: undefined })
    } else {
      setWatcher({ currentReportId: report.id })
    }
  }
  db.reports.unshift(report)
  persist()
  broadcast({ type: 'db', db })

  // Evitar duplicados: mismo texto + usuario en < 4s (doble Enter / doble flush)
  const recentDup = db.reports.some(
    (r) =>
      r.id !== report.id &&
      r.user === report.user &&
      r.text === report.text &&
      Math.abs((r.at || 0) - (report.at || 0)) < 4000,
  )
  if (recentDup) {
    report.status = 'duplicado'
    report.note = 'Ignorado (mismo texto recién enviado)'
    const idx = db.reports.findIndex((r) => r.id === report.id)
    if (idx >= 0) db.reports[idx] = report
    persist()
    broadcast({ type: 'db', db })
    if (client?.ws) send(client.ws, { type: 'db', db })
    return
  }

  const file = path.join(inboxDir, `${Date.now()}-${report.user}.md`)
  const savedPhotos = saveReportPhotos(path.basename(file, '.md'), photoData)
  report.photos = savedPhotos
  const photoBlock = savedPhotos.length
    ? `\n## Fotos\n\n${savedPhotos.map((name) => `- ${name}`).join('\n')}\n`
    : ''
  fs.writeFileSync(
    file,
    `# Reporte ${report.user}\n\n- fecha: ${new Date(report.at).toISOString()}\n- pantalla: ${report.screen}\n- orden: ${report.orderId || '-'}\n- version: ${report.version}\n\n${report.text || '(sin texto)'}\n${photoBlock}`,
  )

  try {
    if (actionable) {
      notifyWindows('Orden de Tomás', report.text.slice(0, 180))
      report.status = 'hecho'
      report.note = `Encolado en inbox: ${path.basename(file)}`
    } else {
      const name = USER_LABEL[report.user] || report.user
      const title = `${name} te envió un reporte`
      const body = report.text.slice(0, 180)
      notifyWindows(title, body)
      db.notifications.unshift({
        id: crypto.randomUUID(),
        to: 'tomas',
        title,
        body,
        at: Date.now(),
        read: false,
      })
      report.status = 'notificado'
      report.note = 'Solo log — sin acción del agente'
      db.audit.unshift({
        id: crypto.randomUUID(),
        user: report.user,
        at: report.at,
        field: 'reports.create',
        before: null,
        after: report.text || '',
        orderId: report.orderId,
      })
      db.audit = db.audit.slice(0, 500)
      await sendPush('tomas', title, body)
      fs.writeFileSync(path.join(inboxDir, `DONE.${path.basename(file, '.md')}`), 'log-only', 'utf8')
    }
    const idx = db.reports.findIndex((r) => r.id === report.id)
    if (idx >= 0) db.reports[idx] = report
    persist()
    broadcast({ type: 'db', db })
  } catch (err) {
    report.status = 'error'
    report.note = String(err?.message || err)
    persist()
    broadcast({ type: 'db', db })
    setWatcher({ status: 'stuck', error: report.note, currentReportId: report.id })
  }
  if (client?.ws) send(client.ws, { type: 'db', db })
}

async function sendPush(user, title, body) {
  const sub = subs[user]
  if (!sub) return
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body }))
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      subs[user] = null
      saveJson(subsPath, subs)
    }
  }
}

function notifyWindows(title, message) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.NotifyIcon].GetConstructors() | Out-Null;
[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;
[System.Windows.Forms.MessageBox]::Show('${esc(message).slice(0, 200)}','${esc(title)}')`
  // toast sin bloquear: balloon via powershell
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
$texts.Item(0).AppendChild($xml.CreateTextNode('${esc(title)}')) | Out-Null
$texts.Item(1).AppendChild($xml.CreateTextNode('${esc(message).slice(0, 180)}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('REPOSICIÓN').Show($toast)
`
  import('node:child_process').then(({ spawn }) => {
    spawn('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', windowsHide: true })
  }).catch(() => {})
  void ps
}

function esc(s) {
  return String(s || '').replace(/'/g, "''").replace(/[`$]/g, '')
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost')
  const user = parseUser(url.searchParams.get('user'))
  const client = { ws, user, presence: null }
  clients.add(client)
  send(ws, {
    type: 'hello',
    db,
    watcher,
    presence: presenceList(),
    vapidPublicKey: vapid.publicKey,
  })
  broadcast({ type: 'presence', presence: presenceList() }, ws)

  ws.on('message', async (buf) => {
    let msg
    try {
      msg = JSON.parse(String(buf))
    } catch {
      return
    }
    if (msg.type === 'ping') {
      return
    }
    if (msg.type === 'presence') {
      client.presence = { ...msg.presence, user, updatedAt: Date.now() }
      broadcast({ type: 'presence', presence: presenceList() })
      return
    }
    if (msg.type === 'push-sub') {
      subs[user] = msg.subscription
      saveJson(subsPath, subs)
      return
    }
    if (msg.type === 'patch') {
      const err = validatePatch(msg.patch, user)
      if (err) {
        send(ws, { type: 'error', message: err })
        return
      }
      applyPatch(msg.patch, user)
      broadcast({ type: 'db', db })
      return
    }
    if (msg.type === 'report') {
      const photos = Array.isArray(msg.photos) ? msg.photos.filter((p) => typeof p === 'string') : []
      const report = {
        id: crypto.randomUUID(),
        user,
        text: String(msg.text || '').trim(),
        photos: [],
        screen: msg.screen || 'home',
        orderId: msg.orderId,
        version: msg.version || '1.0.0',
        at: Date.now(),
        status: 'nuevo',
      }
      if (!report.text && !photos.length) return
      await handleReport(report, client, photos)
    }
  })

  ws.on('close', () => {
    clients.delete(client)
    broadcast({ type: 'presence', presence: presenceList() })
  })
})

setInterval(() => {
  const now = Date.now()
  const beatAge = now - lastBeatAt
  if (watcher.status === 'working') {
    if (workingSince && now - workingSince > 15 * 60 * 1000) {
      setWatcher({ status: 'stuck', error: 'El trabajo lleva más de 15 minutos' })
    } else if (lastBeatAt > 0 && beatAge > 45000) {
      setWatcher({ status: 'stuck', error: 'El escuchador se cortó' })
    }
    return
  }
  if (beatAge > 20000 && watcher.status !== 'off') {
    setWatcher({ status: 'off' })
  }
}, 3000)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`REPOSICIÓN v${appVersion()} → http://127.0.0.1:${PORT}`)
})
