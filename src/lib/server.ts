import { Capacitor, CapacitorHttp } from '@capacitor/core'

declare global {
  interface Window {
    RpNative?: {
      httpGet: (url: string, headersJson: string, timeoutMs: number) => string
      httpPost: (url: string, headersJson: string, body: string, timeoutMs: number) => string
      bootstrapConnect: () => string
      connectDiag: () => string
    }
  }
}

const DISCOVERY_URLS = [
  'https://api.github.com/repos/T-Duva/reposicion/contents/server.json?ref=master',
  'https://raw.githubusercontent.com/T-Duva/reposicion/master/server.json',
]
/** Túneles HTTPS conocidos (probados primero). GitHub después. Nunca LAN. */
const TUNNELS = [
  'https://noon-mhz-graphic-prior.trycloudflare.com',
]
const HEALTH_MS = 10000
const HEALTH_MS_NATIVE = 20000
const DISCOVERY_MS = 8000

let cached: string | null = null
let lastConnectHint = ''

export function getLastConnectHint() {
  return lastConnectHint
}

export function isNativeApp(): boolean {
  if (Capacitor.isNativePlatform()) return true
  try {
    if (sessionStorage.getItem('reposicion.fromApp') === '1') return true
  } catch {
    /* modo privado */
  }
  return new URLSearchParams(location.search).has('fromApp')
}

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

function nativeHttpRequest(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body: string,
  ms: number,
): { status: number; text: string; contentType: string } | null {
  if (!isNativeAndroid() || !isExternalHttps(url)) return null
  const bridge = typeof window !== 'undefined' ? window.RpNative : undefined
  if (!bridge) {
    lastConnectHint = 'sin puente RpNative'
    return null
  }
  if (method === 'POST' && !bridge.httpPost) {
    lastConnectHint = 'nativo: sin httpPost'
    return null
  }
  if (method === 'GET' && !bridge.httpGet) {
    lastConnectHint = 'nativo: sin httpGet'
    return null
  }
  try {
    const hdrJson = JSON.stringify(headers || {})
    const timeout = Math.max(3000, ms)
    const raw =
      method === 'POST'
        ? bridge.httpPost(url, hdrJson, body || '', timeout)
        : bridge.httpGet(url, hdrJson, timeout)
    const j = JSON.parse(raw) as { ok?: boolean; status?: number; text?: string; contentType?: string; error?: string }
    if (!j.ok) {
      lastConnectHint = `nativo: ${String(j.error || 'falló').slice(0, 80)}`
      return null
    }
    return {
      status: Number(j.status) || 0,
      text: String(j.text || ''),
      contentType: String(j.contentType || ''),
    }
  } catch (e) {
    lastConnectHint = `nativo: ${String((e as Error).message || e).slice(0, 80)}`
    return null
  }
}

/** Android: conexión 100% nativa leyendo server.json del APK (sin WebView). */
export function nativeBootstrapConnect(): string | null {
  if (!isNativeAndroid()) return null
  const bridge = typeof window !== 'undefined' ? window.RpNative : undefined
  if (!bridge?.bootstrapConnect) return null
  try {
    const j = JSON.parse(bridge.bootstrapConnect()) as {
      ok?: boolean
      url?: string
      error?: string
      httpStatus?: number
    }
    if (j.ok && j.url) {
      setServerOrigin(j.url)
      lastConnectHint = ''
      return j.url
    }
    if (j.error) lastConnectHint = `bootstrap: ${String(j.error).slice(0, 80)}`
    else if (j.httpStatus) lastConnectHint = `bootstrap HTTP ${j.httpStatus}`
    return null
  } catch (e) {
    lastConnectHint = `bootstrap: ${String((e as Error).message || e).slice(0, 80)}`
    return null
  }
}

function probeMs(base = HEALTH_MS) {
  return Capacitor.isNativePlatform() ? Math.max(base, HEALTH_MS_NATIVE) : base
}

function hereOrigin(): string {
  return `${location.protocol}//${location.host}`
}

function isPrivateOrLoopbackHost(h: string): boolean {
  const host = h.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (host.endsWith('.localhost')) return true
  if (host.endsWith('.local')) return true
  if (host === 'appassets.androidplatform.net') return true
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true
  return false
}

function isBundledHost(): boolean {
  const h = location.hostname.toLowerCase()
  return (
    location.protocol === 'capacitor:' ||
    location.protocol === 'file:' ||
    h === 'appassets.androidplatform.net' ||
    isPrivateOrLoopbackHost(h)
  )
}

function isExternalHttps(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return !isPrivateOrLoopbackHost(u.hostname)
  } catch {
    return false
  }
}

function looksLikeAppOrigin(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    if (isPrivateOrLoopbackHost(h)) return false
    if (h === 'api.github.com' || h === 'github.com') return false
    if (h.endsWith('githubusercontent.com')) return false
    if (h.endsWith('jsdelivr.net')) return false
    return true
  } catch {
    return false
  }
}

function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'bypass-tunnel-reminder': '1',
    Accept: 'application/json',
    'User-Agent': 'REPOSICION-app',
    ...(extra || {}),
  }
}

function looksLikeJsonBody(text: string, contentType: string): boolean {
  const t = String(text || '')
    .replace(/^\uFEFF/, '')
    .trim()
  if (!t) return false
  if (t.startsWith('<')) return false
  if (contentType.toLowerCase().includes('text/html')) return false
  return t.startsWith('{') || t.startsWith('[')
}

function extractOrigin(text: string): string | null {
  const raw = text.replace(/^\uFEFF/, '').trim()
  let j: { url?: string; content?: string; encoding?: string }
  try {
    j = JSON.parse(raw) as { url?: string; content?: string; encoding?: string }
  } catch {
    return null
  }
  const cleanUrl = (u?: string) =>
    String(u || '')
      .replace(/\s+/g, '')
      .replace(/\/$/, '')
  if (typeof j.content === 'string' && j.content.length > 8) {
    try {
      const decoded = JSON.parse(atob(j.content.replace(/\n/g, ''))) as { url?: string }
      const u = cleanUrl(decoded.url)
      if (u && looksLikeAppOrigin(u)) return u
    } catch {
      /* no era base64 de server.json */
    }
  }
  if (j.url) {
    const u = cleanUrl(j.url)
    return looksLikeAppOrigin(u) ? u : null
  }
  return null
}

function parseHealthJson(text: string): { app?: string; appId?: string; ok?: boolean; publicUrl?: string } | null {
  const t = text.replace(/^\uFEFF/, '').trim()
  if (!t.startsWith('{')) return null
  try {
    return JSON.parse(t) as { app?: string; appId?: string; ok?: boolean; publicUrl?: string }
  } catch {
    return null
  }
}

function healthLooksLikeReposicion(j: { app?: string; appId?: string; ok?: boolean }): boolean {
  if (j.app && j.app !== 'reposicion') return false
  if (j.appId && j.appId !== 'com.ligux.reposicion') return false
  if (j.app !== 'reposicion' && j.appId !== 'com.ligux.reposicion') return false
  if (j.ok === false) return false
  return true
}

/** Si el servidor responde, usar su URL pública canónica (misma para Tomás y Martín). */
function adoptPublicUrl(j: { publicUrl?: string } | null | undefined) {
  const u = String(j?.publicUrl || '')
    .replace(/\s+/g, '')
    .replace(/\/$/, '')
  if (u && looksLikeAppOrigin(u)) setServerOrigin(u)
}

async function viaCapacitorGet(
  url: string,
  headers: Record<string, string>,
  ms: number,
): Promise<{ status: number; text: string; contentType: string } | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: ms,
      readTimeout: ms,
      responseType: 'text',
    })
    const data = res.data
    const text = typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data)
    const contentType = String(
      (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || '',
    )
    return { status: res.status, text, contentType }
  } catch (e) {
    lastConnectHint = `CapacitorHttp: ${String((e as Error).message || e).slice(0, 80)}`
    return null
  }
}

/** Android: HTTPS externo sale por RpNative/CapacitorHttp — el WebView/XHR no llega a internet. */
export async function getText(
  url: string,
  ms: number,
  headers: Record<string, string>,
): Promise<{ status: number; text: string; contentType: string } | null> {
  const hdrs = apiHeaders(headers)
  const timeout = probeMs(ms)

  const accept = (got: { status: number; text: string; contentType: string } | null) => {
    if (!got || got.status < 200 || got.status >= 300) return null
    if (!looksLikeJsonBody(got.text, got.contentType)) {
      lastConnectHint = 'respuesta HTML (túnel)'
      return null
    }
    return got
  }

  if (isNativeAndroid() && isExternalHttps(url)) {
    const native = accept(nativeHttpRequest('GET', url, hdrs, '', timeout))
    if (native) return native
    const cap = accept(await viaCapacitorGet(url, hdrs, timeout))
    if (cap) return cap
    return null
  }

  if (Capacitor.isNativePlatform() && isExternalHttps(url)) {
    const cap = accept(await viaCapacitorGet(url, hdrs, timeout))
    if (cap) return cap
    return null
  }

  const viaFetch = async () => {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), timeout)
    try {
      const r = await fetch(url, {
        cache: 'no-store',
        signal: ctrl.signal,
        headers: hdrs,
      })
      return {
        status: r.status,
        text: await r.text(),
        contentType: r.headers.get('content-type') || '',
      }
    } catch {
      return null
    } finally {
      window.clearTimeout(t)
    }
  }

  const fromFetch = accept(await viaFetch())
  if (fromFetch) return fromFetch

  if (Capacitor.isNativePlatform()) {
    return accept(await viaCapacitorGet(url, hdrs, timeout))
  }
  return null
}

export async function postJson(
  url: string,
  body: unknown,
  ms: number,
  headers?: Record<string, string>,
): Promise<{ status: number; text: string; contentType: string } | null> {
  const hdrs = apiHeaders({
    'Content-Type': 'application/json',
    ...(headers || {}),
  })
  const rawBody = JSON.stringify(body)
  const timeout = probeMs(ms)

  if (isNativeAndroid() && isExternalHttps(url)) {
    const native = nativeHttpRequest('POST', url, hdrs, rawBody, timeout)
    if (native) return native
    try {
      const res = await CapacitorHttp.post({
        url,
        headers: hdrs,
        data: rawBody,
        connectTimeout: timeout,
        readTimeout: timeout,
        responseType: 'text',
      })
      const data = res.data
      const text = typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data)
      const contentType = String(
        (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || '',
      )
      return { status: res.status, text, contentType }
    } catch {
      return null
    }
  }

  if (Capacitor.isNativePlatform() && isExternalHttps(url)) {
    try {
      const res = await CapacitorHttp.post({
        url,
        headers: hdrs,
        data: rawBody,
        connectTimeout: timeout,
        readTimeout: timeout,
        responseType: 'text',
      })
      const data = res.data
      const text = typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data)
      const contentType = String(
        (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || '',
      )
      return { status: res.status, text, contentType }
    } catch {
      return null
    }
  }

  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: hdrs,
      body: rawBody,
    })
    return {
      status: r.status,
      text: await r.text(),
      contentType: r.headers.get('content-type') || '',
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(t)
  }
}

async function healthy(origin: string, ms = HEALTH_MS): Promise<boolean> {
  if (!looksLikeAppOrigin(origin)) return false
  const url = `${origin.replace(/\/$/, '')}/api/health?t=${Date.now()}`
  lastConnectHint = `probando ${origin.replace(/^https:\/\//, '')}`
  const got = await getText(url, ms, apiHeaders())
  if (!got) return false
  const j = parseHealthJson(got.text)
  if (!j || !healthLooksLikeReposicion(j)) {
    lastConnectHint = 'health inválido'
    return false
  }
  adoptPublicUrl(j)
  lastConnectHint = ''
  return true
}

async function readBundledServerUrl(): Promise<string | null> {
  if (!isBundledHost()) return null
  const origin = hereOrigin()
  const bases = [
    `${origin}/server.json`,
    '/server.json',
    `${origin}/assets/public/server.json`,
    '/assets/public/server.json',
  ]
  for (const base of bases) {
    const got = await getText(`${base}?t=${Date.now()}`, 6000, apiHeaders())
    if (!got) continue
    const url = extractOrigin(got.text)
    if (url) return url
  }
  return null
}

async function readDiscoveryCandidates(): Promise<string[]> {
  const urls = DISCOVERY_URLS.map((u) => `${u}${u.includes('?') ? '&' : '?'}t=${Date.now()}`)
  const hits = await Promise.all(
    urls.map(async (url) => {
      const got = await getText(url, probeMs(DISCOVERY_MS), {
        Accept: 'application/vnd.github.raw+json, application/json',
        'bypass-tunnel-reminder': '1',
        'User-Agent': 'REPOSICION-app',
      })
      if (!got) return null
      return extractOrigin(got.text)
    }),
  )
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of hits) {
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

async function tryHealthyOrigin(
  origin: string | null | undefined,
  tried: Set<string>,
  ms?: number,
): Promise<string | null> {
  if (!origin) return null
  const url = origin.replace(/\/$/, '')
  if (!looksLikeAppOrigin(url)) return null
  if (tried.has(url)) return null
  tried.add(url)
  if (await healthy(url, ms ?? HEALTH_MS)) {
    setServerOrigin(url)
    return url
  }
  return null
}

async function firstLive(
  candidates: Array<string | null | undefined>,
  tried: Set<string>,
): Promise<string | null> {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    if (!c) continue
    const url = c.replace(/\/$/, '')
    if (!looksLikeAppOrigin(url)) continue
    if (seen.has(url) || tried.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  if (!urls.length) return null
  return await new Promise((resolve) => {
    let left = urls.length
    let settled = false
    for (const url of urls) {
      tried.add(url)
      void healthy(url).then((ok) => {
        if (settled) return
        if (ok) {
          settled = true
          setServerOrigin(url)
          resolve(url)
          return
        }
        left -= 1
        if (left === 0) resolve(null)
      })
    }
  })
}

export async function resolveServerOrigin(): Promise<string> {
  const here = hereOrigin()
  const tried = new Set<string>()

  if (isNativeAndroid()) {
    const boot = nativeBootstrapConnect()
    if (boot) return boot
  }

  if (!isBundledHost() && looksLikeAppOrigin(here)) {
    const ok = await tryHealthyOrigin(here, tried)
    if (ok) return ok
  }

  const bundled = isBundledHost() ? await readBundledServerUrl() : null
  const discovered = await readDiscoveryCandidates()
  const fromLive = await firstLive([...TUNNELS, ...discovered, bundled], tried)
  if (fromLive) return fromLive

  const saved = localStorage.getItem('reposicion.server')
  const savedOk = looksLikeAppOrigin(saved || '') ? await tryHealthyOrigin(saved, tried) : null
  if (savedOk) return savedOk
  if (saved && !looksLikeAppOrigin(saved)) {
    try {
      localStorage.removeItem('reposicion.server')
    } catch {
      /* ok */
    }
  }

  const fromMem = await tryHealthyOrigin(cached, tried)
  if (fromMem) return fromMem

  throw new Error(lastConnectHint || 'Sin servidor REPOSICION')
}

export async function resolveHealthyOrigin(): Promise<string> {
  cached = null
  try {
    localStorage.removeItem('reposicion.server')
  } catch {
    /* modo privado */
  }
  return resolveServerOrigin()
}

export function setServerOrigin(url: string) {
  const clean = url.replace(/\/$/, '')
  if (!looksLikeAppOrigin(clean)) return
  cached = clean
  localStorage.setItem('reposicion.server', cached)
}

export function clearServerOrigin() {
  cached = null
  try {
    localStorage.removeItem('reposicion.server')
  } catch {
    /* ok */
  }
}
