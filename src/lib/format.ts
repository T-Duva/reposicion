import { STATIONS, STATION_LABEL, type Station } from '../types'

/** Texto seguro: datos viejos a veces traen address/notes en undefined. */
export function txt(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v)
}

export function moneyDec(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(v)
}

export function formatDateISO(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

export function toISODate(day: number, month: number, year: number): string {
  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export function parseISO(iso: string): { day: number; month: number; year: number } {
  const raw = typeof iso === 'string' ? iso : ''
  const [y, m, d] = raw.split('-').map(Number)
  return { day: d || 1, month: m || 1, year: y || new Date().getFullYear() }
}

/** True si ya pasó la hora de corte del día de la orden (18:00 local). */
export function isPastOrderCutoff(isoDate: string, hour = 18, now = new Date()): boolean {
  const { day, month, year } = parseISO(isoDate)
  const cutoff = new Date(year, month - 1, day, hour, 0, 0, 0)
  return now >= cutoff
}

export function stationName(s: Station): string {
  return STATION_LABEL[s]
}

/** Ligux Elugas Madro — mismo orden que STATIONS en toda la app. */
export function stationNamesLine(): string {
  return STATIONS.map((st) => STATION_LABEL[st]).join(' ')
}

export function qtyLabel(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(1).replace('.', ',')
}

/** Mediana de unidades — solo el número */
export function unitMedLabel(n: number | null): string {
  return qtyLabel(n)
}

/** Número escrito a mano (es-AR): 16.000 → 16000, 16,5 → 16.5 */
export function parseArNumber(v: string): number {
  const t = v.trim().replace(/[^\d,.-]/g, '')
  if (!t || t === '-' || t === '.' || t === ',') return 0
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.')) || 0
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, '')) || 0
  return Number(t) || 0
}
