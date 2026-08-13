import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { LIVE_BUNDLE_KEY } from './nativeBoot.ts'

async function dropServiceWorkers() {
  if (!('serviceWorker' in navigator)) return
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
}

function clearBrokenLiveBundle() {
  try {
    localStorage.removeItem(LIVE_BUNDLE_KEY)
  } catch {
    /* privado */
  }
  try {
    window.__Reposicion_LIVE__ = null
  } catch {
    /* ok */
  }
}

function paint() {
  const el = document.getElementById('root')
  if (!el) return
  createRoot(el).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

async function start() {
  // Nunca bloquear el arranque por un liveBundle roto (pantalla negra).
  clearBrokenLiveBundle()

  const fromApp = new URLSearchParams(location.search).has('fromApp')
  const native = Capacitor.isNativePlatform()

  paint()

  if (native) {
    try {
      void StatusBar.setOverlaysWebView({ overlay: false })
      void StatusBar.setBackgroundColor({ color: '#070708' })
      void StatusBar.setStyle({ style: Style.Dark })
    } catch {
      /* sin plugin */
    }
  }

  if (native || fromApp) {
    try {
      sessionStorage.setItem('reposicion.fromApp', '1')
    } catch {
      /* privado */
    }
    void dropServiceWorkers()
  } else {
    registerSW({ immediate: true })
  }
}

void start()
