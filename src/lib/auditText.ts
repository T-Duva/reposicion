import { formatDateISO, money, qtyLabel, stationName } from './format'
import { STATION_LABEL, type AuditEntry, type Database, type OrderStatus, type Station } from '../types'

const STATUS_LABEL: Record<OrderStatus, string> = {
  planificando: 'planificando',
  comprando: 'comprando',
  repartiendo: 'repartiendo',
}

const COL_LABEL: Record<string, string> = {
  orders: 'una orden',
  products: 'un producto',
  planItems: 'un ítem del plan',
  purchaseLines: 'una línea de compra',
  placeDiscounts: 'un descuento por lugar',
  payments: 'un pago',
}

const FIELD_LABEL: Record<string, Record<string, string>> = {
  orders: {
    budget: 'el presupuesto',
    date: 'la fecha de la orden',
    status: 'el estado de la orden',
    distributeDate: 'la fecha de entrega a Madro',
  },
  products: { name: 'el nombre del producto', address: 'la dirección guardada', notes: 'las observaciones guardadas' },
  planItems: { qty: 'la cantidad planificada', split: 'el reparto planificado', notes: 'las observaciones' },
  purchaseLines: {
    actualQty: 'la cantidad comprada',
    plannedQty: 'la cantidad planificada',
    unitPrice: 'el precio unitario',
    totalPrice: 'el total de compra',
    split: 'el reparto',
    address: 'el lugar de compra',
    notes: 'las observaciones de compra',
    ready: 'marcado listo',
    totalManual: 'total manual',
  },
  placeDiscounts: { percent: 'el % de descuento', place: 'el lugar' },
  payments: { amount: 'el monto', date: 'la fecha', station: 'la estación' },
}

const GENERIC_FIELD: Record<string, string> = {
  percent: 'el %',
  place: 'el lugar',
  ready: 'listo',
  totalManual: 'total manual',
  station: 'la estación',
  amount: 'el monto',
  date: 'la fecha',
  skipPurchase: 'productos omitidos',
}

const TEXT_FIELDS = new Set(['notes', 'address', 'place', 'name'])

function labelField(col: string, field: string): string {
  return FIELD_LABEL[col]?.[field] ?? GENERIC_FIELD[field] ?? `«${field}»`
}

function fmtText(v: unknown): string {
  const s = String(v ?? '').trim()
  return s ? `«${s}»` : 'vacío'
}

function describeTextChange(
  what: string,
  subject: string,
  ctx: string,
  before: unknown,
  after: unknown,
): string {
  const prev = String(before ?? '').trim()
  const next = String(after ?? '').trim()
  if (!prev && next) return `puso ${what}${subject}${ctx}: ${fmtText(next)}`
  if (prev && !next) return `borró ${what}${subject}${ctx} (antes ${fmtText(prev)})`
  return `cambió ${what}${subject}${ctx}: de ${fmtText(prev)} a ${fmtText(next)}`
}

function productName(db: Database, id?: string | null): string {
  if (!id) return 'un producto'
  return db.products.find((p) => p.id === id)?.name ?? 'un producto'
}

function orderCtx(db: Database, orderId?: string): string {
  if (!orderId) return ''
  const o = db.orders.find((x) => x.id === orderId)
  return o ? ` (${formatDateISO(o.date)})` : ''
}

function productIdForRow(db: Database, a: AuditEntry, col: string): string | undefined {
  if (a.productId) return a.productId
  if (col === 'purchaseLines' && a.rowId) {
    const line = db.purchaseLines.find((x) => x.id === a.rowId)
    if (line?.productId) return line.productId
  }
  if (col === 'planItems' && a.rowId) {
    const item = db.planItems.find((x) => x.id === a.rowId)
    if (item?.productId) return item.productId
  }
  const row = a.before as { productId?: string } | null
  if (row && typeof row === 'object' && row.productId) return row.productId
  return undefined
}

function inferPurchaseLineProductName(db: Database, a: AuditEntry, field: string): string | undefined {
  if (!a.orderId) return undefined
  const lines = db.purchaseLines.filter((l) => l.orderId === a.orderId)
  if (!lines.length) return undefined
  const after = Number(a.after)
  const before = Number(a.before)
  if (field === 'unitPrice' && Number.isFinite(after) && after > 0) {
    const hits = lines.filter((l) => l.unitPrice === after)
    if (hits.length === 1) return productName(db, hits[0].productId)
  }
  if (field === 'totalPrice' && Number.isFinite(after) && after > 0) {
    const hits = lines.filter((l) => l.totalPrice === after)
    if (hits.length === 1) return productName(db, hits[0].productId)
  }
  if (Number.isFinite(before) && before > 0) {
    const hits = lines.filter((l) => l.unitPrice === before || l.totalPrice === before)
    if (hits.length === 1) return productName(db, hits[0].productId)
  }
  return undefined
}

function productLabel(db: Database, a: AuditEntry, productId?: string | null): string {
  if (a.productName) return a.productName
  return productName(db, productId ?? a.productId)
}

function rowSubject(db: Database, col: string, a: AuditEntry, field: string): string {
  if (col === 'purchaseLines' || col === 'planItems') {
    const name =
      a.productName ||
      (() => {
        const productId = productIdForRow(db, a, col)
        return productId ? productName(db, productId) : undefined
      })() ||
      (col === 'purchaseLines' ? inferPurchaseLineProductName(db, a, field) : undefined)
    if (name) return ` de ${name}`
  }
  if (col === 'placeDiscounts') {
    const d = (db.placeDiscounts || []).find((x) => x.id === a.rowId)
    return d?.place ? ` en ${d.place}` : ''
  }
  if (col === 'products') {
    const p = db.products.find((x) => x.id === a.rowId)
    if (p?.name) return ` de «${p.name}»`
    if (a.productName) return ` de «${a.productName}»`
  }
  return ''
}

function fmtVal(field: string, v: unknown, db: Database): string {
  if (v === null || v === undefined) return '—'
  if (TEXT_FIELDS.has(field)) return fmtText(v)
  if (v === '') return 'vacío'
  if (field === 'budget' || field === 'amount' || field === 'unitPrice' || field === 'totalPrice') {
    return money(Number(v) || 0)
  }
  if (field === 'percent') return `${Number(v) || 0}%`
  if (field === 'date' || field === 'distributeDate') return formatDateISO(String(v))
  if (field === 'status') return STATUS_LABEL[v as OrderStatus] ?? String(v)
  if (field === 'station') return STATION_LABEL[v as Station] ?? String(v)
  if (field === 'qty' || field === 'plannedQty' || field === 'actualQty') return qtyLabel(Number(v))
  if (field === 'split' && typeof v === 'object' && v) {
    const parts = Object.entries(v as Record<Station, number>)
      .filter(([, n]) => Number(n) > 0)
      .map(([st, n]) => `${stationName(st as Station)} ${qtyLabel(Number(n))}`)
    return parts.length ? parts.join(', ') : 'vacío'
  }
  if (field === 'productId') return productName(db, String(v))
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (Array.isArray(v)) {
    if (field === 'skipPurchase') {
      const ids = v as string[]
      return ids.length ? ids.map((id) => productName(db, id)).join(', ') : 'ninguno'
    }
    return v.length ? `${v.length} ítems` : 'ninguno'
  }
  if (typeof v === 'object') return '…'
  return String(v)
}

export function describeAudit(a: AuditEntry, db: Database): string {
  const [col, field] = a.field.split('.')
  const orderKey = a.orderId ?? (col === 'orders' ? a.rowId : undefined)
  const ctx = orderCtx(db, orderKey)

  if (col === 'reports' && field === 'create') {
    const text = String(a.after || '').trim()
    const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text
    return preview ? `mandó un reporte: «${preview}»${ctx}` : `mandó un reporte${ctx}`
  }

  if (col === 'orders' && field === 'skipPurchase') {
    const prev = Array.isArray(a.before) ? (a.before as string[]) : []
    const next = Array.isArray(a.after) ? (a.after as string[]) : []
    const added = next.filter((id) => !prev.includes(id))
    const removed = prev.filter((id) => !next.includes(id))
    if (added.length === 1) return `sacó ${productName(db, added[0])} de la compra${ctx}`
    if (removed.length === 1) return `volvió a poner ${productName(db, removed[0])} en la compra${ctx}`
    if (added.length) {
      const names = added.map((id) => productName(db, id)).join(', ')
      return `sacó de la compra: ${names}${ctx}`
    }
    if (removed.length) {
      const names = removed.map((id) => productName(db, id)).join(', ')
      return `volvió a agregar a la compra: ${names}${ctx}`
    }
    return `actualizó productos omitidos${ctx}`
  }

  if (col === 'notifications' && field === 'read') {
    const n = db.notifications.find((x) => x.id === a.rowId)
    return n?.title ? `leyó «${n.title}»` : 'leyó una notificación'
  }

  if (field === 'create') {
    switch (col) {
      case 'orders': {
        const o = db.orders.find((x) => x.id === a.after)
        return o ? `creó la orden del ${formatDateISO(o.date)}` : 'creó una orden'
      }
      case 'products':
        return `agregó el producto «${a.after}»`
      case 'planItems': {
        const item = db.planItems.find((x) => x.id === a.after)
        return `planificó ${productName(db, item?.productId ?? a.productId)}${ctx}`
      }
      case 'purchaseLines': {
        const line = db.purchaseLines.find((x) => x.id === a.after)
        return `agregó ${a.productName ?? productName(db, line?.productId ?? a.productId)} a la compra${ctx}`
      }
      case 'payments': {
        const p = db.payments.find((x) => x.id === a.after)
        if (p) return `registró un pago de ${money(p.amount)} en ${stationName(p.station)}${ctx}`
        return `registró un pago${ctx}`
      }
      default:
        return `agregó ${COL_LABEL[col] ?? 'algo'}`
    }
  }

  if (field === 'delete') {
    const row = a.before as Record<string, unknown> | null
    switch (col) {
      case 'orders':
        return row?.date ? `borró la orden del ${formatDateISO(String(row.date))}` : 'borró una orden'
      case 'products': {
        const name = (row?.name as string | undefined) ?? a.productName
        return name ? `borró el producto «${name}»` : 'borró un producto'
      }
      case 'planItems': {
        const productId = String(row?.productId ?? a.productId ?? '')
        return `sacó ${productLabel(db, a, productId)} del plan${ctx}`
      }
      case 'purchaseLines': {
        const productId =
          (row?.productId as string | undefined) ??
          a.productId ??
          db.purchaseLines.find((x) => x.id === a.rowId)?.productId
        return `sacó ${productLabel(db, a, productId)} de la compra${ctx}`
      }
      case 'payments':
        return row
          ? `borró un pago de ${money(Number(row.amount) || 0)} en ${stationName(row.station as Station)}${ctx}`
          : `borró un pago${ctx}`
      default:
        return `borró ${COL_LABEL[col] ?? 'algo'}`
    }
  }

  if (col === 'orders' && field === 'status') {
    return `pasó la orden${ctx} de ${fmtVal(field, a.before, db)} a ${fmtVal(field, a.after, db)}`
  }

  if (col === 'products' && field === 'name') {
    return describeTextChange('el nombre del producto', '', ctx, a.before, a.after)
  }

  if (TEXT_FIELDS.has(field)) {
    const what = labelField(col, field)
    const subject = rowSubject(db, col, a, field)
    return describeTextChange(what, subject, ctx, a.before, a.after)
  }

  if (col === 'purchaseLines' && field === 'ready') {
    const subject = rowSubject(db, col, a, field)
    return a.after ? `marcó como listo${subject}${ctx}` : `desmarcó listo${subject}${ctx}`
  }

  if (col === 'purchaseLines' && field === 'totalManual') {
    const subject = rowSubject(db, col, a, field)
    return a.after
      ? `activó total manual${subject}${ctx}`
      : `volvió a total automático${subject}${ctx}`
  }

  if (col === 'placeDiscounts' && field === 'percent') {
    const subject = rowSubject(db, col, a, field)
    const before = fmtVal(field, a.before, db)
    const after = fmtVal(field, a.after, db)
    return `cambió el descuento${subject}${ctx}: de ${before} a ${after}`
  }

  const what = labelField(col, field)
  const subject = rowSubject(db, col, a, field)
  const before = fmtVal(field, a.before, db)
  const after = fmtVal(field, a.after, db)
  return `cambió ${what}${subject}${ctx}: de ${before} a ${after}`
}
