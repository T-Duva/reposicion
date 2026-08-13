import { create } from 'zustand'
import { emptyDb, type Database, type Patch, type Presence, type Screen, type UserId, type WatcherState } from '../types'
import { createSync } from '../sync/client'
import { loadLocalDb, mergeDbFromServer, normalizeDb, saveLocalDb } from '../lib/localDb'
import { enqueueOffline, pendingOfflineCount } from '../lib/offlineQueue'
import { applyPatchLocal } from '../lib/patch'
import { copyApkUrlFromText } from '../lib/apkUrl'
import { resolveServerOrigin } from '../lib/server'
import { patchError } from '../lib/validate'
import { userPatchError } from '../lib/userAccess'
import { APP_VERSION } from '../version'

type SyncHandle = ReturnType<typeof createSync> | null

interface AppStore {
  user: UserId | null
  screen: Screen
  orderId: string | null
  db: Database
  watcher: WatcherState
  presence: Presence[]
  connected: boolean
  pendingSync: number
  focusField: string | null
  buyJumpLineId: string | null
  buyJumpProductId: string | null
  vapidPublicKey: string
  reportOpen: boolean
  toast: string | null
  login: (user: UserId) => void
  logout: () => void
  setScreen: (s: Screen) => void
  goToBuyLine: (lineId: string) => void
  goToBuyProduct: (productId: string) => void
  setOrderId: (id: string | null) => void
  setFocus: (id: string | null) => void
  setReportOpen: (v: boolean) => void
  clearToast: () => void
  apply: (patch: Patch) => void
  applyAll: (patches: Patch[]) => void
  sendReport: (text: string, photos?: string[]) => void
  markNotifRead: (id: string) => void
}

let sync: SyncHandle = null
let presenceTimer: ReturnType<typeof setInterval> | undefined

function persistUser(user: UserId | null) {
  if (user) localStorage.setItem('reposicion.user', user)
  else localStorage.removeItem('reposicion.user')
}

export const useApp = create<AppStore>((set, get) => ({
  user: null,
  screen: 'home',
  orderId: localStorage.getItem('reposicion.order') || null,
  db: loadLocalDb(),
  watcher: { status: 'off', lastSeenAt: 0 },
  presence: [],
  connected: false,
  pendingSync: pendingOfflineCount(),
  focusField: null,
  buyJumpLineId: null,
  buyJumpProductId: null,
  vapidPublicKey: '',
  reportOpen: false,
  toast: null,

  login(user) {
    persistUser(user)
    sync?.stop()
    set({ user, screen: 'home', db: loadLocalDb(), pendingSync: pendingOfflineCount() })
    void (async () => {
      let origin = ''
      try {
        origin = await resolveServerOrigin()
      } catch {
        set({ connected: false })
        return
      }
      if (get().user !== user) return
      sync = createSync(
        user,
        {
          onDb: (db) => {
            const prev = get().db
            const next = mergeDbFromServer(prev, db)
            saveLocalDb(next)
            set({ db: next })
            const me = get().user
            if (!me) return
            const seen = new Set(prev.notifications.map((n) => n.id))
            for (const n of next.notifications) {
              if (n.to !== me || n.read || seen.has(n.id)) continue
              const url = copyApkUrlFromText(`${n.title} ${n.body}`)
              if (url) {
                set({ toast: `Enlace copiado: ${url}` })
                break
              }
            }
          },
          onWatcher: (watcher) => set({ watcher }),
          onPresence: (presence) => set({ presence }),
          onVapid: async (vapidPublicKey) => {
            set({ vapidPublicKey })
            try {
              await registerPush(user, vapidPublicKey, (msg) => {
                enqueueOffline(msg)
                set({ pendingSync: pendingOfflineCount() })
                sync?.flush()
              })
            } catch {
              /* permiso denegado: igual anda in-app */
            }
          },
          onStatus: (connected) => {
            if (get().connected !== connected) set({ connected })
          },
          onPending: (count) => set({ pendingSync: count }),
          onSynced: () => set({ toast: 'Cambios sincronizados' }),
          onError: (message) => set({ toast: message }),
        },
        origin,
      )
      void sync.flush()
      clearInterval(presenceTimer)
      presenceTimer = setInterval(() => {
        const s = get()
        if (!s.user || !sync) return
        const el = document.activeElement
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
        void sync.sendPresence({
          user: s.user,
          screen: s.screen,
          orderId: s.orderId ?? undefined,
          fieldId: s.focusField,
          updatedAt: Date.now(),
        })
      }, 4000)
    })()
  },

  logout() {
    persistUser(null)
    sync?.stop()
    sync = null
    clearInterval(presenceTimer)
    set({ user: null, connected: false, watcher: { status: 'off', lastSeenAt: 0 }, db: emptyDb() })
  },

  setScreen(screen) {
    set({ screen, focusField: null })
  },

  goToBuyLine(lineId) {
    const { db, orderId, apply } = get()
    if (orderId) {
      const line = db.purchaseLines.find((l) => l.id === lineId && l.orderId === orderId)
      if (line) {
        const order = db.orders.find((o) => o.id === orderId)
        if (order?.skipPurchase?.includes(line.productId)) {
          apply({
            op: 'upsert',
            col: 'orders',
            row: { ...order, skipPurchase: order.skipPurchase!.filter((id) => id !== line.productId) },
          })
        }
      }
    }
    set({ buyJumpLineId: lineId, screen: 'buy', focusField: null, buyJumpProductId: null })
  },

  goToBuyProduct(productId) {
    set({ buyJumpProductId: productId, screen: 'buy', focusField: null, buyJumpLineId: null })
  },

  setOrderId(orderId) {
    if (orderId) localStorage.setItem('reposicion.order', orderId)
    else localStorage.removeItem('reposicion.order')
    set({ orderId })
  },

  setFocus(focusField) {
    set({ focusField })
  },

  setReportOpen(reportOpen) {
    set({ reportOpen })
  },

  clearToast() {
    set({ toast: null })
  },

  apply(patch) {
    get().applyAll([patch])
  },

  applyAll(patches) {
    if (!patches.length) return
    const user = get().user
    if (!user) return
    let db = get().db
    for (const patch of patches) {
      const err = userPatchError(user, patch, db) || patchError(patch)
      if (err) {
        set({ toast: err })
        return
      }
      db = normalizeDb(applyPatchLocal(db, patch, user))
    }
    saveLocalDb(db)
    set({ db })
    for (const patch of patches) {
      enqueueOffline({ type: 'patch', patch, user })
    }
    set({ pendingSync: pendingOfflineCount() })
    sync?.flush()
  },

  sendReport(text, photos) {
    const s = get()
    if (!s.user) return
    enqueueOffline({
      type: 'report',
      user: s.user,
      text,
      photos,
      screen: s.screen,
      orderId: s.orderId ?? undefined,
      version: APP_VERSION,
    })
    set({
      reportOpen: false,
      pendingSync: pendingOfflineCount(),
      toast: s.connected ? 'Reporte enviado' : 'Guardado en el celular — se envía al conectar',
    })
    sync?.flush()
  },

  markNotifRead(id) {
    const n = get().db.notifications.find((x) => x.id === id)
    if (!n) return
    get().apply({ op: 'upsert', col: 'notifications', row: { ...n, read: true } })
  },
}))

async function registerPush(
  user: UserId,
  vapidPublicKey: string,
  send: (msg: { type: 'push-sub'; user: UserId; subscription: PushSubscriptionJSON }) => void,
) {
  if (!('serviceWorker' in navigator) || !vapidPublicKey) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  })
  send({ type: 'push-sub', user, subscription: sub.toJSON() })
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function otherUser(me: UserId): UserId | null {
  return me === 'tomas' ? 'martin' : 'tomas'
}
