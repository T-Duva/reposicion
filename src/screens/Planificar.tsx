import { useEffect, useMemo, useState } from 'react'
import { FocusField } from '../components/FocusField'
import { DateBar } from '../components/DateBar'
import { qtyLabel } from '../lib/format'
import { newId } from '../lib/id'
import { enterTo } from '../lib/keys'
import { scrollFieldIntoView } from '../lib/scrollField'
import { emptyStationSplit, productHasCarryHistory, productMedian, productStationMedians } from '../lib/stats'
import { nameMatchesQuery } from '../lib/nameFilter'
import { setPlanSplit } from '../lib/validate'
import { userCanEditStation } from '../lib/userAccess'
import { useApp } from '../state/store'
import { STATIONS, STATION_LABEL, type PlanItem } from '../types'

export function Planificar() {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const orderId = useApp((s) => s.orderId)
  const apply = useApp((s) => s.apply)
  const [q, setQ] = useState('')
  const [pickedProductId, setPickedProductId] = useState<string | null>(null)
  const [jumpItemId, setJumpItemId] = useState<string | null>(null)

  const order = db.orders.find((o) => o.id === orderId)
  const items = db.planItems.filter((p) => p.orderId === orderId)
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        const name = db.products.find((p) => p.id === item.productId)?.name ?? ''
        return nameMatchesQuery(name, q)
      }),
    [items, db.products, q],
  )
  const matches = useMemo(() => {
    if (!q.trim()) return []
    return db.products.filter((p) => nameMatchesQuery(p.name, q)).slice(0, 12)
  }, [db.products, q])

  useEffect(() => {
    if (!jumpItemId) return
    const el = document.getElementById(`plan-item-${jumpItemId}`)
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.querySelector<HTMLInputElement>('.station-split-row input')?.focus({ preventScroll: true })
      setJumpItemId(null)
    })
  }, [jumpItemId, items])

  const pickProduct = (productId: string, name?: string) => {
    const item = items.find((i) => i.productId === productId)
    const prod = db.products.find((p) => p.id === productId)
    setQ(name ?? prod?.name ?? '')
    setPickedProductId(productId)
    if (item) setJumpItemId(item.id)
  }

  const addProduct = (name: string, existingId?: string) => {
    if (!user || !orderId) return
    const trimmed = name.trim()
    if (!trimmed) return
    let productId = existingId
    if (!productId) {
      const found = db.products.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
      if (found) productId = found.id
      else {
        productId = newId()
        apply({
          op: 'upsert',
          col: 'products',
          row: { id: productId, name: trimmed, createdBy: user, createdAt: Date.now() },
        })
      }
    }
    if (items.some((i) => i.productId === productId)) {
      pickProduct(productId!, trimmed)
      return
    }
    const row: PlanItem = {
      id: newId(),
      orderId,
      productId,
      qty: 0,
      station: null,
      split: emptyStationSplit(),
      notes: '',
    }
    apply({ op: 'upsert', col: 'planItems', row })
    pickProduct(productId!, trimmed)
  }

  if (!order) {
    return (
      <div className="page">
        <DateBar />
        <p className="empty">Poné la fecha y Enter para armar el pedido.</p>
      </div>
    )
  }

  return (
    <div className="page plan-page">
      <DateBar />
      <div className="plan-scroll" onFocusCapture={scrollFieldIntoView}>
      <FocusField id="plan-search">
        <label className="search">
          Producto · Enter agrega
          <input
            value={q}
            enterKeyHint="go"
            onChange={(e) => {
              const v = e.target.value
              setQ(v)
              if (!v.trim()) setPickedProductId(null)
            }}
            placeholder="Ej. bidón 20L"
            onKeyDown={enterTo(() => addProduct(q))}
          />
        </label>
      </FocusField>
      {matches.length > 0 && (
        <ul className="suggest">
          {matches.map((p) => (
            <li key={p.id} className="suggest-row">
              <button type="button" className="pick" onClick={() => pickProduct(p.id, p.name)}>
                {p.name}
                <small>mediana {qtyLabel(productMedian(db, p.id))}</small>
              </button>
              <button
                type="button"
                className="icon-x"
                aria-label={`Borrar ${p.name}`}
                onClick={() => apply({ op: 'remove', col: 'products', id: p.id })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 && <p className="empty">Escribí un producto y Enter.</p>}
      {items.length > 0 && q.trim() && visibleItems.length === 0 && (
        <p className="empty">Nada coincide con «{q.trim()}».</p>
      )}

      <ul className="cards">
        {visibleItems.map((item) => {
          const prod = db.products.find((p) => p.id === item.productId)
          const hasCarryHistory = productHasCarryHistory(db, item.productId)
          const genMed = hasCarryHistory ? productMedian(db, item.productId) : null
          const stMed = hasCarryHistory ? productStationMedians(db, item.productId) : null
          const split = { ...emptyStationSplit(), ...(item.split || {}) }
          const total =
            (Number(split.madro) || 0) + (Number(split.ligux) || 0) + (Number(split.elugas) || 0)
          return (
            <li
              id={`plan-item-${item.id}`}
              key={item.id}
              className={`card compact-card plan-row${pickedProductId === item.productId ? ' product-picked' : ''}`}
            >
              <button
                type="button"
                className="icon-x plan-row-x"
                onClick={() => apply({ op: 'remove', col: 'planItems', id: item.id })}
                aria-label="Sacar del pedido"
              >
                ×
              </button>
              <div className="plan-name-notes-row">
                <input
                  className="name-in plan-name-row"
                  value={prod?.name ?? ''}
                  aria-label="Nombre"
                  onChange={(e) => {
                    if (!prod) return
                    apply({ op: 'upsert', col: 'products', row: { ...prod, name: e.target.value } })
                  }}
                />
                <FocusField id={`plan-notes-${item.id}`}>
                  <input
                    className="name-in plan-notes-row"
                    value={item.notes || ''}
                    aria-label="Observaciones"
                    placeholder="Obs."
                    onChange={(e) =>
                      apply({ op: 'upsert', col: 'planItems', row: { ...item, notes: e.target.value } })
                    }
                  />
                </FocusField>
              </div>
              <div className="plan-stations-grid">
                <div className="plan-wds-row">
                  <FocusField id={`plan-qty-${item.id}`}>
                    <label className="qty-in">
                      <span>Llevo</span>
                      <input
                        className="qty-narrow"
                        inputMode="decimal"
                        readOnly
                        tabIndex={-1}
                        value={total || ''}
                      />
                    </label>
                  </FocusField>
                  <div className="station-split-row">
                    {STATIONS.map((st) => (
                      <FocusField key={st} id={`plan-split-${st}-${item.id}`}>
                        <label className={`st-in ${st}`}>
                          <span className="st-in-head">{STATION_LABEL[st]}</span>
                          <input
                            inputMode="decimal"
                            enterKeyHint="done"
                            readOnly={!user || !userCanEditStation(user, st)}
                            tabIndex={user && userCanEditStation(user, st) ? undefined : -1}
                            value={split[st] || ''}
                            onChange={(e) =>
                              apply({
                                op: 'upsert',
                                col: 'planItems',
                                row: setPlanSplit(item, st, Number(e.target.value.replace(',', '.')) || 0),
                              })
                            }
                          />
                        </label>
                      </FocusField>
                    ))}
                  </div>
                </div>
                {hasCarryHistory && stMed && (
                  <div className="plan-sueles-row" aria-label="Sueles llevar por estación">
                    <div className="plan-sueles-qty">
                      <span className="plan-sueles-label">Sueles llevar</span>
                      <span className="plan-med">{qtyLabel(genMed)}</span>
                    </div>
                    {STATIONS.map((st) => (
                      <span key={st} className={`plan-st-med ${st}`}>
                        {qtyLabel(stMed[st])}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      </div>
    </div>
  )
}
