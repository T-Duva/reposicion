import { Capacitor } from '@capacitor/core'

const DISCOVERY_URLS = [
  'https://raw.githubusercontent.com/T-Duva/reposicion/master/server.json',
  'https://cdn.jsdelivr.net/gh/T-Duva/reposicion@master/server.json',
  'https://raw.githubusercontent.com/T-Duva/reposicion/main/server.json',
]
const FALLBACKS = [
  'https://frfebc-ip-181-117-8-15.tunnelmole.net',
  'http://192.168.1.27:8788',
]

let cached: string | null = null

export function isNativeApp(): boolean {
  if (Capacitor.isNativePlatform()) return true
  try {
    if (sessionStorage.getItem('reposicion.fromApp') === '1') return true
  } catch {
    /* modo privado */
  }
  return new URLSearchParams(location.search).has('fromApp')
}

function hereOrigin(): string {
  return `${location.protocol}//${location.host}`
}

function isBundledHost(): boolean {
  const h = location.hostname
  return (
    location.protocol === 'capacitor:' ||
    /^localhost$|^127\.0\.0\.1$/i.test(h) ||
    h.endsWith('.localhost')
  )
}

async function healthy(origin: string): Promise<boolean> {
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), 3500)
  try {
    const r = await fetch(`${origin.replace(/\/$/, '')}/api/health?t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    })
    return r.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(t)
  }
}

async function readDiscovery(): Promise<string | null> {
  const urls = DISCOVERY_URLS.map((u) => `${u}?t=${Date.now()}`)
  const hits = await Promise.all(
    urls.map(async (url) => {
      const ctrl = new AbortController()
      const t = window.setTimeout(() => ctrl.abort(), 5000)
      try {
        const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal })
        if (!r.ok) return null
        const j = (await r.json()) as { url?: string }
        return j.url ? j.url.replace(/\/$/, '') : null
      } catch {
        return null
      } finally {
        window.clearTimeout(t)
      }
    }),
  )
  return hits.find(Boolean) ?? null
}

async function tryHealthyOrigin(
  origin: string | null | undefined,
  tried: Set<string>,
): Promise<string | null> {
  if (!origin) return null
  const url = origin.replace(/\/$/, '')
  if (tried.has(url)) return null
  tried.add(url)
  if (await healthy(url)) {
    setServerOrigin(url)
    return url
  }
  return null
}

export async function resolveServerOrigin(): Promise<string> {
  const here = hereOrigin()
  const tried = new Set<string>()

  const tryOne = (origin: string | null | undefined) => tryHealthyOrigin(origin, tried)

  if (!isBundledHost()) {
    const ok = await tryOne(here)
    if (ok) return ok
  } else {
    // APK: la URL del tunel cambia; GitHub primero, no confiar en cache vieja.
    const discovered = await readDiscovery()
    const fromDisc = await tryOne(discovered)
    if (fromDisc) return fromDisc
    for (const fb of FALLBACKS) {
      const ok = await tryOne(fb)
      if (ok) return ok
    }
  }

  const saved = localStorage.getItem('reposicion.server')
  const fromSaved = await tryOne(saved)
  if (fromSaved) return fromSaved
  if (saved) localStorage.removeItem('reposicion.server')

  const fromMem = await tryOne(cached)
  if (fromMem) return fromMem

  const discovered = await readDiscovery()
  const fromDisc = await tryOne(discovered)
  if (fromDisc) return fromDisc
  for (const fb of FALLBACKS) {
    const ok = await tryOne(fb)
    if (ok) return ok
  }

  cached = here
  return cached
}

/** Para compartir enlace APK: solo URL comprobada con /api/health. */
export async function resolveHealthyOrigin(): Promise<string> {
  cached = null
  try {
    localStorage.removeItem('reposicion.server')
  } catch {
    /* modo privado */
  }

  const tried = new Set<string>()
  const discovered = await readDiscovery()
  const fromDisc = await tryHealthyOrigin(discovered, tried)
  if (fromDisc) return fromDisc
  for (const fb of FALLBACKS) {
    const ok = await tryHealthyOrigin(fb, tried)
    if (ok) return ok
  }
  throw new Error('Sin servidor')
}

export function setServerOrigin(url: string) {
  cached = url.replace(/\/$/, '')
  localStorage.setItem('reposicion.server', cached)
}





