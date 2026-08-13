import { txt } from './format'
import type { Database, Product, PurchaseLine } from '../types'

type ProductApply = (patch: { op: 'upsert'; col: 'products'; row: Product }) => void

export function productBuyHints(db: Database, productId: string) {
  const p = db.products.find((x) => x.id === productId)
  return { address: p?.address?.trim() ?? '', notes: p?.notes?.trim() ?? '' }
}

/** Guarda dir./obs. en el catálogo para reutilizar después de sacar de compras. */
export function saveProductBuyHints(
  apply: ProductApply,
  prod: Product | undefined,
  part: { address?: string; notes?: string },
) {
  if (!prod) return
  const address = part.address !== undefined ? part.address : prod.address ?? ''
  const notes = part.notes !== undefined ? part.notes : prod.notes ?? ''
  if (address === (prod.address ?? '') && notes === (prod.notes ?? '')) return
  apply({ op: 'upsert', col: 'products', row: { ...prod, address, notes } })
}

export function stashProductBuyHintsFromLines(
  apply: ProductApply,
  db: Database,
  productId: string,
  lineList: PurchaseLine[],
) {
  const prod = db.products.find((p) => p.id === productId)
  if (!prod) return
  const addrLine = lineList.find((l) => txt(l.address).trim())
  const notesLine = lineList.find((l) => txt(l.notes).trim())
  saveProductBuyHints(apply, prod, {
    ...(addrLine ? { address: addrLine.address } : {}),
    ...(notesLine ? { notes: notesLine.notes } : {}),
  })
}
