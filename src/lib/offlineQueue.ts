import type { ClientMsg } from '../sync/client'

const KEY = 'reposicion.offlineQueue'

export function loadOfflineQueue(): ClientMsg[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ClientMsg[]) : []
  } catch {
    return []
  }
}

export function saveOfflineQueue(queue: ClientMsg[]) {
  try {
    if (!queue.length) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(queue))
  } catch {
    /* quota */
  }
}

export function enqueueOffline(msg: ClientMsg) {
  if (msg.type === 'ping') return
  const q = loadOfflineQueue()
  q.push(msg)
  saveOfflineQueue(q)
}

export function pendingOfflineCount(): number {
  return loadOfflineQueue().length
}
