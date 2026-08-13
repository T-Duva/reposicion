import { emptyDb, type Database, type Order, type Product, type PurchaseLine } from '../types'
import { loadOfflineQueue } from './offlineQueue'
import { skipPurchaseSet } from './orderSkip'

const KEY = 'reposicion.db'

function localSkipByOrder(local: Database, persisted: Database): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const o of [...local.orders, ...persisted.orders]) {
    const prev = out.get(o.id)
    out.set(o.id, new Set([...(prev || []), ...(o.skipPurchase || [])]))
  }
  return out
}

/** Al traer estado del servidor, no pisar sacados de Comprar ni borrados pendientes de sync. */
export function mergeDbFromServer(local: Database, incoming: Database): Database {
  const persisted = loadLocalDb()
  const next = normalizeDb(incoming)
  const localSkip = localSkipByOrder(local, persisted)

  for (const [orderId, skip] of localSkip) {
    if (!skip.size) continue
    const so = next.orders.find((o) => o.id === orderId)
    if (!so) continue
    so.skipPurchase = [...new Set([...(so.skipPurchase || []), ...skip])]
  }

  const pendingLineRemoves = new Set<string>()
  for (const msg of loadOfflineQueue()) {
    if (msg.type !== 'patch') continue
    const p = msg.patch
    if (p.op === 'remove' && p.col === 'purchaseLines') pendingLineRemoves.add(p.id)
    if (p.op === 'upsert' && p.col === 'products') {
      const row = p.row as Product
      const idx = next.products.findIndex((r) => r.id === row.id)
      if (idx >= 0) next.products[idx] = { ...next.products[idx], ...row }
      else next.products.unshift(row)
    }
    if (p.op === 'upsert' && p.col === 'purchaseLines') {
      const row = p.row as PurchaseLine
      const idx = next.purchaseLines.findIndex((r) => r.id === row.id)
      if (idx >= 0) next.purchaseLines[idx] = { ...next.purchaseLines[idx], ...row }
      else next.purchaseLines.unshift(row)
    }
    if (p.op === 'upsert' && p.col === 'orders') {
      const row = p.row as Order
      const so = next.orders.find((o) => o.id === row.id)
      if (!so) continue
      so.skipPurchase = [...new Set([...(so.skipPurchase || []), ...(row.skipPurchase || [])])]
    }
  }

  next.purchaseLines = next.purchaseLines.filter((l) => {
    if (pendingLineRemoves.has(l.id)) return false
    const skip = skipPurchaseSet(next.orders.find((o) => o.id === l.orderId))
    return !skip.has(l.productId)
  })

  return next
}

export function normalizePurchaseLine(l: PurchaseLine): PurchaseLine {
  return {
    ...l,
    address: l.address ?? '',
    notes: l.notes ?? '',
    split: {
      madro: Number(l.split?.madro) || 0,
      ligux: Number(l.split?.ligux) || 0,
      elugas: Number(l.split?.elugas) || 0,
    },
  }
}

export function normalizeDb(parsed: Partial<Database> | null | undefined): Database {
  if (!parsed) return emptyDb()
  return {
    products: parsed.products || [],
    orders: parsed.orders || [],
    planItems: parsed.planItems || [],
    purchaseLines: (parsed.purchaseLines || []).map(normalizePurchaseLine),
    placeDiscounts: parsed.placeDiscounts || [],
    payments: parsed.payments || [],
    audit: parsed.audit || [],
    reports: parsed.reports || [],
    notifications: parsed.notifications || [],
  }
}

export function loadLocalDb(): Database {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyDb()
    return normalizeDb(JSON.parse(raw) as Database)
  } catch {
    return emptyDb()
  }
}

export function saveLocalDb(db: Database) {
  const slim: Database = {
    ...db,
    reports: (db.reports || []).map((r) => ({ ...r, photos: [] })),
  }
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(slim))
    } catch {
      /* quota */
    }
  }
  try {
    window.clearTimeout((saveLocalDb as { t?: number }).t)
    ;(saveLocalDb as { t?: number }).t = window.setTimeout(write, 280)
  } catch {
    write()
  }
}
