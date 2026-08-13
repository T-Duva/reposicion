import { describeAudit } from '../lib/auditText'
import { USER_LABEL } from '../types'
import { useApp } from '../state/store'

export function Historial() {
  const db = useApp((s) => s.db)
  const logs = [...db.audit]
    .filter((a) => !a.field.startsWith('notifications.'))
    .sort((a, b) => b.at - a.at)
    .slice(0, 200)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Historial</h1>
      </header>
      <p className="hint">Quién tocó qué.</p>
      <ul className="audit-list">
        {logs.length === 0 && <li className="empty">Todavía no hay cambios.</li>}
        {logs.map((a) => (
          <li key={a.id} className={`audit ${a.user}`}>
            <strong>{USER_LABEL[a.user]}</strong>
            <p>{describeAudit(a, db)}</p>
            <time>{new Date(a.at).toLocaleString('es-AR')}</time>
          </li>
        ))}
      </ul>
    </div>
  )
}
