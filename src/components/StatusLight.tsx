import { useApp } from '../state/store'
import type { WatcherStatus } from '../types'

/** Solo 4 luces: verde / amarillo / rojo / gris. El número abajo = pendientes en cola. */
function displayStatus(raw: WatcherStatus): 'online' | 'working' | 'stuck' | 'off' {
  if (raw === 'working') return 'working'
  if (raw === 'stuck') return 'stuck'
  if (raw === 'off') return 'off'
  // online | pending → Escuchando (verde)
  return 'online'
}

const LABELS = {
  online: 'Escuchando',
  working: 'Trabajando',
  stuck: 'Trabado',
  off: 'Apagado',
} as const

export function StatusLight() {
  const watcher = useApp((s) => s.watcher)
  const connected = useApp((s) => s.connected)

  const status = !connected ? 'off' : displayStatus(watcher.status || 'off')
  const count = connected ? Math.max(0, Number(watcher.pendingCount) || 0) : 0

  return (
    <div className="light-wrap">
      <button
        type="button"
        className={`light-btn light-${status}`}
        title={!connected ? 'Sin conexión — guardado en el celular' : `Escucha: ${LABELS[status]}`}
        aria-label={LABELS[status]}
      >
        <span className="light-dot" />
        <span className="light-txt">{LABELS[status]}</span>
      </button>
      <span className="pending-count" aria-label={`${count} pendientes`}>
        {count}
      </span>
    </div>
  )
}
