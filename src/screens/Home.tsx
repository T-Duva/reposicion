import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FocusField } from '../components/FocusField'
import { DateBar, ensureOrder, todayISO } from '../components/DateBar'
import { enterTo } from '../lib/keys'
import { newId } from '../lib/id'
import { nameMatchesQuery } from '../lib/nameFilter'
import { formatDateISO, parseArNumber } from '../lib/format'
import { DEFAULT_RUBROS, isDefaultRubro } from '../lib/stockRubros'
import {
  commitStockDraftsBestEffort,
  commitStockDraftsFromDb,
  commitStockDraftsNow,
  loadStockDraftNames,
  loadStockPendingAdds,
  registerStockDraftCommitter,
  registerStockPendingAddsFlusher,
  saveStockDraftNames,
  saveStockPendingAdds,
} from '../lib/stockDraftFlush'
import {
  ensureStockCatalogFromBackup,
  isStockItemRemoveBlocked,
  stockCatalogReconcilePatches,
} from '../lib/localDb'
import { useApp } from '../state/store'
import type { Patch, StockItem } from '../types'

function stockItemLabel(item: StockItem, productName?: string): string {
  const fromItem = (item.label || '').trim()
  if (fromItem) return fromItem
  return (productName || '').trim()
}

export function Home() {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const apply = useApp((s) => s.apply)
  const applyAll = useApp((s) => s.applyAll)
  const orderId = useApp((s) => s.orderId)
  const setOrderId = useApp((s) => s.setOrderId)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [addingRubro, setAddingRubro] = useState(false)
  const [newRubroName, setNewRubroName] = useState('')
  const [addQ, setAddQ] = useState<Record<string, string>>(() => loadStockPendingAdds())
  const [focusItemId, setFocusItemId] = useState<string | null>(null)
  const [draftNames, setDraftNames] = useState<Record<string, string>>(() => loadStockDraftNames())
  const addQRef = useRef(addQ)
  addQRef.current = addQ
  const draftTimerRef = useRef<Record<string, number>>({})
  const flushingAddsRef = useRef(false)

  const flushStockEdits = () => {
    for (const t of Object.values(draftTimerRef.current)) window.clearTimeout(t)
    draftTimerRef.current = {}
    commitStockDraftsNow()
  }

  const commitItemLabelToDb = (itemId: string, rawName: string) => {
    const trimmed = rawName.trim()
    if (!trimmed) return
    const state = useApp.getState()
    if (!state.user) return
    const catalog = ensureStockCatalogFromBackup(state.db)
    const item =
      state.db.stockItems.find((s) => s.id === itemId) ??
      catalog.stockItems.find((s) => s.id === itemId)
    if (!item) return
    const prod =
      state.db.products.find((p) => p.id === item.productId) ??
      catalog.products.find((p) => p.id === item.productId)
    const patches: Patch[] = [{ op: 'upsert', col: 'stockItems', row: { ...item, label: trimmed } }]
    if (prod) {
      patches.unshift({ op: 'upsert', col: 'products', row: { ...prod, name: trimmed } })
    } else {
      patches.unshift({
        op: 'upsert',
        col: 'products',
        row: { id: item.productId, name: trimmed, createdBy: state.user, createdAt: Date.now() },
      })
    }
    state.applyAll(patches)
    setDraftNames((prev) => {
      if (!(itemId in prev)) return prev
      const next = { ...prev }
      delete next[itemId]
      saveStockDraftNames(next)
      return next
    })
  }

  const scheduleDraftCommit = (itemId: string, name: string) => {
    const prev = draftTimerRef.current[itemId]
    if (prev) window.clearTimeout(prev)
    if (!name.trim()) return
    draftTimerRef.current[itemId] = window.setTimeout(() => {
      delete draftTimerRef.current[itemId]
      commitItemLabelToDb(itemId, name)
    }, 400)
  }

  const patchDraftNames = (itemId: string, name: string) => {
    setDraftNames((prev) => {
      const next = { ...prev, [itemId]: name }
      saveStockDraftNames(next)
      return next
    })
    scheduleDraftCommit(itemId, name)
  }

  const patchAddQ = (rubroId: string, value: string) => {
    const next = { ...addQRef.current, [rubroId]: value }
    addQRef.current = next
    saveStockPendingAdds(next)
    setAddQ(next)
  }

  const clearAddQ = (rubroId: string) => {
    const next = { ...addQRef.current, [rubroId]: '' }
    addQRef.current = next
    saveStockPendingAdds(next)
    setAddQ(next)
  }

  // Cada vez que se abre Stock: confirmar borradores de nombres y rescatar ítems del backup.
  // No volcar "Producto · Enter agrega": el texto vuelve al input; Enter/blur/salir confirman.
  useEffect(() => {
    const state = useApp.getState()
    if (!state.user) return
    commitStockDraftsBestEffort(state.db, state.user, (p) => state.applyAll(p), () => useApp.getState().db)
    const reconcile = stockCatalogReconcilePatches(useApp.getState().db)
    if (reconcile.length) state.applyAll(reconcile)
  }, [])

  const flushPendingAddQ = () => {
    if (flushingAddsRef.current) return
    flushingAddsRef.current = true
    try {
      for (const [rubroId, raw] of Object.entries(addQRef.current)) {
        const typed = (raw || '').trim()
        if (typed) addProduct(rubroId, typed)
      }
    } finally {
      flushingAddsRef.current = false
    }
  }

  useEffect(() => {
    const flushDrafts = () => {
      const state = useApp.getState()
      if (!state.user) return
      if (commitStockDraftsFromDb(state.db, state.user, (p) => state.applyAll(p))) {
        setDraftNames({})
      }
    }
    const unregDrafts = registerStockDraftCommitter(flushDrafts)
    const unregAdds = registerStockPendingAddsFlusher(flushPendingAddQ)
    return () => {
      unregDrafts()
      unregAdds()
    }
  }, [])

  // Persistir descripciones y altas pendientes al salir de Stock.
  useEffect(
    () => () => {
      for (const t of Object.values(draftTimerRef.current)) window.clearTimeout(t)
      draftTimerRef.current = {}
      const state = useApp.getState()
      if (!state.user) return
      commitStockDraftsBestEffort(
        state.db,
        state.user,
        (p) => state.applyAll(p),
        () => useApp.getState().db,
        { pendingAdds: true },
      )
    },
    [],
  )
  useEffect(() => {
    saveStockDraftNames(draftNames)
    if (!Object.keys(draftNames).length) return
    const t = window.setTimeout(() => {
      const state = useApp.getState()
      if (!state.user) return
      commitStockDraftsBestEffort(state.db, state.user, (p) => state.applyAll(p), () => useApp.getState().db)
      setDraftNames(loadStockDraftNames())
    }, 50)
    return () => window.clearTimeout(t)
  }, [draftNames])

  // Solo persistir el texto: no crear productos al tipear (Enter / blur / salir de Stock).
  useEffect(() => {
    saveStockPendingAdds(addQ)
  }, [addQ])

  useEffect(() => {
    if (!user) return
    const have = new Set((db.rubros || []).map((r) => r.id))
    const missing = DEFAULT_RUBROS.filter((r) => !have.has(r.id))
    if (!missing.length) return
    applyAll(
      missing.map((r) => ({
        op: 'upsert' as const,
        col: 'rubros' as const,
        row: {
          id: r.id,
          name: r.name,
          sort: r.sort,
          createdBy: user,
          createdAt: Date.now(),
        },
      })),
    )
  }, [user, db.rubros, applyAll])

  useEffect(() => {
    if (!user) return
    const known = new Set((db.rubros || []).map((r) => r.id))
    const missingRubroIds = new Set<string>()
    for (const item of db.stockItems || []) {
      if (!known.has(item.rubroId)) missingRubroIds.add(item.rubroId)
    }
    if (!missingRubroIds.size) return
    let nextSort = (db.rubros || []).reduce((m, r) => Math.max(m, r.sort), -1) + 1
    applyAll(
      [...missingRubroIds].map((id) => {
        const base = DEFAULT_RUBROS.find((r) => r.id === id)
        const row = {
          id,
          name: base?.name || 'Rubro recuperado',
          sort: base?.sort ?? nextSort++,
          createdBy: user,
          createdAt: Date.now(),
        }
        return { op: 'upsert' as const, col: 'rubros' as const, row }
      }),
    )
  }, [user, db.rubros, db.stockItems, applyAll])

  useLayoutEffect(() => {
    if (!user) return
    const active = db.orders.find((o) => o.id === orderId)
    if (active) return
    ensureOrder(db.orders, todayISO(), user, (p) => apply(p), setOrderId)
  }, [user, db.orders, orderId, apply, setOrderId])

  const rubros = useMemo(
    () => [...(db.rubros || [])].sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt),
    [db.rubros],
  )

  const itemsByRubro = useMemo(() => {
    const map = new Map<string, StockItem[]>()
    const products = db.products || []
    for (const item of db.stockItems || []) {
      const list = map.get(item.rubroId) || []
      // Un solo renglón por producto o por mismo nombre (o vacío) en el rubro (evita “fantasmas”).
      if (list.some((s) => s.productId === item.productId)) continue
      const label = stockItemLabel(item, products.find((p) => p.id === item.productId)?.name)
        .trim()
        .toLowerCase()
      if (
        list.some((s) => {
          const other = stockItemLabel(s, products.find((p) => p.id === s.productId)?.name)
            .trim()
            .toLowerCase()
          return other === label
        })
      ) {
        continue
      }
      list.push(item)
      map.set(item.rubroId, list)
    }
    return map
  }, [db.stockItems, db.products])

  const query = q.trim()
  const activeOrder = db.orders.find((o) => o.id === orderId)
  const activeDate = activeOrder?.date || null
  const stockDate = activeDate || todayISO()
  const stockDateLabel = formatDateISO(stockDate)

  useEffect(() => {
    if (!activeDate) return
    const toMigrate = (db.stockItems || []).filter(
      (item) => (!item.qtyByDate || Object.keys(item.qtyByDate).length === 0) && Number(item.qty) !== 0,
    )
    if (!toMigrate.length) return
    applyAll(
      toMigrate.map((item) => ({
        op: 'upsert' as const,
        col: 'stockItems' as const,
        row: {
          ...item,
          qtyByDate: { [activeDate]: Number(item.qty) || 0 },
        },
      })),
    )
  }, [activeDate, db.stockItems, applyAll])

  useEffect(() => {
    if (!user) return
    setOpen((prev) => {
      if (Object.keys(prev).length > 0) return prev
      const next = { ...prev }
      let changed = false
      for (const rubro of rubros) {
        if ((itemsByRubro.get(rubro.id) || []).length > 0 && !next[rubro.id]) {
          next[rubro.id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [user, rubros, itemsByRubro])

  const visibleRubros = useMemo(() => {
    if (!query) return rubros
    return rubros.filter((r) => {
      const items = itemsByRubro.get(r.id) || []
      return items.some((item) => {
        const name = stockItemLabel(item, db.products.find((p) => p.id === item.productId)?.name)
        return nameMatchesQuery(name, query)
      })
    })
  }, [query, rubros, itemsByRubro, db.products])

  const toggleRubro = (id: string) => {
    flushStockEdits()
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const addRubro = () => {
    if (!user) return
    const name = newRubroName.trim()
    if (!name) return
    const exists = rubros.some((r) => r.name.toLowerCase() === name.toLowerCase())
    if (exists) {
      useApp.setState({ toast: 'Ese rubro ya está' })
      return
    }
    const sort = rubros.reduce((m, r) => Math.max(m, r.sort), -1) + 1
    const id = newId()
    apply({
      op: 'upsert',
      col: 'rubros',
      row: { id, name, sort, createdBy: user, createdAt: Date.now() },
    })
    setNewRubroName('')
    setAddingRubro(false)
    setOpen((prev) => ({ ...prev, [id]: true }))
  }

  const addProduct = (rubroId: string, name: string, existingId?: string) => {
    // Sacar de pending antes de flush: evita recursión addProduct → flush → pending → addProduct.
    clearAddQ(rubroId)
    flushStockEdits()
    const { db: liveDb, user: liveUser, apply: liveApply, applyAll: liveApplyAll } = useApp.getState()
    if (!liveUser) return
    const trimmed = name.trim()
    if (!trimmed && !existingId) return
    let productId = existingId
    let productName = trimmed
    if (!productId) {
      const found = liveDb.products.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
      if (found) {
        productId = found.id
        productName = found.name
      } else {
        productId = newId()
        productName = trimmed
      }
    } else {
      productName = liveDb.products.find((p) => p.id === productId)?.name ?? trimmed
    }
    // Tras un ×, applyAll hace flush de pending: no recrear el mismo rubro+producto/nombre.
    if (isStockItemRemoveBlocked({ rubroId, productId, label: productName })) return
    const already = (liveDb.stockItems || []).find(
      (s) => s.productId === productId && s.rubroId === rubroId,
    )
    if (already) {
      setOpen((prev) => ({ ...prev, [rubroId]: true }))
      return
    }
    const isNewProduct = !liveDb.products.some((p) => p.id === productId)
    const row: StockItem = {
      id: newId(),
      rubroId,
      productId,
      qty: 0,
      label: productName,
      createdBy: liveUser,
      createdAt: Date.now(),
    }
    if (isNewProduct) {
      liveApplyAll([
        {
          op: 'upsert',
          col: 'products',
          row: { id: productId, name: productName, createdBy: liveUser, createdAt: Date.now() },
        },
        { op: 'upsert', col: 'stockItems', row },
      ])
    } else {
      liveApply({ op: 'upsert', col: 'stockItems', row })
    }
    setOpen((prev) => ({ ...prev, [rubroId]: true }))
  }

  const addBlankInRubro = (rubroId: string) => {
    flushStockEdits()
    if (!user) return
    // Reusar el vacío existente: varios + seguidos generaban fantasmas que el × no limpiaba del todo.
    const catalog = ensureStockCatalogFromBackup(useApp.getState().db)
    const existingBlank = (catalog.stockItems || []).find((s) => {
      if (s.rubroId !== rubroId) return false
      if (isStockItemRemoveBlocked(s)) return false
      const name = stockItemLabel(s, catalog.products.find((p) => p.id === s.productId)?.name)
      return !name.trim()
    })
    if (existingBlank) {
      setOpen((prev) => ({ ...prev, [rubroId]: true }))
      setFocusItemId(existingBlank.id)
      return
    }
    const productId = newId()
    const itemId = newId()
    applyAll([
      {
        op: 'upsert',
        col: 'products',
        row: { id: productId, name: '', createdBy: user, createdAt: Date.now() },
      },
      {
        op: 'upsert',
        col: 'stockItems',
        row: {
          id: itemId,
          rubroId,
          productId,
          qty: 0,
          createdBy: user,
          createdAt: Date.now(),
        },
      },
    ])
    setOpen((prev) => ({ ...prev, [rubroId]: true }))
    setFocusItemId(itemId)
  }

  const qtyForItem = (item: StockItem): number => {
    const dated = item.qtyByDate?.[stockDate]
    if (Number.isFinite(dated)) return Number(dated) || 0
    // Compatibilidad: si nunca se cargó por fecha, usar qty legacy.
    if (!item.qtyByDate || Object.keys(item.qtyByDate).length === 0) return Number(item.qty) || 0
    // En modo por fecha, si ya hay historial por fecha pero no para ese día, arrancar en 0.
    return 0
  }

  const ensureActiveStockDate = (): string | null => {
    if (!user) return null
    if (activeDate) return activeDate
    const iso = todayISO()
    const order = ensureOrder(db.orders, iso, user, (p) => apply(p), setOrderId)
    return order.date
  }

  const setQtyForItem = (item: StockItem, nextQty: number) => {
    const targetDate = ensureActiveStockDate() || stockDate
    apply({
      op: 'upsert',
      col: 'stockItems',
      row: {
        ...item,
        qty: nextQty,
        qtyByDate: { ...(item.qtyByDate || {}), [targetDate]: nextQty },
      },
    })
  }

  useEffect(() => {
    if (!focusItemId) return
    const el = document.querySelector<HTMLInputElement>(`input[data-stock-item="${focusItemId}"]`)
    el?.focus()
  }, [focusItemId])

  return (
    <div className="page stock-page">
      <div className="stock-top">
        <DateBar mode="create" label="Fecha · cantidades del día" commitOnBlur commitOnMount commitLabel="Ir" />
      </div>
      <header className="page-head">
        <h1>Stock</h1>
        <button
          type="button"
          className="btn ghost stock-add-rubro"
          aria-label="Agregar rubro"
          onClick={() => setAddingRubro((v) => !v)}
        >
          +
        </button>
      </header>
      <div className="stock-scroll">
      <FocusField id="stock-search">
        <label className="search">
          Filtro de producto
          <input
            value={q}
            enterKeyHint="search"
            placeholder="Ej. coca"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </FocusField>
      {addingRubro && (
        <FocusField id="stock-new-rubro">
          <label className="search">
            Nuevo rubro · Enter agrega
            <input
              value={newRubroName}
              autoFocus
              enterKeyHint="go"
              placeholder="Nombre del rubro"
              onChange={(e) => setNewRubroName(e.target.value)}
              onKeyDown={enterTo(addRubro)}
            />
          </label>
        </FocusField>
      )}

      {visibleRubros.length === 0 && query && (
        <p className="empty">Nada coincide con «{query}».</p>
      )}

      <ul className="stock-rubros">
        {visibleRubros.map((rubro) => {
          const checked = !!open[rubro.id]
          const allItems = itemsByRubro.get(rubro.id) || []
          const items = query
            ? allItems.filter((item) => {
                const name = stockItemLabel(item, db.products.find((p) => p.id === item.productId)?.name)
                return nameMatchesQuery(name, query)
              })
            : allItems
          const typed = (addQ[rubro.id] || '').trim()
          const matches = typed
            ? db.products.filter((p) => nameMatchesQuery(p.name, typed)).slice(0, 8)
            : []
          const expanded = checked || (query.length > 0 && items.length > 0)
          return (
            <li key={rubro.id} className={`stock-rubro ${expanded ? 'open' : ''}${query && items.length ? ' hit' : ''}`}>
              <div className="stock-rubro-head">
                <button
                  type="button"
                  className={`stock-check ${checked ? 'on' : 'off'}`}
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`${checked ? 'Cerrar' : 'Abrir'} ${rubro.name}`}
                  onClick={() => toggleRubro(rubro.id)}
                />
                <button type="button" className="stock-rubro-name" onClick={() => toggleRubro(rubro.id)}>
                  {rubro.name}
                  {allItems.length > 0 && <span className="muted"> ({allItems.length})</span>}
                </button>
                {!isDefaultRubro(rubro.id) && (
                  <button
                    type="button"
                    className="icon-x"
                    aria-label={`Borrar ${rubro.name}`}
                    onClick={() => apply({ op: 'remove', col: 'rubros', id: rubro.id })}
                  >
                    ×
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost stock-add-item"
                  aria-label={`Agregar producto en ${rubro.name}`}
                  onClick={() => addBlankInRubro(rubro.id)}
                >
                  +
                </button>
              </div>
              {expanded && (
                <div className="stock-rubro-body">
                  <FocusField id={`stock-add-${rubro.id}`}>
                    <label className="search">
                      Filtro en rubro
                      <input
                        value={addQ[rubro.id] || ''}
                        enterKeyHint="search"
                        placeholder="Ej. bidón 20L"
                        onChange={(e) => patchAddQ(rubro.id, e.target.value)}
                      />
                    </label>
                  </FocusField>
                  {matches.length > 0 && (
                    <ul className="suggest">
                      {matches.map((p) => (
                        <li key={p.id} className="suggest-row">
                          <button type="button" className="pick" onClick={() => addProduct(rubro.id, p.name, p.id)}>
                            {p.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {items.length === 0 && <p className="empty">Sin productos en este rubro.</p>}
                  <ul className="stock-items">
                    {items.map((item) => {
                      const prod = db.products.find((p) => p.id === item.productId)
                      const savedName = stockItemLabel(item, prod?.name)
                      const displayName = item.id in draftNames ? draftNames[item.id] : savedName
                      const hit = !!query && nameMatchesQuery(displayName, query)
                      const commitItemName = (name: string) => {
                        const pending = draftTimerRef.current[item.id]
                        if (pending) {
                          window.clearTimeout(pending)
                          delete draftTimerRef.current[item.id]
                        }
                        commitItemLabelToDb(item.id, name)
                      }
                      return (
                        <li key={item.id} className={`stock-item${hit ? ' hit' : ''}`}>
                          <input
                            className="name-in"
                            value={displayName}
                            aria-label="Producto o descripción"
                            data-stock-item={item.id}
                            autoFocus={focusItemId === item.id}
                            onChange={(e) => patchDraftNames(item.id, e.target.value)}
                            onBlur={(e) => commitItemName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' || e.shiftKey) return
                              e.preventDefault()
                              commitItemName((e.target as HTMLInputElement).value)
                            }}
                          />
                          <label className="qty-in stock-qty">
                            <span>Cant. ({stockDateLabel})</span>
                            <input
                              className="qty-narrow"
                              inputMode="decimal"
                              enterKeyHint="done"
                              value={qtyForItem(item) || ''}
                              onFocus={() => {
                                ensureActiveStockDate()
                              }}
                              onChange={(e) => setQtyForItem(item, parseArNumber(e.target.value))}
                            />
                          </label>
                          <button
                            type="button"
                            className="icon-x"
                            aria-label="Sacar del stock"
                            onClick={() => {
                              const state = useApp.getState()
                              // Incluir backup: fantasmas solo en storage también salen con el ×.
                              const catalog = ensureStockCatalogFromBackup(state.db)
                              const live = catalog.stockItems || []
                              const products = catalog.products || []
                              const drafts = { ...loadStockDraftNames(), ...draftNames }
                              const labelOf = (s: StockItem) => {
                                const draft = (drafts[s.id] || '').trim().toLowerCase()
                                if (draft) return draft
                                return stockItemLabel(
                                  s,
                                  products.find((p) => p.id === s.productId)?.name,
                                )
                                  .trim()
                                  .toLowerCase()
                              }
                              const needle = labelOf(item)
                              const twins = live.filter((s) => {
                                if (s.id === item.id) return true
                                if (s.rubroId !== item.rubroId) return false
                                if (s.productId === item.productId) return true
                                const other = labelOf(s)
                                // Sin nombre: todos los vacíos del rubro son el mismo “fantasma”.
                                if (!needle) return !other
                                return other === needle
                              })
                              const ids = twins.length ? twins.map((s) => s.id) : [item.id]
                              for (const id of ids) {
                                const t = draftTimerRef.current[id]
                                if (t) {
                                  window.clearTimeout(t)
                                  delete draftTimerRef.current[id]
                                }
                              }
                              setDraftNames((prev) => {
                                let changed = false
                                const next = { ...prev }
                                for (const id of ids) {
                                  if (id in next) {
                                    delete next[id]
                                    changed = true
                                  }
                                }
                                if (!changed) return prev
                                saveStockDraftNames(next)
                                return next
                              })
                              // Sincrónico: applyAll hace flush de pending en el mismo tick.
                              // Hay que vaciar addQRef (no solo localStorage/state) o el flusher recrea el fantasma.
                              const pending = loadStockPendingAdds()
                              const typed = (
                                pending[item.rubroId] ||
                                addQRef.current[item.rubroId] ||
                                ''
                              )
                                .trim()
                                .toLowerCase()
                              if (typed && typed === needle) clearAddQ(item.rubroId)
                              if (ids.length === 1) {
                                apply({ op: 'remove', col: 'stockItems', id: ids[0] })
                              } else {
                                applyAll(ids.map((id) => ({ op: 'remove' as const, col: 'stockItems' as const, id })))
                              }
                            }}
                          >
                            ×
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      </div>
    </div>
  )
}
