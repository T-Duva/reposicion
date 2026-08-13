import { STATIONS, STATION_LABEL, type Patch, type PlanItem, type PurchaseLine } from '../types'
import { txt } from './format'
import { lineTotal, purchaseQty, splitTotal } from './stats'

function almost(a: number, b: number) {
  return Math.abs(a - b) < 0.001
}

function fmt(n: number) {
  const x = Number(n) || 0
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000)
}

const MAX_LINE_TOTAL = 99_999

/** Total de línea en compra: hasta 5 dígitos enteros. */
export function clampMoney5(n: number): number {
  const x = Number(n) || 0
  if (x <= 0) return 0
  return Math.min(x, MAX_LINE_TOTAL)
}

function splitDetail(split: { madro?: number; ligux?: number; elugas?: number }): string {
  return STATIONS.map((st) => `${STATION_LABEL[st]} ${fmt(Number(split[st]) || 0)}`).join(' + ')
}

function planSplitSum(item: PlanItem): number {
  const s = item.split || { madro: 0, ligux: 0, elugas: 0 }
  return (Number(s.madro) || 0) + (Number(s.ligux) || 0) + (Number(s.elugas) || 0)
}

export function purchaseLineError(line: PurchaseLine): string | null {
  const parts = splitTotal(line)
  const planned = Number(line.plannedQty) || 0
  const cupo = purchaseQty(line) || planned
  if (cupo <= 0) return null
  if (parts > cupo + 0.001) {
    const actual = Number(line.actualQty) || 0
    const verb = actual > 0 || parts > 0 ? 'compraste' : 'planificaste'
    return `No da: ${verb} ${fmt(cupo)} y el reparto suma ${fmt(parts)} (${splitDetail(line.split)}).`
  }
  return null
}

/** Línea de compra con reparto, precio, dirección y total cargados. */
export function purchaseLineComplete(line: PurchaseLine): boolean {
  if (line.ready === false) return false
  if (line.ready) return true
  const actual = purchaseQty(line)
  if (actual <= 0) return false
  const hint = purchaseLineHint(line)
  if (!hint || hint.kind !== 'ok') return false
  if (!(Number(line.unitPrice) > 0)) return false
  if (!txt(line.address).trim()) return false
  return lineTotal(line) > 0
}

export function purchaseLineHint(line: PurchaseLine): { kind: 'ok' | 'warn' | 'bad'; text: string } | null {
  const actual = purchaseQty(line)
  if (actual <= 0) return null
  const parts = splitTotal(line)
  if (parts > actual + 0.001) {
    return { kind: 'bad', text: purchaseLineError(line) || '' }
  }
  if (actual > 0 && parts + 0.001 < actual) {
    return { kind: 'warn', text: `Faltan ${fmt(actual - parts)} por repartir (compraste ${fmt(actual)}).` }
  }
  if (actual > 0 && almost(parts, actual)) {
    return { kind: 'ok', text: 'OK' }
  }
  return null
}

export function planItemError(item: PlanItem): string | null {
  const qty = Number(item.qty) || 0
  const parts = planSplitSum(item)
  if (parts > qty + 0.001) {
    return `No da: llevás ${fmt(qty)} y el reparto suma ${fmt(parts)} (${splitDetail(item.split || {})}).`
  }
  return null
}

export function planItemHint(item: PlanItem): { kind: 'ok' | 'warn' | 'bad'; text: string } | null {
  const qty = Number(item.qty) || 0
  const parts = planSplitSum(item)
  if (parts > qty + 0.001) {
    return { kind: 'bad', text: planItemError(item) || '' }
  }
  if (qty > 0 && parts + 0.001 < qty) {
    return { kind: 'warn', text: `Faltan ${fmt(qty - parts)} por repartir (llevás ${fmt(qty)}).` }
  }
  if (qty > 0 && almost(parts, qty)) {
    return { kind: 'ok', text: 'OK' }
  }
  return null
}

/** Al editar una estación, recalcula qty como la suma del reparto. */
export function setPlanSplit(
  item: PlanItem,
  station: 'madro' | 'ligux' | 'elugas',
  raw: number,
): PlanItem {
  const split = { madro: 0, ligux: 0, elugas: 0, ...(item.split || {}) }
  split[station] = Math.max(0, raw)
  const qty = planSplitSum({ ...item, split })
  return { ...item, station: null, split, qty }
}

/** Al editar una estación en compra, recalcula actualQty como la suma del reparto. */
export function setPurchaseSplit(
  line: PurchaseLine,
  station: 'madro' | 'ligux' | 'elugas',
  raw: number,
): PurchaseLine {
  const s = line.split
  const split = { madro: Number(s?.madro) || 0, ligux: Number(s?.ligux) || 0, elugas: Number(s?.elugas) || 0 }
  split[station] = Math.max(0, raw)
  const actualQty = splitTotal({ ...line, split })
  const totalPrice = actualQty * (line.unitPrice || 0)
  return { ...line, split, actualQty, totalPrice, totalManual: false }
}

/** Al editar un split de compra, no deja pasar del cupo (actualQty − otras estaciones). */
export function clampPurchaseSplit(
  line: PurchaseLine,
  station: 'madro' | 'ligux' | 'elugas',
  raw: number,
): NonNullable<PurchaseLine['split']> {
  const s = line.split
  const split = { madro: Number(s?.madro) || 0, ligux: Number(s?.ligux) || 0, elugas: Number(s?.elugas) || 0 }
  const others =
    (station === 'madro' ? 0 : Number(split.madro) || 0) +
    (station === 'ligux' ? 0 : Number(split.ligux) || 0) +
    (station === 'elugas' ? 0 : Number(split.elugas) || 0)
  const max = Math.max(0, (Number(line.actualQty) || 0) - others)
  split[station] = Math.min(Math.max(0, raw), max)
  return split
}

/** Si bajan “compré”, recorta el reparto para que no pase (p. ej. venía del plan). */
export function clampPurchaseQty(line: PurchaseLine, qty: number): PurchaseLine {
  const nextQty = Math.max(0, qty)
  const s = line.split
  const split = { madro: Number(s?.madro) || 0, ligux: Number(s?.ligux) || 0, elugas: Number(s?.elugas) || 0 }
  let sum = (Number(split.madro) || 0) + (Number(split.ligux) || 0) + (Number(split.elugas) || 0)
  const totalPrice = nextQty * (line.unitPrice || 0)
  if (sum <= nextQty + 0.001) return { ...line, actualQty: nextQty, totalPrice, totalManual: false }
  for (const st of [...STATIONS].reverse()) {
    if (sum <= nextQty + 0.001) break
    const over = sum - nextQty
    const cut = Math.min(Number(split[st]) || 0, over)
    split[st] = (Number(split[st]) || 0) - cut
    sum -= cut
  }
  return { ...line, actualQty: nextQty, totalPrice, split, totalManual: false }
}

/** Si bajan “cuánto llevo”, recorta el reparto para que no pase. */
export function clampPlanQty(item: PlanItem, qty: number): PlanItem {
  const nextQty = Math.max(0, qty)
  const split = { madro: 0, ligux: 0, elugas: 0, ...(item.split || {}) }
  let sum = (Number(split.madro) || 0) + (Number(split.ligux) || 0) + (Number(split.elugas) || 0)
  if (sum <= nextQty + 0.001) return { ...item, qty: nextQty, split }
  for (const st of [...STATIONS].reverse()) {
    if (sum <= nextQty + 0.001) break
    const over = sum - nextQty
    const cut = Math.min(Number(split[st]) || 0, over)
    split[st] = (Number(split[st]) || 0) - cut
    sum -= cut
  }
  return { ...item, qty: nextQty, split }
}

export function patchError(patch: Patch): string | null {
  if (patch.op === 'upsert' && patch.col === 'purchaseLines') {
    return purchaseLineError(patch.row as PurchaseLine)
  }
  if (patch.op === 'upsert' && patch.col === 'planItems') {
    return planItemError(patch.row as PlanItem)
  }
  return null
}
