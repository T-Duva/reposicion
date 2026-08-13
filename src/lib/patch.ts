import { mergeOrderUpsert } from './orderSkip'
import { emptyDb, type Database, type Patch, type UserId } from '../types'

function shallow(db: Database): Database {
  return {
    products: db.products,
    orders: db.orders,
    planItems: db.planItems,
    purchaseLines: db.purchaseLines,
    placeDiscounts: db.placeDiscounts || [],
    payments: db.payments,
    audit: db.audit,
    reports: db.reports,
    notifications: db.notifications,
  }
}

export function applyPatchLocal(db: Database, patch: Patch, _user: UserId): Database {
  if (patch.op === 'replace') return patch.db ?? emptyDb()

  const next = shallow(db)

  if (patch.op === 'remove') {
    const removedPurchase =
      patch.col === 'purchaseLines' ? next.purchaseLines.find((r) => r.id === patch.id) : undefined
    cascadeRemove(next, patch.col, patch.id)
    next[patch.col] = next[patch.col].filter((r) => r.id !== patch.id) as never
    if (removedPurchase) {
      noteSkipPurchase(next, removedPurchase.orderId, removedPurchase.productId)
    }
    return next
  }

  if (patch.op === 'upsert') {
    const col = patch.col
    if (col === 'orders') {
      const row = patch.row as Database['orders'][number]
      const sameDate = next.orders.find((o) => o.date === row.date && o.id !== row.id)
      if (sameDate) return next
    }
    const list = next[col] as Array<{ id: string }>
    const idx = list.findIndex((r) => r.id === patch.row.id)
    const copy = list.slice()
    if (col === 'orders' && idx >= 0) {
      const merged = mergeOrderUpsert(copy[idx] as Database['orders'][number], patch.row as Database['orders'][number])
      copy[idx] = merged
      next.orders = copy as Database['orders']
      purgeSkippedPurchaseLines(next, merged)
      return next
    }
    if (idx >= 0) copy[idx] = patch.row
    else copy.unshift(patch.row)
    if (col === 'products') next.products = copy as Database['products']
    else if (col === 'orders') next.orders = copy as Database['orders']
    else if (col === 'planItems') next.planItems = copy as Database['planItems']
    else if (col === 'purchaseLines') next.purchaseLines = copy as Database['purchaseLines']
    else if (col === 'placeDiscounts') next.placeDiscounts = copy as Database['placeDiscounts']
    else if (col === 'payments') next.payments = copy as Database['payments']
    else if (col === 'audit') next.audit = copy as Database['audit']
    else if (col === 'reports') next.reports = copy as Database['reports']
    else if (col === 'notifications') next.notifications = copy as Database['notifications']
    if (col === 'orders') purgeSkippedPurchaseLines(next, patch.row as Database['orders'][number])
    return next
  }

  return next
}

function noteSkipPurchase(db: Database, orderId: string, productId: string) {
  const left = db.purchaseLines.some((l) => l.orderId === orderId && l.productId === productId)
  if (left) return
  const idx = db.orders.findIndex((o) => o.id === orderId)
  if (idx < 0) return
  const order = db.orders[idx]
  if (order.skipPurchase?.includes(productId)) return
  const orders = db.orders.slice()
  orders[idx] = { ...order, skipPurchase: [...(order.skipPurchase || []), productId] }
  db.orders = orders
}

function purgeSkippedPurchaseLines(db: Database, order: Database['orders'][number]) {
  const skip = order.skipPurchase
  if (!skip?.length) return
  const blocked = new Set(skip)
  db.purchaseLines = db.purchaseLines.filter((l) => l.orderId !== order.id || !blocked.has(l.productId))
}

function cascadeRemove(db: Database, col: keyof Database, id: string) {
  if (col === 'orders') {
    db.planItems = db.planItems.filter((r) => r.orderId !== id)
    db.purchaseLines = db.purchaseLines.filter((r) => r.orderId !== id)
    db.placeDiscounts = (db.placeDiscounts || []).filter((r) => r.orderId !== id)
    db.payments = db.payments.filter((r) => r.orderId !== id)
  }
  if (col === 'products') {
    db.planItems = db.planItems.filter((r) => r.productId !== id)
    db.purchaseLines = db.purchaseLines.filter((r) => r.productId !== id)
  }
}
