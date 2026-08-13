import { useMemo, useState } from 'react'
import { DateBar } from '../components/DateBar'
import { FocusField } from '../components/FocusField'
import { ListSortToggle } from '../components/ListSortToggle'
import { money, parseArNumber, qtyLabel } from '../lib/format'
import { newId } from '../lib/id'
import { sortByListMode, type ListSortMode } from '../lib/listSort'
import { discountedAmount, orderPlaceLines, orderPlaces } from '../lib/placeDiscount'
import { lineTotal, purchaseQty } from '../lib/stats'
import { useApp } from '../state/store'

export function Descuentos() {
  const db = useApp((s) => s.db)
  const orderId = useApp((s) => s.orderId)
  const apply = useApp((s) => s.apply)
  const goToBuyLine = useApp((s) => s.goToBuyLine)
  const order = db.orders.find((o) => o.id === orderId)
  const [q, setQ] = useState('')
  const [sortMode, setSortMode] = useState<ListSortMode>('az')
  const [editKey, setEditKey] = useState<string | null>(null)
  const [draftPct, setDraftPct] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const places = useMemo(() => {
    if (!orderId) return []
    return sortByListMode(orderPlaces(db, orderId, q), sortMode, (p) => p.name, (p) => p.total)
  }, [db, orderId, q, sortMode])

  const savePercent = (key: string, raw: string) => {
    if (!orderId) return
    const percent = Math.min(100, Math.max(0, parseArNumber(raw.trim())))
    const existing = (db.placeDiscounts || []).find((d) => d.orderId === orderId && d.place === key)
    if (percent <= 0) {
      if (existing) apply({ op: 'remove', col: 'placeDiscounts', id: existing.id })
      return
    }
    apply({
      op: 'upsert',
      col: 'placeDiscounts',
      row: existing
        ? { ...existing, percent }
        : { id: newId(), orderId, place: key, percent },
    })
  }

  const startEdit = (key: string, percent: number) => {
    setEditKey(key)
    setDraftPct(percent > 0 ? String(percent) : '')
  }

  const commitEdit = (key: string) => {
    savePercent(key, draftPct)
    setEditKey(null)
    setDraftPct('')
  }

  if (!order) {
    return (
      <div className="page">
        <DateBar mode="select" />
        <p className="empty">Poné la fecha y Enter para ver descuentos.</p>
      </div>
    )
  }

  const gross = places.reduce((s, p) => s + p.total, 0)
  const net = places.reduce((s, p) => s + discountedAmount(p.total, p.percent), 0)

  return (
    <div className="page discounts-page">
      <DateBar mode="select" />
      <div className="buy-filter-row">
        <FocusField id="discount-filter">
          <label className="search">
            Filtro
            <input
              list="discount-place-suggest"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Obs.…"
            />
          </label>
        </FocusField>
        {places.length > 0 && <ListSortToggle mode={sortMode} onChange={setSortMode} />}
      </div>

      <datalist id="discount-place-suggest">
        {orderPlaces(db, order.id).map((p) => (
          <option key={p.key} value={p.name} />
        ))}
      </datalist>

      {places.length === 0 && (
        <p className="empty">
          {q.trim() ? 'Nada coincide con el filtro.' : 'No hay lugares con compras en esta fecha.'}
        </p>
      )}

      {places.length > 0 && (
        <ul className="cards discount-list">
          {places.map((p) => (
            <li key={p.key} className={`card compact-card discount-row${expandedKey === p.key ? ' open' : ''}`}>
              <div className="discount-main">
                <button
                  type="button"
                  className="discount-name-btn"
                  aria-expanded={expandedKey === p.key}
                  onClick={() => setExpandedKey((cur) => (cur === p.key ? null : p.key))}
                >
                  {p.name}
                </button>
                <span className="discount-total">{money(discountedAmount(p.total, p.percent))}</span>
              </div>
              {expandedKey === p.key && (
                <ul className="discount-detail mini-list">
                  {orderPlaceLines(db, order.id, p.key).map((line) => {
                    const prodName = db.products.find((x) => x.id === line.productId)?.name ?? 'Producto'
                    return (
                      <li key={line.id}>
                        <button type="button" className="discount-line-btn" onClick={() => goToBuyLine(line.id)}>
                          <span>
                            {qtyLabel(purchaseQty(line))} × {prodName}
                          </span>
                          <span>{money(lineTotal(line))}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="discount-edit">
                {editKey === p.key ? (
                  <>
                    <input
                      className="discount-pct-in"
                      inputMode="decimal"
                      autoFocus
                      value={draftPct}
                      placeholder="%"
                      onChange={(e) => setDraftPct(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEdit(p.key)
                        }
                      }}
                      onBlur={() => commitEdit(p.key)}
                    />
                    <span className="muted">%</span>
                  </>
                ) : (
                  <button type="button" className="btn ghost discount-pct-btn" onClick={() => startEdit(p.key, p.percent)}>
                    {p.percent > 0 ? `${p.percent}%` : 'Desc.'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {places.length > 0 && (
        <div className="totals-dock">
          <div>
            <span>Total bruto</span>
            <strong>{money(gross)}</strong>
          </div>
          <div>
            <span>Con descuentos</span>
            <strong>{money(net)}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
