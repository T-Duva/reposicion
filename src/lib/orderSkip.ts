import type { Order } from '../types'

/** Fusiona orden entrante sin perder skipPurchase ni sacados explícitos de Comprar. */
export function mergeOrderUpsert(before: Order | null | undefined, row: Order): Order {
  const merged = before ? ({ ...before, ...row } as Order) : ({ ...row } as Order)

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

export function skipPurchaseSet(order: Order | null | undefined): Set<string> {
  return new Set(order?.skipPurchase || [])
}
