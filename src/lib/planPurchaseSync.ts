import { newId } from './id'
import { emptyStationSplit, lastUnitPrice, lineHasPurchase, splitTotal } from './stats'
import { productBuyHints } from './productBuyHints'
import type { Database, Patch, PlanItem, PurchaseLine } from '../types'
import { STATIONS } from '../types'

export function planSyncKey(plans: PlanItem[]): string {
  return uniquePlansByProduct(plans)
    .map((p) => `${p.productId}:${p.qty}:${p.notes || ''}:${STATIONS.map((st) => p.split?.[st] ?? 0).join(',')}`)
    .join('|')
}

export function splitFromPlan(p: PlanItem) {
  const s = p.split
  if (s && (Number(s.madro) || 0) + (Number(s.ligux) || 0) + (Number(s.elugas) || 0) > 0) {
    return { ...emptyStationSplit(), ...s }
  }
  return emptyStationSplit()
}

function purchaseHasReparto(line: PurchaseLine) {
  return (line.actualQty || 0) > 0 || splitTotal(line) > 0
}

/** No pisar observaciones cargadas en Comprar (p. ej. «Sultán Accesorios»). */
function shouldSyncNotesFromPlan(existing: PurchaseLine, planNotes: string): boolean {
  const existingNotes = (existing.notes || '').trim()
  const plan = (planNotes || '').trim()
  if (existingNotes === plan) return false
  if (existingNotes && !plan) return false
  if (existingNotes && plan && existingNotes !== plan && lineHasPurchase(existing)) return false
  return true
}

/** Una fila de plan por producto (evita duplicar líneas de compra). */
function uniquePlansByProduct(plans: PlanItem[]): PlanItem[] {
  const byProduct = new Map<string, PlanItem>()
  for (const p of plans) {
    if (!byProduct.has(p.productId)) byProduct.set(p.productId, p)
  }
  return [...byProduct.values()]
}

function findPurchaseLine(lines: PurchaseLine[], productId: string) {
  return lines.find((l) => l.productId === productId && !l.cloneOf) ?? lines.find((l) => l.productId === productId)
}

/** Plan → compra sin pisar estaciones que ya cargaste (p. ej. Ligux/Elugas). */
function mergeSplitFromPlan(
  prev: Record<(typeof STATIONS)[number], number>,
  planSplit: Record<(typeof STATIONS)[number], number>,
) {
  const merged = { ...emptyStationSplit(), ...planSplit }
  for (const st of STATIONS) {
    if ((prev[st] || 0) > 0) merged[st] = prev[st]!
  }
  return merged
}

/** Copia qty y reparto de Planificar a líneas de compra (sin pisar “Compré”). */
export function buildPlanPurchaseSyncPatches(db: Database, orderId: string): Patch[] {
  const patches: Patch[] = []
  const order = db.orders.find((o) => o.id === orderId)
  const skip = new Set(order?.skipPurchase || [])
  const plans = uniquePlansByProduct(db.planItems.filter((x) => x.orderId === orderId))
  const purchaseLines = db.purchaseLines.filter((l) => l.orderId === orderId)
  const queuedCreate = new Set<string>()

  for (const p of plans) {
    if (skip.has(p.productId)) continue
    const split = splitFromPlan(p)
    const hints = productBuyHints(db, p.productId)
    const existing = findPurchaseLine(purchaseLines, p.productId)
    if (!existing) {
      if (queuedCreate.has(p.productId)) continue
      queuedCreate.add(p.productId)
      patches.push({
        op: 'upsert',
        col: 'purchaseLines',
        row: {
          id: newId(),
          orderId,
          productId: p.productId,
          plannedQty: p.qty || 0,
          actualQty: 0,
          unitPrice: lastUnitPrice(db, p.productId) || 0,
          totalPrice: 0,
          totalManual: false,
          address: hints.address,
          notes: p.notes?.trim() || hints.notes,
          split,
        },
      })
      continue
    }
    const prevSplit = { ...emptyStationSplit(), ...(existing.split || {}) }
    const nextSplit = purchaseHasReparto(existing) ? prevSplit : mergeSplitFromPlan(prevSplit, split)
    const splitChanged = STATIONS.some((st) => (prevSplit[st] || 0) !== (nextSplit[st] || 0))
    const planNotes = p.notes || ''
    const syncNotes = shouldSyncNotesFromPlan(existing, planNotes)
    const plannedChanged = existing.plannedQty !== (p.qty || 0)
    if (!plannedChanged && !splitChanged && !syncNotes) continue
    patches.push({
      op: 'upsert',
      col: 'purchaseLines',
      row: {
        ...existing,
        plannedQty: p.qty || 0,
        split: nextSplit,
        ...(syncNotes ? { notes: planNotes } : {}),
      },
    })
  }
  return patches
}
