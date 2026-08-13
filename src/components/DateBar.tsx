import { useEffect, useState, type ReactNode } from 'react'
import { formatDateISO, parseISO, toISODate } from '../lib/format'
import { newId } from '../lib/id'
import { enterTo } from '../lib/keys'
import { useApp } from '../state/store'
import type { Order, UserId } from '../types'

/** select = solo busca/abre existentes. create = puede crear si no hay. */
export function DateBar({ extra, mode = 'create' }: { extra?: ReactNode; mode?: 'select' | 'create' }) {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const orderId = useApp((s) => s.orderId)
  const setOrderId = useApp((s) => s.setOrderId)
  const apply = useApp((s) => s.apply)
  const order = db.orders.find((o) => o.id === orderId)
  const orderDate = typeof order?.date === 'string' ? order.date : ''
  const parsed = parseISO(orderDate || todayISO())
  const [day, setDay] = useState(String(parsed.day))
  const [month, setMonth] = useState(String(parsed.month))
  const [year, setYear] = useState(parsed.year)

  useEffect(() => {
    const p = parseISO(orderDate || todayISO())
    setDay(String(p.day))
    setMonth(String(p.month))
    setYear(p.year)
  }, [orderId, orderDate])

  const commit = () => {
    const d = clamp(Number(day), 1, 31)
    const m = clamp(Number(month), 1, 12)
    const y = year || new Date().getFullYear()
    const iso = toISODate(d, m, y)
    if (!user) return
    const existing = db.orders.find((o) => o.date === iso)
    if (existing) {
      setOrderId(existing.id)
      return
    }
    if (mode === 'select') {
      useApp.setState({ toast: 'Esa fecha no existe. En Órdenes no se crean órdenes.' })
      return
    }
    ensureOrder(db.orders, iso, user, apply, setOrderId)
  }

  return (
    <div className="datebar">
      <label className="date-edit">
        <span>{mode === 'select' ? 'Fecha · Enter busca' : 'Fecha · Enter abre'}</span>
        <span className="date-inputs">
          <input
            inputMode="numeric"
            enterKeyHint="next"
            value={day}
            onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={enterTo(commit)}
          />
          <span>/</span>
          <input
            inputMode="numeric"
            enterKeyHint="next"
            value={month}
            onChange={(e) => setMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={enterTo(commit)}
          />
          <span>/</span>
          <input
            className="year-in"
            inputMode="numeric"
            enterKeyHint="go"
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || new Date().getFullYear())}
            onKeyDown={enterTo(commit)}
          />
        </span>
      </label>
      {mode === 'select' ? (
        <div className="date-today">
          <strong>HOY</strong>
          <span>{formatDateISO(todayISO())}</span>
        </div>
      ) : (
        order && order.date === todayISO() && (
          <span className="date-preview">{formatDateISO(order.date)}</span>
        )
      )}
      {extra}
    </div>
  )
}

export function ensureOrder(
  orders: Order[],
  iso: string,
  user: UserId,
  apply: (p: { op: 'upsert'; col: 'orders'; row: Order }) => void,
  setOrderId: (id: string) => void,
): Order {
  const existing = orders.find((o) => o.date === iso)
  if (existing) {
    setOrderId(existing.id)
    return existing
  }
  const created = makeOrder(iso, user)
  apply({ op: 'upsert', col: 'orders', row: created })
  setOrderId(created.id)
  return created
}

export function todayISO(): string {
  const n = new Date()
  const dd = String(n.getDate()).padStart(2, '0')
  const mm = String(n.getMonth() + 1).padStart(2, '0')
  return `${n.getFullYear()}-${mm}-${dd}`
}

export function makeOrder(iso: string, user: UserId): Order {
  return {
    id: newId(),
    date: iso,
    budget: 0,
    status: 'planificando',
    createdBy: user,
    createdAt: Date.now(),
  }
}

function clamp(n: number, a: number, b: number) {
  if (!Number.isFinite(n)) return a
  return Math.min(b, Math.max(a, n))
}
