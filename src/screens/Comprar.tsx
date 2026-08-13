import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DateBar } from '../components/DateBar'
import { FocusField } from '../components/FocusField'
import { ListSortToggle } from '../components/ListSortToggle'
import { money, parseArNumber, qtyLabel, txt } from '../lib/format'
import { newId } from '../lib/id'
import { enterTo } from '../lib/keys'
import { scrollElementToCenter, scrollFieldIntoView } from '../lib/scrollField'
import { buildPlanPurchaseSyncPatches, planSyncKey, splitFromPlan } from '../lib/planPurchaseSync'
import {
  emptyStationSplit,
  lastUnitPrice,
  lineTotal,
  orderSpent,
  purchaseQty,
  refreshPurchaseLineTotal,
  splitTotal,
} from '../lib/stats'
import { geolocateAddress } from '../lib/geolocateAddress'
import { normalizePurchaseLine } from '../lib/localDb'
import { sortByListMode, type ListSortMode } from '../lib/listSort'
import { skipPurchaseSet } from '../lib/orderSkip'
import { nameMatchesQuery, unitPriceMatchesQuery } from '../lib/nameFilter'
import { productBuyHints, saveProductBuyHints, stashProductBuyHintsFromLines } from '../lib/productBuyHints'
import { purchaseLineComplete, purchaseLineHint, setPurchaseSplit } from '../lib/validate'
import { useApp } from '../state/store'
import { STATIONS, STATION_LABEL, type PurchaseLine, type Station } from '../types'

function lineIsComplete(line: PurchaseLine): boolean {
  try {
    return purchaseLineComplete(normalizePurchaseLine(line))
  } catch {
    return false
  }
}

export function Comprar() {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const orderId = useApp((s) => s.orderId)
  const apply = useApp((s) => s.apply)
  const applyAll = useApp((s) => s.applyAll)
  const buyJumpLineId = useApp((s) => s.buyJumpLineId)
  const buyJumpProductId = useApp((s) => s.buyJumpProductId)
  const [q, setQ] = useState('')
  const [detailQ, setDetailQ] = useState('')
  const [filterTick, setFilterTick] = useState(0)
  const [detailFilterTick, setDetailFilterTick] = useState(0)
  const filterSnapshotRef = useRef<Set<string> | null>(null)
  const detailFilterSnapshotRef = useRef<Set<string> | null>(null)
  const [locatingId, setLocatingId] = useState<string | null>(null)
  const [jumpLineId, setJumpLineId] = useState<string | null>(null)
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null)
  const [nameEditLineId, setNameEditLineId] = useState<string | null>(null)
  const nameEditPinRef = useRef<string | null>(null)
  const splitEditPinRef = useRef<string | null>(null)
  const [pickedProductId, setPickedProductId] = useState<string | null>(null)
  const [sectionOpen, setSectionOpen] = useState({ falta: true, listo: true })
  const [sortMode, setSortMode] = useState<ListSortMode>('az')
  const handledBuyJumpRef = useRef<string | null>(null)
  const scrolledJumpRef = useRef<string | null>(null)

  const pinNameEdit = (lineId: string) => {
    nameEditPinRef.current = lineId
    setNameEditLineId(lineId)
  }
  const unpinNameEdit = (lineId: string) => {
    if (nameEditPinRef.current === lineId) nameEditPinRef.current = null
    setNameEditLineId((id) => (id === lineId ? null : id))
  }
  const nameEditPinned = (lineId: string) => lineId === nameEditLineId || lineId === nameEditPinRef.current

  const pinSplitEdit = (lineId: string) => {
    splitEditPinRef.current = lineId
  }
  const unpinSplitEdit = (lineId: string) => {
    if (splitEditPinRef.current === lineId) splitEditPinRef.current = null
  }
  const splitEditPinned = (lineId: string) => lineId === splitEditPinRef.current

  const order = db.orders.find((o) => o.id === orderId)
  const plans = db.planItems.filter((p) => p.orderId === orderId)
  const skip = skipPurchaseSet(order)
  const lines = useMemo(
    () =>
      sortPurchaseLines(
        db.purchaseLines
          .filter((l) => l.orderId === orderId && !skip.has(l.productId))
          .map(normalizePurchaseLine),
      ),
    [db.purchaseLines, orderId, order?.skipPurchase],
  )

  const applyLineFilter = (filterText: string, lineList = lines) => {
    const trimmed = filterText.trim()
    const products = useApp.getState().db.products
    if (!trimmed) {
      filterSnapshotRef.current = null
    } else {
      filterSnapshotRef.current = new Set(
        lineList
          .filter((l) => {
            const name = products.find((p) => p.id === l.productId)?.name ?? ''
            return nameMatchesQuery(name, filterText)
          })
          .map((l) => l.id),
      )
    }
    setFilterTick((n) => n + 1)
  }
  const applyDetailFilter = (filterText: string, lineList = lines) => {
    const trimmed = filterText.trim()
    if (!trimmed) {
      detailFilterSnapshotRef.current = null
    } else {
      detailFilterSnapshotRef.current = new Set(
        lineList
          .filter(
            (l) =>
              nameMatchesQuery(txt(l.notes), filterText) ||
              nameMatchesQuery(txt(l.address), filterText) ||
              unitPriceMatchesQuery(l.unitPrice, filterText),
          )
          .map((l) => l.id),
      )
    }
    setDetailFilterTick((n) => n + 1)
  }
  const syncKey = useMemo(() => planSyncKey(plans), [plans])

  const ensureLine = (productId: string, planned = 0): string | null => {
    if (!orderId) return null
    const existing =
      lines.find((l) => l.productId === productId && !l.cloneOf) ?? lines.find((l) => l.productId === productId)
    if (existing) return existing.id
    const cur = useApp.getState().db.orders.find((o) => o.id === orderId)
    if (cur?.skipPurchase?.includes(productId)) {
      apply({
        op: 'upsert',
        col: 'orders',
        row: { ...cur, skipPurchase: cur.skipPurchase!.filter((id) => id !== productId) },
      })
    }
    const plan = plans.find((p) => p.productId === productId)
    const split = plan ? splitFromPlan(plan) : emptyStationSplit()
    const hints = productBuyHints(db, productId)
    const id = newId()
    apply({
      op: 'upsert',
      col: 'purchaseLines',
      row: {
        id,
        orderId,
        productId,
        plannedQty: plan?.qty ?? planned,
        actualQty: 0,
        unitPrice: lastUnitPrice(db, productId) || 0,
        totalPrice: 0,
        totalManual: false,
        address: hints.address,
        notes: plan?.notes?.trim() || hints.notes,
        split,
      },
    })
    return id
  }

  useEffect(() => {
    if (!orderId || !user) return
    const t = window.setTimeout(() => {
      const now = useApp.getState().db
      const patches = buildPlanPurchaseSyncPatches(now, orderId).map((patch) => {
        if (patch.op === 'upsert' && patch.col === 'purchaseLines' && splitEditPinned(patch.row.id)) {
          const row = patch.row as PurchaseLine
          const cur = useApp.getState().db.purchaseLines.find((l) => l.id === row.id)
          return cur ? { ...patch, row: { ...row, split: cur.split } } : patch
        }
        return patch
      })
      const seen = new Set<string>()
      for (const p of patches) {
        if (p.op === 'upsert' && p.col === 'purchaseLines') seen.add(p.row.id)
      }
      for (const line of useApp.getState().db.purchaseLines.filter((l) => l.orderId === orderId)) {
        if (seen.has(line.id)) continue
        const fixed = refreshPurchaseLineTotal(normalizePurchaseLine(line))
        if (fixed) patches.push({ op: 'upsert', col: 'purchaseLines', row: fixed })
      }
      if (patches.length) applyAll(patches)
    }, 50)
    return () => window.clearTimeout(t)
  }, [orderId, user, syncKey, applyAll])

  useEffect(() => {
    applyLineFilter(q, lines)
    applyDetailFilter(detailQ, lines)
  }, [lines, db.products])

  useEffect(() => {
    if (!expandedLineId || nameEditPinned(expandedLineId)) return
    if (jumpLineId === expandedLineId) return
    const line = lines.find((l) => l.id === expandedLineId)
    if (!line || !lineIsComplete(line)) return
    const el = document.getElementById(`buy-line-${expandedLineId}`)
    if (el?.contains(document.activeElement)) return
    setExpandedLineId(null)
    setPickedProductId((pid) => (pid === line.productId ? null : pid))
  }, [lines, expandedLineId, nameEditLineId, jumpLineId])

  // Si el usuario abre otra línea, soltar el hold del salto desde Descuentos.
  useEffect(() => {
    if (!jumpLineId || !expandedLineId || jumpLineId === expandedLineId) return
    setJumpLineId(null)
  }, [expandedLineId, jumpLineId])

  const tryCollapseLine = (line: PurchaseLine) => {
    if (nameEditPinned(line.id) || !lineIsComplete(line)) return
    requestAnimationFrame(() => {
      const el = document.getElementById(`buy-line-${line.id}`)
      if (el?.contains(document.activeElement)) return
      setJumpLineId((id) => (id === line.id ? null : id))
      setExpandedLineId((id) => (id === line.id ? null : id))
      setPickedProductId((pid) => (pid === line.productId ? null : pid))
    })
  }

  const onBuyFieldDone = (line: PurchaseLine) => (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).blur()
    tryCollapseLine(line)
  }

  useEffect(() => {
    if (!jumpLineId) {
      scrolledJumpRef.current = null
      return
    }
    // Solo scrollear una vez por salto: si re-disparamos en cada sync de `lines`,
    // el listado se “pega” y no deja scrollear a mano.
    if (scrolledJumpRef.current === jumpLineId) return
    let cancelled = false
    const tryScroll = (attempt = 0) => {
      if (cancelled) return
      const el = document.getElementById(`buy-line-${jumpLineId}`)
      const scroll = el?.closest('.buy-scroll') as HTMLElement | null
      if (!el || !scroll) {
        if (attempt < 20) window.setTimeout(() => tryScroll(attempt + 1), 40)
        else setJumpLineId(null)
        return
      }
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
        scrollElementToCenter(scroll, el, false)
      } catch {
        /* WebView */
      }
      scrolledJumpRef.current = jumpLineId
      // No enfocar ni soltar jumpLineId acá: en Android el focus abría teclado,
      // soltaba el hold y la línea listada se colapsaba (rojo + “desaparece”).
    }
    const t = window.setTimeout(() => tryScroll(), 30)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [jumpLineId, lines, sectionOpen.falta, sectionOpen.listo, expandedLineId])

  useEffect(() => {
    if (!buyJumpLineId) {
      handledBuyJumpRef.current = null
      return
    }
    if (handledBuyJumpRef.current === buyJumpLineId) return
    if (!orderId) {
      useApp.setState({ buyJumpLineId: null })
      return
    }
    const raw = db.purchaseLines.find((l) => l.id === buyJumpLineId && l.orderId === orderId)
    if (!raw) {
      useApp.setState({ buyJumpLineId: null })
      return
    }
    handledBuyJumpRef.current = buyJumpLineId
    useApp.setState({ buyJumpLineId: null })
    setQ('')
    setDetailQ('')
    filterSnapshotRef.current = null
    detailFilterSnapshotRef.current = null
    setFilterTick((n) => n + 1)
    setDetailFilterTick((n) => n + 1)
    // Sin product-picked: ese estilo pone el nombre en rojo y confunde el salto.
    setPickedProductId(null)
    setJumpLineId(raw.id)
    setExpandedLineId(raw.id)
    const complete = lineIsComplete(normalizePurchaseLine(raw))
    setSectionOpen((s) => ({ ...s, [complete ? 'listo' : 'falta']: true }))
  }, [buyJumpLineId, orderId, db.purchaseLines])

  useEffect(() => {
    if (!buyJumpProductId) return
    if (!orderId) {
      useApp.setState({ buyJumpProductId: null })
      return
    }
    const productId = buyJumpProductId
    const lineId = ensureLine(productId)
    useApp.setState({ buyJumpProductId: null })
    if (!lineId) return
    const raw =
      useApp.getState().db.purchaseLines.find((l) => l.id === lineId && l.orderId === orderId) ??
      db.purchaseLines.find((l) => l.id === lineId && l.orderId === orderId)
    setQ('')
    setDetailQ('')
    filterSnapshotRef.current = null
    detailFilterSnapshotRef.current = null
    setFilterTick((n) => n + 1)
    setDetailFilterTick((n) => n + 1)
    // Igual que el salto desde Descuentos: product-picked pone rojo y confunde.
    setPickedProductId(null)
    setJumpLineId(lineId)
    setExpandedLineId(lineId)
    if (raw) {
      const complete = lineIsComplete(normalizePurchaseLine(raw))
      setSectionOpen((s) => ({ ...s, [complete ? 'listo' : 'falta']: true }))
    } else {
      setSectionOpen((s) => ({ ...s, falta: true }))
    }
  }, [buyJumpProductId, orderId, lines, db.purchaseLines])

  const matches = useMemo(() => {
    if (!q.trim()) return []
    return db.products.filter((p) => nameMatchesQuery(p.name, q)).slice(0, 8)
  }, [db.products, q])

  const addressSuggest = useMemo(() => {
    const fromLines = lines.map((l) => txt(l.address))
    const fromCatalog = db.products.map((p) => p.address ?? '')
    return uniqueFilled([...fromLines, ...fromCatalog])
  }, [lines, db.products])
  /** Lugares (obs.) del día + catálogo, para elegir en cada línea. */
  const notesSuggest = useMemo(() => {
    const fromLines = lines.map((l) => txt(l.notes))
    const fromCatalog = db.products.map((p) => p.notes ?? '')
    return uniqueFilled([...fromLines, ...fromCatalog])
  }, [lines, db.products])
  /** Solo obs. del pedido actual (filtro superior). */
  const notesSuggestToday = useMemo(() => uniqueFilled(lines.map((l) => txt(l.notes))), [lines])

  const spent = order ? orderSpent(db, order.id) : 0
  const rest = (order?.budget || 0) - spent

  const lineMatchesFilter = (l: PurchaseLine) => {
    if (nameEditPinned(l.id) || expandedLineId === l.id || l.id === jumpLineId) return true
    if (pickedProductId && l.productId === pickedProductId) return true
    if (q.trim() && !(filterSnapshotRef.current?.has(l.id) ?? false)) return false
    if (detailQ.trim() && !(detailFilterSnapshotRef.current?.has(l.id) ?? false)) return false
    return true
  }

  const productName = (l: PurchaseLine) => db.products.find((p) => p.id === l.productId)?.name ?? ''
  const sortFilteredLines = (lineList: PurchaseLine[]) =>
    sortByListMode(lineList, sortMode, productName, (l) => l.unitPrice || 0)

  const faltaLines = useMemo(
    () => sortFilteredLines(lines.filter((l) => !lineIsComplete(l) && lineMatchesFilter(l))),
    [lines, q, detailQ, nameEditLineId, expandedLineId, jumpLineId, pickedProductId, filterTick, detailFilterTick, sortMode, db.products],
  )
  const listoLines = useMemo(
    () => sortFilteredLines(lines.filter((l) => lineIsComplete(l) && lineMatchesFilter(l))),
    [lines, q, detailQ, nameEditLineId, expandedLineId, jumpLineId, pickedProductId, filterTick, detailFilterTick, sortMode, db.products],
  )

  const toggleSection = (key: 'falta' | 'listo') =>
    setSectionOpen((s) => ({ ...s, [key]: !s[key] }))

  const pickProduct = (productId: string, _name?: string) => {
    const lineId = ensureLine(productId)
    setQ('')
    applyLineFilter('')
    setPickedProductId(productId)
    if (lineId) {
      setJumpLineId(lineId)
      setExpandedLineId(lineId)
    }
  }

  const cloneLine = (line: PurchaseLine) => {
    if (!orderId) return
    apply({
      op: 'upsert',
      col: 'purchaseLines',
      row: {
        id: newId(),
        orderId,
        productId: line.productId,
        plannedQty: 0,
        actualQty: 0,
        unitPrice: line.unitPrice || lastUnitPrice(db, line.productId) || 0,
        totalPrice: 0,
        totalManual: false,
        address: '',
        notes: '',
        split: emptyStationSplit(),
        cloneOf: line.id,
      },
    })
  }

  const removeLine = (line: PurchaseLine) => {
    if (!orderId) return
    const dbNow = useApp.getState().db
    stashProductBuyHintsFromLines(apply, dbNow, line.productId, [line])
    apply({ op: 'remove', col: 'purchaseLines', id: line.id })
  }

  /** Sacar de compras sin tocar planificación ni el catálogo. */
  const removeProductFromPurchase = (productId: string) => {
    if (!orderId) return
    const dbNow = useApp.getState().db
    const toRemove = dbNow.purchaseLines.filter((l) => l.orderId === orderId && l.productId === productId)
    if (!toRemove.length) return
    stashProductBuyHintsFromLines(apply, dbNow, productId, toRemove)
    applyAll(toRemove.map((line) => ({ op: 'remove', col: 'purchaseLines', id: line.id })))
  }

  const fillAddressFromLocation = (line: PurchaseLine) => {
    if (locatingId === line.id) return
    setLocatingId(line.id)
    geolocateAddress((msg) => useApp.setState({ toast: msg }))
      .then((address) => {
        const cur = useApp.getState().db.purchaseLines.find((l) => l.id === line.id)
        if (cur) patchLine(apply, cur, { address })
        useApp.setState({ toast: null })
      })
      .catch((e) => {
        const msg = e instanceof Error && e.message.trim() ? e.message.trim() : 'No se pudo obtener la ubicación.'
        useApp.setState({ toast: msg })
      })
      .finally(() => setLocatingId(null))
  }

  const createAndAdd = () => {
    if (!user || !orderId || !q.trim()) return
    const name = q.trim()
    const lower = name.toLowerCase()
    const found = db.products.find((p) => p.name.toLowerCase() === lower) || matches[0] || null
    if (found) {
      pickProduct(found.id, found.name)
      return
    }
    const id = newId()
    apply({ op: 'upsert', col: 'products', row: { id, name, createdBy: user, createdAt: Date.now() } })
    pickProduct(id, name)
  }

  if (!order) {
    return (
      <div className="page">
        <DateBar />
        <p className="empty">Poné la fecha y Enter para esta compra.</p>
      </div>
    )
  }

  return (
    <div className="page buy-page">
      <div className="buy-scroll" onFocusCapture={scrollFieldIntoView}>
      <DateBar
        extra={
          <FocusField id={`budget-${order.id}`}>
            <label className="budget budget-compact">
              Presupuesto
              <span className="money-in">
                <span className="money-sym" aria-hidden>
                  $
                </span>
                <input
                  inputMode="decimal"
                  value={order.budget || ''}
                  onChange={(e) => {
                    const cur = useApp.getState().db.orders.find((o) => o.id === order.id)
                    if (!cur) return
                    apply({
                      op: 'upsert',
                      col: 'orders',
                      row: { ...cur, budget: num(e.target.value), status: 'comprando' },
                    })
                  }}
                />
              </span>
            </label>
          </FocusField>
        }
      />

      <div className="buy-filter-row">
      <div className="grid2 buy-search-row">
        <FocusField id="buy-search">
          <label className="search">
            Producto · Enter agrega
            <input
              value={q}
              enterKeyHint="go"
              onChange={(e) => {
                const v = e.target.value
                setQ(v)
                if (v.trim() && nameEditPinRef.current) {
                  nameEditPinRef.current = null
                  setNameEditLineId(null)
                }
                applyLineFilter(v)
                if (!v.trim()) setPickedProductId(null)
                else if (pickedProductId) {
                  const picked = db.products.find((p) => p.id === pickedProductId)
                  if (picked && !nameMatchesQuery(picked.name, v)) setPickedProductId(null)
                }
              }}
              placeholder="Producto…"
              onKeyDown={enterTo(createAndAdd)}
            />
          </label>
        </FocusField>
        <FocusField id="buy-detail-filter">
          <label className="search">
            Filtro
            <SuggestTextInput
              value={detailQ}
              options={notesSuggestToday}
              placeholder="Obs., dir. o U.…"
              onChange={(v) => {
                setDetailQ(v)
                if (v.trim() && nameEditPinRef.current) {
                  nameEditPinRef.current = null
                  setNameEditLineId(null)
                }
                applyDetailFilter(v)
                setPickedProductId(null)
              }}
            />
          </label>
        </FocusField>
      </div>
      {lines.length > 0 && <ListSortToggle mode={sortMode} onChange={setSortMode} />}
      </div>
      {matches.length > 0 && (
        <ul className="suggest">
          {matches.map((p) => (
            <li key={p.id} className="suggest-row">
              <button type="button" className="pick" onClick={() => pickProduct(p.id, p.name)}>
                {p.name}
              </button>
              <button
                type="button"
                className="icon-x"
                aria-label={`Sacar ${p.name} de compras`}
                onClick={() => removeProductFromPurchase(p.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {lines.length === 0 && <p className="empty">Escribí un producto y Enter.</p>}
      {lines.length > 0 && (q.trim() || detailQ.trim()) && faltaLines.length === 0 && listoLines.length === 0 && (
        <p className="empty">Nada coincide con el filtro.</p>
      )}

      {faltaLines.length > 0 && (
        <BuySection
          title="FALTA"
          open={sectionOpen.falta}
          count={faltaLines.length}
          onToggle={() => toggleSection('falta')}
        >
          {faltaLines.map((line) =>
            renderBuyLine(line, {
              db,
              apply,
              pickedProductId,
              expandedLineId,
              locatingId,
              addressSuggest,
              notesSuggest,
              setExpandedLineId,
              pinNameEdit,
              unpinNameEdit,
              pinSplitEdit,
              unpinSplitEdit,
              tryCollapseLine,
              onBuyFieldDone,
              removeLine,
              cloneLine,
              fillAddressFromLocation,
            }),
          )}
        </BuySection>
      )}
      {listoLines.length > 0 && (
        <BuySection
          title="LISTO"
          open={sectionOpen.listo}
          count={listoLines.length}
          onToggle={() => toggleSection('listo')}
        >
          {listoLines.map((line) =>
            renderBuyLine(line, {
              db,
              apply,
              pickedProductId,
              expandedLineId,
              locatingId,
              addressSuggest,
              notesSuggest,
              setExpandedLineId,
              pinNameEdit,
              unpinNameEdit,
              pinSplitEdit,
              unpinSplitEdit,
              tryCollapseLine,
              onBuyFieldDone,
              removeLine,
              cloneLine,
              fillAddressFromLocation,
            }),
          )}
        </BuySection>
      )}
      </div>
      <div className="totals-dock">
        <div>
          <span>Total compra</span>
          <strong>{money(spent)}</strong>
        </div>
        <div className={rest < 0 ? 'neg' : ''}>
          <span>Resta presupuesto</span>
          <strong>{money(rest)}</strong>
        </div>
      </div>
    </div>
  )
}

function BuySection({
  title,
  open,
  count,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  count: number
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className={`buy-section${open ? ' buy-section-open' : ''}`}>
      <button type="button" className="buy-section-head" onClick={onToggle} aria-expanded={open}>
        <span className={`buy-section-dot${open ? ' open' : ''}`} aria-hidden />
        <span className="buy-section-title">{title}</span>
        <span className="buy-section-count">{count}</span>
      </button>
      {open && <ul className="cards">{children}</ul>}
    </section>
  )
}

type BuyLineCtx = {
  db: ReturnType<typeof useApp.getState>['db']
  apply: ReturnType<typeof useApp.getState>['apply']
  pickedProductId: string | null
  expandedLineId: string | null
  locatingId: string | null
  addressSuggest: string[]
  notesSuggest: string[]
  setExpandedLineId: (id: string | null | ((prev: string | null) => string | null)) => void
  pinNameEdit: (lineId: string) => void
  unpinNameEdit: (lineId: string) => void
  pinSplitEdit: (lineId: string) => void
  unpinSplitEdit: (lineId: string) => void
  tryCollapseLine: (line: PurchaseLine) => void
  onBuyFieldDone: (line: PurchaseLine) => (e: KeyboardEvent) => void
  removeLine: (line: PurchaseLine) => void
  cloneLine: (line: PurchaseLine) => void
  fillAddressFromLocation: (line: PurchaseLine) => void
}

function renderBuyLine(line: PurchaseLine, ctx: BuyLineCtx) {
  const {
    db,
    apply,
    pickedProductId,
    expandedLineId,
    locatingId,
    addressSuggest,
    notesSuggest,
    setExpandedLineId,
    pinNameEdit,
    unpinNameEdit,
    pinSplitEdit,
    unpinSplitEdit,
    tryCollapseLine,
    onBuyFieldDone,
    removeLine,
    cloneLine,
    fillAddressFromLocation,
  } = ctx
  const prod = db.products.find((p) => p.id === line.productId)
  const actual = purchaseQty(line)
  const hint = actual > 0 ? purchaseLineHint(line) : null
  const done = lineIsComplete(line)
  const editing = expandedLineId === line.id
  const collapsed = done && !editing
  return (
    <li
      id={`buy-line-${line.id}`}
      key={line.id}
      className={`card compact-card buy-row${line.cloneOf ? ' buy-row-clone' : ''}${pickedProductId === line.productId ? ' product-picked' : ''}${collapsed ? ' buy-row-done' : ''}`}
      onFocusCapture={() => setExpandedLineId(line.id)}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null
        if (next && e.currentTarget.contains(next)) return
        // En Android relatedTarget suele ser null al tocar otro control del mismo card.
        requestAnimationFrame(() => {
          if (e.currentTarget.contains(document.activeElement)) return
          tryCollapseLine(line)
        })
      }}
      onClick={() => {
        if (collapsed) setExpandedLineId(line.id)
      }}
    >
      <button type="button" className="icon-x buy-row-x" aria-label="Borrar línea" onClick={() => removeLine(line)}>
        ×
      </button>
      <div className="buy-name-row-wrap">
        <BuyLineNameInput
          line={line}
          prod={prod}
          apply={apply}
          pinNameEdit={pinNameEdit}
          unpinNameEdit={unpinNameEdit}
          setExpandedLineId={setExpandedLineId}
        />
        <button type="button" className="buy-clone-btn" aria-label="Clonar producto" onClick={() => cloneLine(line)}>
          +
        </button>
      </div>
      {collapsed && (
        <div className="buy-ready-check-row">
          <button
            type="button"
            className={`buy-ready-check${line.ready ? ' on' : ''}`}
            aria-label={line.ready ? 'Marcar pendiente' : 'Marcar listo'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              const cur = useApp.getState().db.purchaseLines.find((l) => l.id === line.id)
              if (cur) patchLine(apply, cur, { ready: cur.ready ? false : true })
            }}
          />
          <span>{line.ready ? 'Listo' : 'Tocá para listo'}</span>
        </div>
      )}
      <div className="buy-main-grid">
        <div className="buy-qty-col">
          <div className="buy-qty-stack">
            <FocusField id={`buy-plan-${line.id}`}>
              <label className="qty-in">
                <span>A comprar</span>
                <input className="qty-narrow" inputMode="decimal" readOnly tabIndex={-1} value={line.plannedQty || ''} />
              </label>
            </FocusField>
            <FocusField id={`buy-real-${line.id}`}>
              <label className="qty-in">
                <span>Compré</span>
                <input className="qty-narrow" inputMode="decimal" readOnly tabIndex={-1} value={actual || ''} />
              </label>
            </FocusField>
          </div>
        </div>
        {STATIONS.map((st) => (
          <FocusField key={st} id={`buy-split-${st}-${line.id}`}>
            <label className={`st-in ${st}`}>
              <span className="st-in-head">
                {STATION_LABEL[st]}
                {st === 'madro' && hint && (
                  <span className={`split-msg buy-st-hint ${hint.kind}${hint.kind === 'warn' ? ' missing-qty' : ''}`}>
                    {hint.kind === 'warn' ? qtyLabel(actual - splitTotal(line)) : hint.text}
                  </span>
                )}
              </span>
              <BuyLineSplitInput
                line={line}
                station={st}
                apply={apply}
                pinSplitEdit={pinSplitEdit}
                unpinSplitEdit={unpinSplitEdit}
                onKeyDown={onBuyFieldDone(line)}
              />
              {st === 'madro' && (
                <button
                  type="button"
                  className={`buy-ready-check${line.ready ? ' on' : ''}`}
                  aria-label={line.ready ? 'Marcar pendiente' : 'Marcar listo'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    const cur = useApp.getState().db.purchaseLines.find((l) => l.id === line.id)
                    if (cur) patchLine(apply, cur, { ready: cur.ready ? false : true })
                  }}
                />
              )}
            </label>
          </FocusField>
        ))}
      </div>
      <div className="buy-fields-row">
        <FocusField id={`buy-unit-${line.id}`}>
          <label className="buy-field-in">
            <span>U.</span>
            <span className="money-in">
              <span className="money-sym" aria-hidden>
                $
              </span>
              <BuyLineUnitPriceInput line={line} apply={apply} onKeyDown={onBuyFieldDone(line)} />
            </span>
          </label>
        </FocusField>
        <FocusField id={`buy-addr-${line.id}`}>
          <div className="buy-field-in buy-addr-field">
            <span>Dir.</span>
            <span className="buy-addr-wrap">
              <SuggestTextInput
                className="buy-addr-narrow"
                value={txt(line.address)}
                options={addressSuggest}
                placeholder="Dir."
                onChange={(v) => patchLine(apply, line, { address: v })}
                onKeyDown={onBuyFieldDone(line)}
              />
              <button
                type="button"
                className="buy-loc-btn"
                aria-label="Usar mi ubicación"
                disabled={locatingId === line.id}
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  fillAddressFromLocation(line)
                }}
              >
                {locatingId === line.id ? '…' : '⌖'}
              </button>
            </span>
          </div>
        </FocusField>
        <FocusField id={`buy-total-${line.id}`}>
          <label className="buy-field-in">
            <span>Tot.</span>
            <input
              className="buy-total-narrow money-ro"
              inputMode="decimal"
              readOnly
              tabIndex={-1}
              value={lineTotal(line) ? money(lineTotal(line)) : ''}
            />
          </label>
        </FocusField>
        <FocusField id={`buy-notes-${line.id}`}>
          <label className="buy-field-in buy-notes-field">
            <span>Obs.</span>
            <BuyLineNotesInput
              line={line}
              apply={apply}
              options={notesSuggest}
              onKeyDown={onBuyFieldDone(line)}
            />
          </label>
        </FocusField>
      </div>
    </li>
  )
}

/** Borrador local: evita que sync/re-render pisen el precio mientras editás U. */
function BuyLineUnitPriceInput({
  line,
  apply,
  onKeyDown,
}: {
  line: PurchaseLine
  apply: ReturnType<typeof useApp.getState>['apply']
  onKeyDown: (e: KeyboardEvent) => void
}) {
  const storedStr = line.unitPrice ? String(line.unitPrice) : ''
  const [draft, setDraft] = useState(storedStr)
  const editingRef = useRef(false)
  const draftRef = useRef(storedStr)

  useEffect(() => {
    if (!editingRef.current) {
      draftRef.current = storedStr
      setDraft(storedStr)
    }
  }, [storedStr])

  useEffect(() => {
    return () => {
      if (!editingRef.current) return
      commitUnitPrice(apply, line.id, draftRef.current)
    }
  }, [apply, line.id])

  const syncDraft = (v: string) => {
    draftRef.current = v
    setDraft(v)
  }

  return (
    <input
      className="buy-unit-narrow"
      inputMode="decimal"
      enterKeyHint="done"
      value={draft}
      onFocus={() => {
        editingRef.current = true
        syncDraft(storedStr)
      }}
      onBlur={() => {
        requestAnimationFrame(() => {
          const el = document.getElementById(`buy-line-${line.id}`)
          if (el?.contains(document.activeElement)) return
          editingRef.current = false
          const unitPrice = commitUnitPrice(apply, line.id, draftRef.current)
          syncDraft(unitPrice ? String(unitPrice) : '')
        })
      }}
      onChange={(e) => {
        editingRef.current = true
        const v = e.target.value
        syncDraft(v)
        const parsed = parseDecimalDraft(v)
        if (parsed === null) return
        const cur = useApp.getState().db.purchaseLines.find((l) => l.id === line.id)
        if (cur) {
          const qty = purchaseQty(cur)
          patchLine(apply, cur, { unitPrice: parsed, totalPrice: parsed * qty, totalManual: false })
        }
      }}
      onKeyDown={onKeyDown}
    />
  )
}

/** Borrador local: evita que sync/re-render pisen números mientras editás el reparto. */
function BuyLineSplitInput({
  line,
  station,
  apply,
  pinSplitEdit,
  unpinSplitEdit,
  onKeyDown,
}: {
  line: PurchaseLine
  station: Station
  apply: ReturnType<typeof useApp.getState>['apply']
  pinSplitEdit: (lineId: string) => void
  unpinSplitEdit: (lineId: string) => void
  onKeyDown: (e: KeyboardEvent) => void
}) {
  const stored = line.split?.[station]
  const storedStr = stored ? String(stored) : ''
  const [draft, setDraft] = useState(storedStr)
  const editingRef = useRef(false)
  const draftRef = useRef(storedStr)

  useEffect(() => {
    if (!editingRef.current) {
      draftRef.current = storedStr
      setDraft(storedStr)
    }
  }, [storedStr])

  useEffect(() => {
    return () => {
      if (!editingRef.current) return
      unpinSplitEdit(line.id)
      commitSplit(apply, line.id, station, draftRef.current)
    }
  }, [apply, line.id, station, unpinSplitEdit])

  const syncDraft = (v: string) => {
    draftRef.current = v
    setDraft(v)
  }

  return (
    <input
      inputMode="decimal"
      enterKeyHint="done"
      value={draft}
      onFocus={() => {
        editingRef.current = true
        pinSplitEdit(line.id)
        syncDraft(storedStr)
      }}
      onBlur={() => {
        requestAnimationFrame(() => {
          const el = document.getElementById(`buy-line-${line.id}`)
          if (el?.contains(document.activeElement)) return
          editingRef.current = false
          unpinSplitEdit(line.id)
          commitSplit(apply, line.id, station, draftRef.current)
          const cur = useApp.getState().db.purchaseLines.find((l) => l.id === line.id)
          const v = cur?.split?.[station]
          syncDraft(v ? String(v) : '')
        })
      }}
      onChange={(e) => {
        editingRef.current = true
        pinSplitEdit(line.id)
        const v = e.target.value
        syncDraft(v)
        const parsed = parseDecimalDraft(v)
        if (parsed === null) return
        const cur = useApp.getState().db.purchaseLines.find((l) => l.id === line.id)
        if (cur) syncSplit(apply, cur, station, parsed)
      }}
      onKeyDown={onKeyDown}
    />
  )
}

/** Borrador local: evita que sync/re-render pisen letras mientras editás observaciones. */
function BuyLineNotesInput({
  line,
  apply,
  options,
  onKeyDown,
}: {
  line: PurchaseLine
  apply: ReturnType<typeof useApp.getState>['apply']
  options: string[]
  onKeyDown: (e: KeyboardEvent) => void
}) {
  const notes = line.notes || ''
  const [draft, setDraft] = useState(notes)
  const editingRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(notes)
  }, [notes])

  return (
    <SuggestTextInput
      value={draft}
      options={options}
      placeholder="Obs."
      onFocus={() => {
        editingRef.current = true
        setDraft(notes)
      }}
      onBlur={() => {
        requestAnimationFrame(() => {
          const el = document.getElementById(`buy-line-${line.id}`)
          if (el?.contains(document.activeElement)) return
          editingRef.current = false
          const cur = useApp.getState().db.purchaseLines.find((l) => l.id === line.id)
          setDraft(cur?.notes || '')
        })
      }}
      onChange={(v) => {
        editingRef.current = true
        setDraft(v)
        const cur = useApp.getState().db.purchaseLines.find((l) => l.id === line.id)
        if (cur) patchLine(apply, cur, { notes: v })
      }}
      onKeyDown={onKeyDown}
    />
  )
}

/** Sugerencias al enfocar/tipear (no historial/datalist del browser). */
function SuggestTextInput({
  value,
  options,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  className,
  placeholder,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  onKeyDown?: (e: KeyboardEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  className?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const q = value.trim().toLowerCase()
  /** Vacío: lista completa (lugares); con texto: filtro parcial. */
  const hits =
    q.length >= 1
      ? options.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q).slice(0, 8)
      : options.filter((o) => o.toLowerCase() !== q).slice(0, 8)

  return (
    <span className={`suggest-field${open && hits.length > 0 ? ' suggest-open' : ''}`}>
      <input
        className={className}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => {
          setOpen(true)
          onFocus?.()
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 180)
          onBlur?.()
        }}
        onChange={(e) => {
          setOpen(true)
          onChange(e.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      {open && hits.length > 0 && (
        <ul className="suggest-popup" role="listbox">
          {hits.map((h) => (
            <li key={h}>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(h)
                  setOpen(false)
                }}
              >
                {h}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}

/** Borrador local: evita que sync/re-render pisen letras mientras editás el nombre. */
function BuyLineNameInput({
  line,
  prod,
  apply,
  pinNameEdit,
  unpinNameEdit,
  setExpandedLineId,
}: {
  line: PurchaseLine
  prod: ReturnType<typeof useApp.getState>['db']['products'][number] | undefined
  apply: ReturnType<typeof useApp.getState>['apply']
  pinNameEdit: (lineId: string) => void
  unpinNameEdit: (lineId: string) => void
  setExpandedLineId: BuyLineCtx['setExpandedLineId']
}) {
  const productName = prod?.name ?? ''
  const [draft, setDraft] = useState(productName)
  const editingRef = useRef(false)
  const draftRef = useRef(productName)

  const syncDraft = (v: string) => {
    draftRef.current = v
    setDraft(v)
  }

  useEffect(() => {
    if (!editingRef.current) syncDraft(productName)
  }, [productName])

  useEffect(() => {
    return () => {
      if (!editingRef.current) return
      commitProductName(apply, line.productId, draftRef.current)
    }
  }, [apply, line.productId])

  return (
    <input
      className="name-in buy-name-row"
      value={draft}
      aria-label="Nombre"
      onPointerDown={() => {
        editingRef.current = true
        pinNameEdit(line.id)
      }}
      onFocus={() => {
        editingRef.current = true
        pinNameEdit(line.id)
        setExpandedLineId(line.id)
        syncDraft(productName)
      }}
      onBlur={() => {
        requestAnimationFrame(() => {
          const el = document.getElementById(`buy-line-${line.id}`)
          if (el?.contains(document.activeElement)) return
          editingRef.current = false
          unpinNameEdit(line.id)
          commitProductName(apply, line.productId, draftRef.current)
          const cur = useApp.getState().db.products.find((p) => p.id === line.productId)
          syncDraft(cur?.name ?? draftRef.current)
        })
      }}
      onChange={(e) => {
        editingRef.current = true
        pinNameEdit(line.id)
        const v = e.target.value
        syncDraft(v)
        const cur = useApp.getState().db.products.find((p) => p.id === line.productId)
        if (!cur) return
        apply({ op: 'upsert', col: 'products', row: { ...cur, name: v } })
      }}
    />
  )
}

function num(v: string) {
  return parseArNumber(v)
}

/** Número completo mientras tipeás; null si está vacío o termina en ,/. */
function parseDecimalDraft(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  if (/[.,]$/.test(t)) return null
  const n = parseArNumber(t)
  return Number.isFinite(n) ? n : null
}

function commitUnitPrice(
  apply: ReturnType<typeof useApp.getState>['apply'],
  lineId: string,
  raw: string,
): number {
  const cur = useApp.getState().db.purchaseLines.find((l) => l.id === lineId)
  if (!cur) return 0
  const unitPrice = raw.trim() ? num(raw) : 0
  const qty = purchaseQty(cur)
  patchLine(apply, cur, { unitPrice, totalPrice: unitPrice * qty, totalManual: false })
  return unitPrice
}

function uniqueFilled(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = txt(v).trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function sortPurchaseLines(lines: PurchaseLine[]): PurchaseLine[] {
  const byId = new Map(lines.map((l) => [l.id, l]))
  const children = new Map<string, PurchaseLine[]>()
  const roots: PurchaseLine[] = []
  for (const l of lines) {
    if (l.cloneOf && byId.has(l.cloneOf)) {
      const arr = children.get(l.cloneOf) || []
      arr.push(l)
      children.set(l.cloneOf, arr)
    } else {
      roots.push(l)
    }
  }
  const out: PurchaseLine[] = []
  for (const r of roots) {
    out.push(r)
    for (const c of children.get(r.id) || []) out.push(c)
  }
  return out
}

function commitProductName(
  apply: ReturnType<typeof useApp.getState>['apply'],
  productId: string,
  raw: string,
) {
  const name = raw.trim()
  if (!name) return
  const cur = useApp.getState().db.products.find((p) => p.id === productId)
  if (!cur || cur.name === name) return
  apply({ op: 'upsert', col: 'products', row: { ...cur, name } })
}

function patchLine(apply: ReturnType<typeof useApp.getState>['apply'], line: PurchaseLine, part: Partial<PurchaseLine>) {
  apply({ op: 'upsert', col: 'purchaseLines', row: { ...line, ...part } })
  if (part.address !== undefined || part.notes !== undefined) {
    const prod = useApp.getState().db.products.find((p) => p.id === line.productId)
    saveProductBuyHints(apply, prod, {
      ...(part.address !== undefined ? { address: part.address } : {}),
      ...(part.notes !== undefined ? { notes: part.notes } : {}),
    })
  }
}

function syncSplit(
  apply: ReturnType<typeof useApp.getState>['apply'],
  line: PurchaseLine,
  station: (typeof STATIONS)[number],
  raw: number,
) {
  apply({ op: 'upsert', col: 'purchaseLines', row: setPurchaseSplit(line, station, raw) })
}

function commitSplit(
  apply: ReturnType<typeof useApp.getState>['apply'],
  lineId: string,
  station: Station,
  raw: string,
) {
  const cur = useApp.getState().db.purchaseLines.find((l) => l.id === lineId)
  if (!cur) return
  const qty = raw.trim() ? num(raw) : 0
  syncSplit(apply, cur, station, qty)
}
