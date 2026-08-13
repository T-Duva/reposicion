import { Capacitor } from '@capacitor/core'
import { resolveServerOrigin } from './lib/server'

export const LIVE_BUNDLE_KEY = 'reposicion.liveBundle'

/**
 * Antes navegábamos al túnel vivo y se rompía el bridge GPS.
 * Nos quedamos en el WebView nativo; la API sigue yendo al servidor por resolveServerOrigin.
 */
export async function nativeLiveUpdate(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  return false
}

const RELOAD_KEY = 'reposicion.reloadFor'

/** Recarga forzada. En APK no usamos liveBundle remoto (dejaba pantalla negra). */
export async function applyAppUpdate(): Promise<void> {
  sessionStorage.removeItem(RELOAD_KEY)

  try {
    localStorage.removeItem(LIVE_BUNDLE_KEY)
  } catch {
    /* ok */
  }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* seguir */
  }

  if (Capacitor.isNativePlatform()) {
    const url = new URL(location.href)
    url.searchParams.delete('bundled')
    url.searchParams.set('_v', String(Date.now()))
    // Borrar liveBundle en la URL no alcanza: también limpiamos storage arriba.
    window.location.replace(url.toString())
    return
  }

  try {
    const origin = await resolveServerOrigin()
    window.location.replace(`${origin.replace(/\/$/, '')}/?fromApp=1&_v=${Date.now()}`)
    return
  } catch {
    /* fallback */
  }

  const url = new URL(location.href)
  url.searchParams.set('_v', String(Date.now()))
  window.location.replace(url.toString())
}
