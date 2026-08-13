import { median } from './median'
import { skipPurchaseSet } from './orderSkip'
import type { Database, Payment, PurchaseLine, Station } from '../types'

export type RepartirLine = {
  productId: string
  split: Record<Station, number>
  purchaseLine: PurchaseLine | null
  fromPlan: boolean
}

function planSplitSum(split: Record<Station, number> | undefined): number {
  const s = split || { madro: 0, ligux: 0, elugas: 0 }
  return (Number(s.madro) || 0) + (Number(s.ligux) || 0) + (Number(s.elugas) || 0)
}

export function productHistory(db: Database, productId: string): number[] {
  return db.purchaseLines
    .filter((l) => l.productId === productId && l.actualQty > 0)
    .map((l) => l.actualQty)
}

export function productMedian(db: Database, productId: string): number | null {
  return median(productHistory(db, productId))
}

export function productHasCarryHistory(db: Database, productId: string): boolean {
  return productHistory(db, productId).length > 0
}

export function productStationMedians(db: Database, productId: string): Record<Station, number | null> {
  const byStation: Record<Station, number[]> = { madro: [], ligux: [], elugas: [] }
  for (const l of db.purchaseLines.filter((x) => x.productId === productId && x.actualQty > 0)) {
    const s = { ...emptyStationSplit(), ...(l.split || {}) }
    for (const st of ['madro', 'ligux', 'elugas'] as Station[]) {
      const qty = Number(s[st]) || 0
      if (qty > 0) byStation[st].push(qty)
    }
  }
  return {
    madro: median(byStation.madro),
    ligux: median(byStation.ligux),
    elugas: median(byStation.elugas),
  }
}

function lastPurchaseLines(db: Database, productId: string) {
  return db.purchaseLines
    .filter((l) => l.productId === productId && (l.actualQty > 0 || l.unitPrice > 0))
    .map((l) => {
      const order = db.orders.find((o) => o.id === l.orderId)
      return { line: l, date: order?.date ?? '', at: order?.createdAt ?? 0 }
    })
    .sort((a, b) => (a.date === b.date ? b.at - a.at : b.date.localeCompare(a.date)))
}

export function lastPurchasedQty(db: Database, productId: string): number | null {
  const hit = lastPurchaseLines(db, productId).find((x) => x.line.actualQty > 0)
  return hit?.line.actualQty ?? null
}

/** Precio unitario: siempre el último cargado (no mediana). */
export function lastUnitPrice(db: Database, productId: string): number | null {
  const hit = lastPurchaseLines(db, productId).find((x) => x.line.unitPrice > 0)
  return hit?.line.unitPrice ?? null
}

export function emptyStationSplit(): Record<Station, number> {
  return { madro: 0, ligux: 0, elugas: 0 }
}

export function lineHasPurchase(l: PurchaseLine): boolean {
  return l.actualQty > 0 || l.unitPrice > 0 || l.totalPrice > 0
}

export function splitTotal(l: PurchaseLine): number {
  const s = l.split || { madro: 0, ligux: 0, elugas: 0 }
  return (Number(s.madro) || 0) + (Number(s.ligux) || 0) + (Number(s.elugas) || 0)
}

/** Cantidad comprada efectiva: reparto por estación o actualQty (p. ej. datos viejos). */
export function purchaseQty(l: PurchaseLine): number {
  return splitTotal(l) || l.actualQty || 0
}

export function lineCostForStation(l: PurchaseLine, station: Station): number {
  const qty = (l.split?.[station] as number | undefined) || 0
  if (qty <= 0) return 0
  if (l.unitPrice > 0) return qty * l.unitPrice
  const bought = purchaseQty(l)
  if (bought > 0 && l.totalPrice > 0) return (l.totalPrice * qty) / bought
  return 0
}

export function lineTotal(l: PurchaseLine): number {
  const qty = purchaseQty(l)
  if (l.unitPrice > 0 && qty > 0) return l.unitPrice * qty
  return l.totalPrice || 0
}

/** Corrige totalPrice viejo (totalManual o desfasado de U.×cant.). */
export function refreshPurchaseLineTotal(line: PurchaseLine): PurchaseLine | null {
  const parts = splitTotal(line)
  let next = line
  if (parts > 0 && Math.abs((line.actualQty || 0) - parts) > 0.001) {
    next = { ...next, actualQty: parts }
  }
  const qty = purchaseQty(next)
  if (next.unitPrice > 0 && qty > 0) {
    const totalPrice = next.unitPrice * qty
    if (
      next.totalManual ||
      Math.abs((next.totalPrice || 0) - totalPrice) > 0.001 ||
      next !== line
    ) {
      return { ...next, totalPrice, totalManual: false }
    }
    return null
  }
  if (next.totalManual) return { ...next, totalManual: false }
  if (next !== line) return next
  return null
}

export function orderSpent(db: Database, orderId: string): number {
  return db.purchaseLines
    .filter((l) => l.orderId === orderId && lineHasPurchase(l))
    .reduce((s, l) => s + lineTotal(l), 0)
}

export function stationSpentInOrder(db: Database, orderId: string, station: Station): number {
  return repartirLines(db, orderId).reduce((s, rl) => s + repartirLineCostForStation(db, rl, station), 0)
}

function activePurchaseLines(purchases: PurchaseLine[], productId: string) {
  return purchases.filter((l) => l.productId === productId && splitTotal(l) > 0)
}

function combinedSplit(lines: PurchaseLine[]): Record<Station, number> {
  const split = emptyStationSplit()
  for (const l of lines) {
    const s = l.split || emptyStationSplit()
    for (const st of ['madro', 'ligux', 'elugas'] as Station[]) {
      split[st] += Number(s[st]) || 0
    }
  }
  return split
}

/** Líneas visibles en Repartir: compra real o, si falta, reparto planificado. */
export function repartirLines(db: Database, orderId: string): RepartirLine[] {
  const order = db.orders.find((o) => o.id === orderId)
  const skip = skipPurchaseSet(order)
  const plans = db.planItems.filter((p) => p.orderId === orderId)
  const purchases = db.purchaseLines.filter((l) => l.orderId === orderId)
  const out: RepartirLine[] = []
  const seen = new Set<string>()

  for (const plan of plans) {
    if (skip.has(plan.productId)) continue
    if (seen.has(plan.productId)) continue
    seen.add(plan.productId)
    const active = activePurchaseLines(purchases, plan.productId)
    const planSplit = { ...emptyStationSplit(), ...(plan.split || {}) }
    if (active.length > 0) {
      out.push({ productId: plan.productId, split: combinedSplit(active), purchaseLine: active[0], fromPlan: false })
    } else if (planSplitSum(planSplit) > 0) {
      const line = purchases.find((l) => l.productId === plan.productId) ?? null
      out.push({ productId: plan.productId, split: planSplit, purchaseLine: line, fromPlan: true })
    }
  }

  for (const line of purchases) {
    if (seen.has(line.productId) || skip.has(line.productId)) continue
    const active = activePurchaseLines(purchases, line.productId)
    if (active.length > 0) {
      out.push({ productId: line.productId, split: combinedSplit(active), purchaseLine: active[0], fromPlan: false })
      seen.add(line.productId)
    }
  }

  return out
}

function repartirOrderPurchaseLines(db: Database, rl: RepartirLine): PurchaseLine[] {
  const orderId = rl.purchaseLine?.orderId
  if (!orderId) return []
  return db.purchaseLines.filter(
    (l) => l.orderId === orderId && l.productId === rl.productId && lineHasPurchase(l),
  )
}

/** Precio unitario de la línea en Repartir (promedio ponderado si hay varias compras del mismo producto). */
export function repartirLineUnitPrice(db: Database, rl: RepartirLine): number {
  const lines = repartirOrderPurchaseLines(db, rl)
  let totalCost = 0
  let totalQty = 0
  for (const l of lines) {
    const qty = purchaseQty(l)
    if (qty <= 0) continue
    const cost = lineTotal(l)
    if (cost > 0) {
      totalCost += cost
      totalQty += qty
    }
  }
  if (totalQty > 0 && totalCost > 0) return totalCost / totalQty
  // Producto nuevo: precio cargado en Comprar aunque el reparto siga solo en el plan.
  const priced = lines.find((l) => l.unitPrice > 0)
  if (priced) return priced.unitPrice
  return lastUnitPrice(db, rl.productId) || 0
}

/** Guía: unitario + 75 %, redondeado hacia arriba (solo visual en Repartir). */
export function repartirGuideUnitPrice(unitPrice: number): number {
  if (unitPrice <= 0) return 0
  return Math.ceil(unitPrice * 1.75)
}

export function repartirLineCostForStation(db: Database, rl: RepartirLine, station: Station): number {
  const qty = rl.split[station] || 0
  if (qty <= 0) return 0
  const lines = repartirOrderPurchaseLines(db, rl)
  if (lines.length > 0) {
    const fromLines = lines.reduce((s, l) => s + lineCostForStation(l, station), 0)
    if (fromLines > 0) return fromLines
  }
  return qty * repartirLineUnitPrice(db, rl)
}

export function orderIsPurchased(db: Database, orderId: string): boolean {
  return db.purchaseLines.some((l) => l.orderId === orderId && lineHasPurchase(l))
}

/** Ligux y Elugas pagan adelantado; Madro usa los pagos cargados en Repartir. */
export function stationPaidAmount(station: Station, spent: number, payments: Payment[]): number {
  if (station !== 'madro') return spent
  return payments.filter((p) => p.station === station).reduce((s, p) => s + p.amount, 0)
}

export function stationPaidTotal(db: Database, station: Station, spent: number, orderIds: Set<string>): number {
  if (station !== 'madro') return spent
  return db.payments
    .filter((p) => p.station === station && (!p.orderId || orderIds.has(p.orderId)))
    .reduce((s, p) => s + p.amount, 0)
}
