import { useEffect, useMemo, useState } from 'react'
import { DateBar, todayISO } from '../components/DateBar'
import { FocusField } from '../components/FocusField'
import { ListSortToggle } from '../components/ListSortToggle'
import { formatDateISO, money, parseArNumber } from '../lib/format'
import { newId } from '../lib/id'
import { enterTo } from '../lib/keys'
import { nameMatchesQuery } from '../lib/nameFilter'
import { scrollFieldIntoView } from '../lib/scrollField'
import { buildPlanPurchaseSyncPatches, planSyncKey } from '../lib/planPurchaseSync'
import { sortByListMode, type ListSortMode } from '../lib/listSort'
import {
  refreshPurchaseLineTotal,
  repartirGuideUnitPrice,
  repartirLineUnitPrice,
  repartirLines,
  stationPaidAmount,
} from '../lib/stats'
import { useApp } from '../state/store'
import { STATIONS, STATION_LABEL, type Payment, type Station } from '../types'

export function Repartir() {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const orderId = useApp((s) => s.orderId)
  const apply = useApp((s) => s.apply)
  const goToBuyProduct = useApp((s) => s.goToBuyProduct)
  const order = db.orders.find((o) => o.id === orderId)
  const plans = db.planItems.filter((p) => p.orderId === orderId)
  const syncKey = useMemo(() => planSyncKey(plans), [plans])
  const [deliverDate, setDeliverDate] = useState(() => order?.distributeDate || order?.date || '')
  const [payDate, setPayDate] = useState(() => todayISO())
  const [payAmt, setPayAmt] = useState('')
  const [editPayId, setEditPayId] = useState<string | null>(null)
  const [sortModes, setSortModes] = useState<Record<Station, ListSortMode>>({
    madro: 'az',
    ligux: 'az',
    elugas: 'az',
  })
  const [guideEdits, setGuideEdits] = useState<Record<string, number>>(() => loadSplitGuide(orderId || ''))
  const [checkEdits, setCheckEdits] = useState<Record<string, boolean>>(() => loadSplitCheck(orderId || ''))
  const [searchQ, setSearchQ] = useState('')
  const [editGuideKey, setEditGuideKey] = useState<string | null>(null)

  useEffect(() => {
    setGuideEdits(loadSplitGuide(orderId || ''))
    setCheckEdits(loadSplitCheck(orderId || ''))
    setEditGuideKey(null)
    setSearchQ('')
  }, [orderId])

  useEffect(() => {
    if (!order) return
    setDeliverDate(order.distributeDate || order.date || '')
    setPayDate(todayISO())
  }, [orderId, order?.distributeDate, order?.date])

  useEffect(() => {
    if (!orderId || !user) return
    for (const patch of buildPlanPurchaseSyncPatches(useApp.getState().db, orderId)) {
      apply(patch)
    }
  }, [orderId, user, syncKey, apply])

  const purchaseLines = db.purchaseLines.filter((l) => l.orderId === orderId)
  useEffect(() => {
    if (!orderId || !user) return
    for (const line of purchaseLines) {
      const fixed = refreshPurchaseLineTotal(line)
      if (fixed) apply({ op: 'upsert', col: 'purchaseLines', row: fixed })
    }
  }, [orderId, user, purchaseLines, apply])

  if (!order) {
    return (
      <div className="page split-page">
        <DateBar />
        <p className="empty">Poné la fecha y Enter para la repartición.</p>
      </div>
    )
  }

  const repartir = repartirLines(db, order.id)
  const payments = db.payments.filter((p) => p.orderId === order.id)
  const showPlanHint = repartir.some((l) => l.fromPlan)

  const addPay = (station: Station) => {
    if (!user) return
    const amount = parseAmt(payAmt)
    if (amount <= 0 || !payDate) return
    const row: Payment = {
      id: newId(),
      station,
      date: payDate,
      amount,
      orderId: order.id,
      createdBy: user,
      createdAt: Date.now(),
    }
    apply({ op: 'upsert', col: 'payments', row })
    if (order.status !== 'repartiendo') {
      apply({ op: 'upsert', col: 'orders', row: { ...order, status: 'repartiendo' } })
    }
    setPayAmt('')
  }

  return (
    <div className="page split-page">
      <div className="split-scroll" onFocusCapture={scrollFieldIntoView}>
      <DateBar />
      <header className="page-head">
        <h1>Repartir</h1>
      </header>
      <p className="hint">
        Resumen de lo comprado el {formatDateISO(order.date)}.
        {showPlanHint ? ' Mostrando reparto planificado hasta que cargues Compré.' : ''} En Madro, monto + Enter carga el pago. × borra.
      </p>

      <FocusField id={`split-search-${order.id}`}>
        <label className="search split-search">
          Buscar producto
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Nombre…"
          />
        </label>
      </FocusField>

      {STATIONS.map((st) => {
        const items = sortByListMode(
          mergeSplitItems(
            repartir
              .filter((l) => (l.split[st] || 0) > 0)
              .map((l) => {
                const unitPrice = repartirLineUnitPrice(db, l)
                const guideKey = l.productId
                return {
                  key: guideKey,
                  name: db.products.find((p) => p.id === l.productId)?.name ?? 'Producto',
                  qty: l.split[st],
                  unitPrice,
                  guidePrice: guideEdits[guideKey] ?? repartirGuideUnitPrice(unitPrice),
                }
              }),
          ),
          sortModes[st],
          (it) => it.name,
          (it) => it.unitPrice,
        )
        const spent = items.reduce((s, it) => s + (it.qty || 0) * (it.guidePrice || 0), 0)
        const paid = stationPaidAmount(st, spent, payments)
        return (
          <section key={st} className={`station-block ${st}`}>
            <div className="station-head">
              <h2>{STATION_LABEL[st]}</h2>
              {items.length > 0 && (
                <ListSortToggle
                  mode={sortModes[st]}
                  onChange={(mode) => setSortModes((m) => ({ ...m, [st]: mode }))}
                />
              )}
            </div>
            {items.length === 0 ? (
              <p className="muted split-empty">Nada asignado en esta compra.</p>
            ) : (
              <ul className="split-items">
                {items.map((it) => {
                  const checkKey = splitCheckKey(st, it.key)
                  const checked = !!checkEdits[checkKey]
                  const hit = searchQ.trim() && nameMatchesQuery(it.name, searchQ)
                  return (
                  <li key={it.key} className="split-item">
                    <span className="split-qty">{it.qty}×</span>
                    <button type="button" className={`split-name-btn${hit ? ' split-name-hit' : ''}`} onClick={() => goToBuyProduct(it.key)}>
                      {it.name}
                    </button>
                    <button
                      type="button"
                      className={`split-check${checked ? ' on' : ''}`}
                      aria-label={checked ? 'Desmarcar' : 'Marcar'}
                      onClick={() => {
                        setCheckEdits((prev) => {
                          const next = { ...prev, [checkKey]: !prev[checkKey] }
                          saveSplitCheck(order.id, next)
                          return next
                        })
                      }}
                    />
                    <span className="split-unit">{it.unitPrice > 0 ? money(it.unitPrice) : '—'}</span>
                    <input
                      className="split-guide-in"
                      inputMode="decimal"
                      aria-label="Guía con recargo"
                      value={
                        editGuideKey === it.key
                          ? String(it.guidePrice || '')
                          : it.guidePrice
                            ? money(it.guidePrice)
                            : ''
                      }
                      onFocus={() => setEditGuideKey(it.key)}
                      onBlur={() => setEditGuideKey((k) => (k === it.key ? null : k))}
                      onChange={(e) => {
                        const v = parseAmt(e.target.value)
                        setGuideEdits((prev) => {
                          const next = { ...prev, [it.key]: v }
                          saveSplitGuide(order.id, next)
                          return next
                        })
                      }}
                    />
                  </li>
                  )
                })}
              </ul>
            )}
            <div className="pay-sum">
              <div>
                <span>Debe pagar</span>
                <strong>{money(spent)}</strong>
              </div>
              <div>
                <span>Pagó</span>
                <strong>{money(paid)}</strong>
              </div>
              <div className={spent - paid > 0 ? 'neg' : 'ok-txt'}>
                <span>Saldo</span>
                <strong>{money(spent - paid)}</strong>
              </div>
            </div>
            {st === 'madro' && (
              <div className="pay-form">
                <FocusField id={`deliver-date-${order.id}`}>
                  <label>
                    Fecha de entrega a Madro
                    <input
                      type="date"
                      value={deliverDate}
                      onChange={(e) => {
                        const d = e.target.value
                        setDeliverDate(d)
                        apply({
                          op: 'upsert',
                          col: 'orders',
                          row: {
                            ...order,
                            distributeDate: d,
                            status: order.status === 'comprando' ? 'repartiendo' : order.status,
                          },
                        })
                      }}
                    />
                  </label>
                </FocusField>
                <FocusField id={`pay-date-${order.id}`}>
                  <label>
                    Fecha de pago
                    <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                  </label>
                </FocusField>
                <FocusField id={`pay-amt-${order.id}`}>
                  <label>
                    Monto · Enter carga
                    <span className="money-in pay-amt-wrap">
                      <span className="money-sym" aria-hidden>
                        $
                      </span>
                      <input
                        className="pay-amt-in"
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="go"
                        placeholder="0"
                        value={payAmt}
                        onChange={(e) => setPayAmt(e.target.value)}
                        onKeyDown={enterTo(() => addPay('madro'))}
                      />
                    </span>
                  </label>
                </FocusField>
              </div>
            )}
            {st === 'madro' &&
              payments
                .filter((p) => p.station === st)
                .map((p) => (
                <div key={p.id} className="pay-log">
                  <span>{formatDateISO(p.date)}</span>
                  <input
                    className="pay-amt-in pay-amt-log"
                    inputMode="decimal"
                    value={editPayId === p.id ? String(p.amount || '') : p.amount ? money(p.amount) : ''}
                    aria-label="Monto pago"
                    onFocus={() => setEditPayId(p.id)}
                    onBlur={() => setEditPayId((id) => (id === p.id ? null : id))}
                    onChange={(e) =>
                      apply({
                        op: 'upsert',
                        col: 'payments',
                        row: { ...p, amount: parseAmt(e.target.value) },
                      })
                    }
                  />
                  <button type="button" className="icon-x" aria-label="Borrar pago" onClick={() => apply({ op: 'remove', col: 'payments', id: p.id })}>
                    ×
                  </button>
                </div>
              ))}
          </section>
        )
      })}
      </div>
    </div>
  )
}

function parseAmt(v: string) {
  return parseArNumber(v)
}

type SplitItem = {
  key: string
  name: string
  qty: number
  unitPrice: number
  guidePrice: number
}

/** Un producto = una fila por estación (clones de compra cuentan como el mismo artículo). */
function mergeSplitItems(items: SplitItem[]): SplitItem[] {
  const byKey = new Map<string, SplitItem>()
  for (const it of items) {
    const prev = byKey.get(it.key)
    if (!prev) {
      byKey.set(it.key, it)
      continue
    }
    const qty = (prev.qty || 0) + (it.qty || 0)
    const unitPrice =
      prev.unitPrice > 0 && it.unitPrice > 0
        ? ((prev.unitPrice * (prev.qty || 0) + it.unitPrice * (it.qty || 0)) / qty)
        : prev.unitPrice || it.unitPrice
    byKey.set(it.key, {
      ...prev,
      qty,
      unitPrice,
      guidePrice: prev.guidePrice || it.guidePrice,
    })
  }
  return [...byKey.values()]
}

const SPLIT_GUIDE_KEY = 'reposicion.splitGuide'
const SPLIT_CHECK_KEY = 'reposicion.splitCheck'

function splitCheckKey(st: Station, productId: string) {
  return `${st}:${productId}`
}

function loadSplitGuide(orderId: string): Record<string, number> {
  if (!orderId) return {}
  try {
    const raw = localStorage.getItem(SPLIT_GUIDE_KEY)
    if (!raw) return {}
    const all = JSON.parse(raw) as Record<string, Record<string, number>>
    return all[orderId] || {}
  } catch {
    return {}
  }
}

function saveSplitGuide(orderId: string, guides: Record<string, number>) {
  try {
    const raw = localStorage.getItem(SPLIT_GUIDE_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, number>>) : {}
    all[orderId] = guides
    localStorage.setItem(SPLIT_GUIDE_KEY, JSON.stringify(all))
  } catch {
    /* quota */
  }
}

function loadSplitCheck(orderId: string): Record<string, boolean> {
  if (!orderId) return {}
  try {
    const raw = localStorage.getItem(SPLIT_CHECK_KEY)
    if (!raw) return {}
    const all = JSON.parse(raw) as Record<string, Record<string, boolean>>
    return all[orderId] || {}
  } catch {
    return {}
  }
}

function saveSplitCheck(orderId: string, checks: Record<string, boolean>) {
  try {
    const raw = localStorage.getItem(SPLIT_CHECK_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, boolean>>) : {}
    all[orderId] = checks
    localStorage.setItem(SPLIT_CHECK_KEY, JSON.stringify(all))
  } catch {
    /* quota */
  }
}
