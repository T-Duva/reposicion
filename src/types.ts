export type UserId = 'tomas' | 'martin'
export type Station = 'madro' | 'ligux' | 'elugas'
export type Screen = 'home' | 'plan' | 'buy' | 'discounts' | 'split' | 'accounts' | 'audit'
export type OrderStatus = 'planificando' | 'comprando' | 'repartiendo'
export type WatcherStatus = 'online' | 'pending' | 'working' | 'stuck' | 'off'

export const STATIONS: Station[] = ['ligux', 'elugas', 'madro']

export const STATION_LABEL: Record<Station, string> = {
  madro: 'Madro',
  ligux: 'Ligux',
  elugas: 'Elugas',
}

export const USER_LABEL: Record<UserId, string> = {
  tomas: 'Tomás',
  martin: 'Martín',
}

export interface Product {
  id: string
  name: string
  createdBy: UserId
  createdAt: number
  /** Última dirección usada en Comprar (queda en catálogo al sacar del pedido). */
  address?: string
  /** Últimas observaciones usadas en Comprar (queda en catálogo al sacar del pedido). */
  notes?: string
}

export interface Order {
  id: string
  date: string
  budget: number
  status: OrderStatus
  createdBy: UserId
  createdAt: number
  distributeDate?: string
  /** Productos que el usuario sacó de Comprar (no re-sincronizar desde Planificar). */
  skipPurchase?: string[]
}

export interface PlanItem {
  id: string
  orderId: string
  productId: string
  qty: number
  /** @deprecated prefer split — qty total no es “para una sola estación” */
  station: Station | null
  /** Reparto planificado por estación (3ª fila). Suma puede ser 0 hasta repartir. */
  split?: Record<Station, number>
  notes?: string
}

export interface PurchaseLine {
  id: string
  orderId: string
  productId: string
  plannedQty: number
  actualQty: number
  unitPrice: number
  totalPrice: number
  totalManual: boolean
  address: string
  notes: string
  split: Record<Station, number>
  /** Línea clonada en Comprar (mismo producto, otro lugar/precio). */
  cloneOf?: string
  /** Marcada a mano como lista en Comprar (cuadradito bajo Madro). */
  ready?: boolean
}

/** Descuento % sobre el total gastado en un lugar (dir./obs.) de una orden. */
export interface PlaceDiscount {
  id: string
  orderId: string
  /** Clave normalizada (minúsculas, sin espacios extra). */
  place: string
  percent: number
}

export interface Payment {
  id: string
  station: Station
  date: string
  amount: number
  orderId?: string
  createdBy: UserId
  createdAt: number
}

export interface AuditEntry {
  id: string
  user: UserId
  at: number
  orderId?: string
  rowId?: string
  productId?: string
  productName?: string
  field: string
  before: unknown
  after: unknown
}

export interface Report {
  id: string
  user: UserId
  text: string
  screen: Screen
  orderId?: string
  version: string
  at: number
  status: 'nuevo' | 'notificado' | 'hecho' | 'error'
  note?: string
  photos?: string[]
}

export interface Presence {
  user: UserId
  screen: Screen
  orderId?: string
  fieldId?: string | null
  updatedAt: number
}

export interface WatcherState {
  status: WatcherStatus
  lastSeenAt: number
  currentReportId?: string
  error?: string
  pendingCount?: number
}

export interface NotificationItem {
  id: string
  to: UserId
  title: string
  body: string
  at: number
  read: boolean
}

export interface Database {
  products: Product[]
  orders: Order[]
  planItems: PlanItem[]
  purchaseLines: PurchaseLine[]
  placeDiscounts: PlaceDiscount[]
  payments: Payment[]
  audit: AuditEntry[]
  reports: Report[]
  notifications: NotificationItem[]
}

export function emptyDb(): Database {
  return {
    products: [],
    orders: [],
    planItems: [],
    purchaseLines: [],
    placeDiscounts: [],
    payments: [],
    audit: [],
    reports: [],
    notifications: [],
  }
}

export type Patch =
  | { op: 'upsert'; col: keyof Database; row: Database[keyof Database][number] }
  | { op: 'remove'; col: keyof Database; id: string }
  | { op: 'replace'; db: Database }
