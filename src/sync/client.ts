import { emptyDb, type Database, type Patch, type Presence, type UserId, type WatcherState } from '../types'
import { loadOfflineQueue, pendingOfflineCount, saveOfflineQueue } from '../lib/offlineQueue'

export type ClientMsg =
  | { type: 'patch'; patch: Patch; user: UserId }
  | { type: 'presence'; presence: Presence }
  | {
      type: 'report'
      user: UserId
      text: string
      screen: Presence['screen']
      orderId?: string
      version: string
      photos?: string[]
    }
  | { type: 'push-sub'; user: UserId; subscription: PushSubscriptionJSON }
  | { type: 'ping' }

type Handlers = {
  onDb: (db: Database) => void
  onWatcher: (w: WatcherState) => void
  onPresence: (p: Presence[]) => void
  onVapid: (key: string) => void
  onStatus: (connected: boolean) => void
  onError?: (message: string) => void
  onPending?: (count: number) => void
  onSynced?: () => void
}

function typingNow() {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
}

function watcherKey(w: WatcherState) {
  return `${w.status}|${w.pendingCount || 0}|${w.currentReportId || ''}|${w.error || ''}`
}

function presenceKey(list: Presence[]) {
  return list.map((p) => `${p.user}:${p.screen}:${p.orderId || ''}:${p.fieldId || ''}`).join('|')
}

function dbFingerprint(db: Database) {
  let h = 0
  for (const l of db.purchaseLines) {
    h = (Math.imul(h, 33) + (l.actualQty || 0) + Math.round((l.unitPrice || 0) * 10) + (l.plannedQty || 0)) | 0
  }
  for (const p of db.planItems) {
    h = (Math.imul(h, 33) + (p.qty || 0)) | 0
  }
  const reports = (db.reports || []).map((r) => `${r.id}:${r.status}`).join(',')
  return `${db.products.length}|${db.orders.length}|${db.planItems.length}|${db.purchaseLines.length}|${db.payments.length}|${db.audit[0]?.id || ''}|${h}|${reports}`
}

export function createSync(user: UserId, handlers: Handlers, origin: string) {
  let stopped = false
  let lastOk = false
  let pulling = false
  let flushing = false
  let lastPending = pendingOfflineCount()
  let lastWatcher = ''
  let lastPresence = ''
  let lastDb = ''
  let vapidDone = false
  const base = origin.replace(/\/$/, '')

  function notifyPending() {
    const n = pendingOfflineCount()
    handlers.onPending?.(n)
    if (lastPending > 0 && n === 0) handlers.onSynced?.()
    lastPending = n
  }

  async function post(path: string, body: unknown) {
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; db?: Database }
    if (!r.ok) {
      if (j.error) handlers.onError?.(j.error)
      throw new Error(j.error || `HTTP ${r.status}`)
    }
    return j
  }

  async function flush() {
    if (flushing || stopped) return
    flushing = true
    try {
      while (!stopped) {
        const queue = loadOfflineQueue()
        if (!queue.length) break
        const msg = queue[0]
        try {
          if (msg.type === 'patch') {
            const j = await post('/api/patch', { patch: msg.patch, user: msg.user })
            saveOfflineQueue(queue.slice(1))
            notifyPending()
            if (j.db && pendingOfflineCount() === 0) {
              lastDb = dbFingerprint(j.db)
              handlers.onDb(j.db)
            }
            lastOk = true
            handlers.onStatus(true)
            continue
          }
          if (msg.type === 'report') {
            await post('/api/report', msg)
          } else if (msg.type === 'push-sub') {
            await post('/api/push-sub', { user: msg.user, subscription: msg.subscription })
          } else {
            saveOfflineQueue(queue.slice(1))
            notifyPending()
            continue
          }
          saveOfflineQueue(queue.slice(1))
          notifyPending()
          lastOk = true
          handlers.onStatus(true)
        } catch (err) {
          const text = String((err as Error).message || err)
          if (text.startsWith('No da:') || text.startsWith('HTTP 400')) {
            saveOfflineQueue(queue.slice(1))
            notifyPending()
            continue
          }
          lastOk = false
          handlers.onStatus(false)
          return
        }
      }
    } finally {
      flushing = false
    }
  }

  async function pull() {
    if (stopped || pulling) return
    pulling = true
    try {
      const r = await fetch(`${base}/api/state?t=${Date.now()}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const j = (await r.json()) as {
        db: Database
        watcher: WatcherState
        presence: Presence[]
        vapidPublicKey?: string
      }
      lastOk = true
      handlers.onStatus(true)
      if (j.watcher) {
        const wk = watcherKey(j.watcher)
        if (wk !== lastWatcher) {
          lastWatcher = wk
          handlers.onWatcher(j.watcher)
        }
      }
      if (j.presence) {
        const pk = presenceKey(j.presence)
        if (pk !== lastPresence) {
          lastPresence = pk
          handlers.onPresence(j.presence)
        }
      }
      if (j.vapidPublicKey && !vapidDone) {
        vapidDone = true
        void handlers.onVapid(j.vapidPublicKey)
      }
      if (!pendingOfflineCount() && j.db && !typingNow()) {
        const dk = dbFingerprint(j.db)
        if (dk !== lastDb) {
          lastDb = dk
          handlers.onDb(j.db)
        }
      }
      await flush()
    } catch {
      lastOk = false
      handlers.onStatus(false)
      await flush()
    } finally {
      pulling = false
    }
  }

  async function sendPresence(presence: Presence) {
    if (stopped) return
    try {
      await post('/api/presence', { presence: { ...presence, user } })
      lastOk = true
      handlers.onStatus(true)
    } catch {
      lastOk = false
      handlers.onStatus(false)
    }
  }

  function nudge() {
    if (typingNow()) return
    void pull()
  }

  notifyPending()
  void pull()
  const tick = window.setInterval(nudge, 4000)
  window.addEventListener('online', nudge)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') nudge()
  })

  return {
    sendPresence,
    flush: () => void flush(),
    isOpen() {
      return lastOk
    },
    stop() {
      stopped = true
      window.clearInterval(tick)
      window.removeEventListener('online', nudge)
    },
  }
}

export function seedDb(): Database {
  return emptyDb()
}
