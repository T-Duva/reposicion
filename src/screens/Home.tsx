import { formatDateISO, isPastOrderCutoff } from '../lib/format'
import { orderIsPurchased } from '../lib/stats'
import { useApp } from '../state/store'
import { DateBar } from '../components/DateBar'

export function Home() {
  const db = useApp((s) => s.db)
  const setOrderId = useApp((s) => s.setOrderId)
  const setScreen = useApp((s) => s.setScreen)
  const apply = useApp((s) => s.apply)
  const viewOnly = false

  const orders = [...db.orders].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  return (
    <div className="page">
      <DateBar mode="select" />
      <header className="page-head">
        <h1>Órdenes</h1>
      </header>
      <p className="hint">
        {viewOnly
          ? 'Solo mirás órdenes. Enter busca una fecha que ya exista.'
          : 'Acá solo mirás y borrás. Enter busca una fecha que ya exista. Las órdenes nuevas se crean en Planificar.'}
      </p>
      <ul className="order-list">
        {orders.length === 0 && <li className="empty">No hay órdenes. Andá a Planificar y creá una con la fecha + Enter.</li>}
        {orders.map((o) => {
          const bought = orderIsPurchased(db, o.id)
          return (
            <li key={o.id} className="order-wrap">
              <button
                type="button"
                className="order-row"
                onClick={() => {
                  setOrderId(o.id)
                  setScreen(viewOnly || !bought ? 'plan' : 'buy')
                }}
              >
                <strong>{formatDateISO(o.date)}</strong>
                {bought && isPastOrderCutoff(o.date) && <span className="pill ok">Comprado</span>}
              </button>
              {!viewOnly && (
                <button
                  type="button"
                  className="icon-x"
                  aria-label="Borrar orden"
                  onClick={() => {
                    apply({ op: 'remove', col: 'orders', id: o.id })
                    if (useApp.getState().orderId === o.id) setOrderId(null)
                  }}
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
