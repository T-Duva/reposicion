import { useEffect, useState, type ReactNode } from 'react'
import { copyApkDownloadUrl } from '../lib/apkUrl'
import { resolveHealthyOrigin } from '../lib/server'
import { userScreens } from '../lib/userAccess'
import { StatusLight } from './StatusLight'
import { ReportModal } from './ReportModal'
import { otherUser, useApp } from '../state/store'
import { scrollFieldIntoView } from '../lib/scrollField'
import { APP_VERSION } from '../version'
import { USER_LABEL, type Screen } from '../types'

const NAV: { id: Screen; label: string }[] = [
  { id: 'home', label: 'Órdenes' },
  { id: 'plan', label: 'Planificar' },
  { id: 'buy', label: 'Comprar' },
  { id: 'discounts', label: 'Descuentos' },
  { id: 'split', label: 'Repartir' },
  { id: 'accounts', label: 'Cuentas' },
]

export function Shell({ children }: { children: ReactNode }) {
  const screen = useApp((s) => s.screen)
  const setScreen = useApp((s) => s.setScreen)
  const setReportOpen = useApp((s) => s.setReportOpen)
  const user = useApp((s) => s.user)
  const logout = useApp((s) => s.logout)
  const presence = useApp((s) => s.presence)
  const toast = useApp((s) => s.toast)
  const connected = useApp((s) => s.connected)
  const pendingSync = useApp((s) => s.pendingSync)
  const clearToast = useApp((s) => s.clearToast)
  const db = useApp((s) => s.db)
  const mark = useApp((s) => s.markNotifRead)
  const setToast = useApp.setState
  const [apkBusy, setApkBusy] = useState(false)
  const other = user ? otherUser(user) : null
  const otherHere = other && presence.find((p) => p.user === other && Date.now() - p.updatedAt < 10000)
  const notifs = user ? db.notifications.filter((n) => n.to === user && !n.read).slice(-3) : []
  const screens = user ? userScreens(user) : NAV.map((n) => n.id)

  useEffect(() => {
    const lock = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }
    window.addEventListener('scroll', lock, { passive: true })
    return () => window.removeEventListener('scroll', lock)
  }, [])

  // Con teclado abierto (Android) achicar el shell al visualViewport para poder scrollear la lista.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const apply = () => {
      const full = window.innerHeight || 0
      const h = Math.max(280, Math.round(vv.height || full))
      const kb = Math.max(0, Math.round(full - vv.height - vv.offsetTop))
      document.documentElement.style.setProperty('--vv-height', `${h}px`)
      document.documentElement.style.setProperty('--kb-offset', `${kb}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    return () => {
      vv.removeEventListener('resize', apply)
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-11" src="/icons/icon-192.png" width={42} height={42} alt="" />
          <div>
            <small>
              v{APP_VERSION}
              {user ? ` · ${USER_LABEL[user]}` : ''}
              {otherHere ? ` · ${USER_LABEL[otherHere.user]} en ${navLabel(otherHere.screen)}` : ''}
            </small>
          </div>
        </div>
        <div className="top-actions">
          <div className="status-stack">
            <StatusLight />
            <button
              type="button"
              className="btn ghost apk-link-btn"
              disabled={apkBusy}
              onClick={() => {
                setApkBusy(true)
                void (async () => {
                  try {
                    const origin = await resolveHealthyOrigin()
                    await copyApkDownloadUrl(origin)
                    setToast({
                      toast:
                        'Enlace APK copiado. Reinstalá solo si falla ubicación. Lo guardado con luz verde se sincroniza solo.',
                    })
                  } catch {
                    setToast({ toast: 'No hay servidor en línea para el enlace APK' })
                  } finally {
                    setApkBusy(false)
                  }
                })()
              }}
            >
              {apkBusy ? '…' : 'Enlace APK'}
            </button>
          </div>
          <button type="button" className="btn report" onClick={() => setReportOpen(true)}>
            Reportar
          </button>
          <button type="button" className="linkish" onClick={logout}>
            Salir
          </button>
        </div>
      </header>

      {!connected && (
        <p className="banner">
          Sin conexión — todo se guarda en el celular. Se sube solo al tener internet o al despertar (8:00).
          {pendingSync > 0 ? ` · ${pendingSync} pendiente(s)` : ''}
        </p>
      )}
      {notifs.map((n) => (
        <button type="button" key={n.id} className="banner" onClick={() => mark(n.id)}>
          <strong>{n.title}</strong>
          <span>{n.body}</span>
        </button>
      ))}
      {toast && (
        <button type="button" className={`banner ${toast.startsWith('No da') ? '' : 'ok'}`} onClick={clearToast}>
          {toast}
        </button>
      )}

      <main className="main" onFocusCapture={scrollFieldIntoView}>
        {children}
      </main>

      <nav className="tabbar">
        {NAV.filter((n) => screens.includes(n.id)).map((n) => (
          <button key={n.id} type="button" className={screen === n.id ? 'on' : ''} onClick={() => setScreen(n.id)}>
            {n.label}
          </button>
        ))}
        {screens.includes('audit') && (
          <button type="button" className={screen === 'audit' ? 'on' : ''} onClick={() => setScreen('audit')}>
            Log
          </button>
        )}
      </nav>

      <ReportModal />
    </div>
  )
}

function navLabel(s: Screen): string {
  return NAV.find((n) => n.id === s)?.label ?? s
}
