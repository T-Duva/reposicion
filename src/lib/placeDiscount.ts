import { txt } from './format'
import { nameMatchesQuery } from './nameFilter'
import { lineCostForStation, lineHasPurchase, lineTotal } from './stats'
import type { Database, PurchaseLine, Station } from '../types'

/** Líneas de compra sin dir./obs. van acá para que el total cuadre con Comprar. */
export const NO_PLACE_LABEL = '(sin dir./obs.)'
export const NO_PLACE_KEY = '(sin dir./obs.)'

export function placeKey(raw: string): string {
  return raw.trim().toLowerCase()
}

export function linePlaceName(line: PurchaseLine): string | null {
  const notes = txt(line.notes).trim()
  return notes || null
}

export function linePlaceKey(line: PurchaseLine): string | null {
  const name = linePlaceName(line)
  return name ? placeKey(name) : null
}

export function placeDiscountPercent(db: Database, orderId: string, key: string): number {
  const hit = (db.placeDiscounts || []).find((d) => d.orderId === orderId && d.place === key)
  return hit?.percent ?? 0
}

export function discountedAmount(amount: number, percent: number): number {
  if (percent <= 0) return amount
  return amount * (1 - Math.min(100, percent) / 100)
}

export function lineCostForStationDiscounted(
  db: Database,
  line: PurchaseLine,
  station: Station,
): number {
  const base = lineCostForStation(line, station)
  const key = linePlaceKey(line)
  if (!key) return base
  return discountedAmount(base, placeDiscountPercent(db, line.orderId, key))
}

export type PlaceRow = {
  key: string
  name: string
  total: number
  percent: number
}

export function orderPlaceLines(db: Database, orderId: string, key: string): PurchaseLine[] {
  return db.purchaseLines.filter((l) => {
    if (l.orderId !== orderId || !lineHasPurchase(l) || lineTotal(l) <= 0) return false
    const rawName = linePlaceName(l)
    const lineKey = rawName ? placeKey(rawName) : NO_PLACE_KEY
    return lineKey === key
  })
}

export function orderPlaces(db: Database, orderId: string, filterText = ''): PlaceRow[] {
  const q = filterText.trim()
  const map = new Map<string, PlaceRow>()
  for (const line of db.purchaseLines.filter((l) => l.orderId === orderId && lineHasPurchase(l))) {
    if (lineTotal(line) <= 0) continue
    const rawName = linePlaceName(line)
    const name = rawName ?? NO_PLACE_LABEL
    const key = rawName ? placeKey(rawName) : NO_PLACE_KEY
    if (q && !placeLineMatchesFilter(line, q)) continue
    const row = map.get(key) ?? {
      key,
      name,
      total: 0,
      percent: placeDiscountPercent(db, orderId, key),
    }
    row.total += lineTotal(line)
    map.set(key, row)
  }
  return [...map.values()]
}

export function placeLineMatchesFilter(line: PurchaseLine, query: string): boolean {
  const name = linePlaceName(line)
  if (!name) return nameMatchesQuery(NO_PLACE_LABEL, query)
  return nameMatchesQuery(name, query)
}

export function orderDiscountTotal(db: Database, orderId: string): number {
  let saved = 0
  for (const row of orderPlaces(db, orderId)) {
    if (row.percent <= 0) continue
    saved += row.total - discountedAmount(row.total, row.percent)
  }
  return saved
}
