import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { resolveServerOrigin } from './server'

type Coords = { latitude: number; longitude: number }

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err && 'message' in err) return String((err as { message: unknown }).message)
  return String(err ?? '')
}

function errCode(err: unknown): string {
  if (typeof err === 'object' && err && 'code' in err) return String((err as { code: unknown }).code)
  return ''
}

function friendlyGeoError(err: unknown): Error {
  const msg = errMsg(err)
  const code = errCode(err)
  if (/GLOC-0003|OS-PLUG-GLOC-0003|denegad|denied/i.test(`${msg} ${code}`) || (err as GeolocationPositionError)?.code === 1) {
    return new Error('Permiso de ubicación denegado. Activalo en Ajustes de la app.')
  }
  if (/GLOC-0007|GLOC-0017|OS-PLUG-GLOC-0007|OS-PLUG-GLOC-0017|disabled|desactiv|apagad|not enabled/i.test(`${msg} ${code}`)) {
    return new Error('Activá la ubicación del celular (GPS).')
  }
  if (/GLOC-0010|OS-PLUG-GLOC-0010|timeout/i.test(`${msg} ${code}`) || (err as GeolocationPositionError)?.code === 3) {
    return new Error('Timeout al leer GPS. Salí al aire libre un segundo e intentá de nuevo.')
  }
  if (msg) return new Error(msg.slice(0, 180))
  return new Error('No se pudo obtener la ubicación.')
}

function posToCoords(pos: { coords: { latitude: number; longitude: number } }): Coords {
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
}

/** Devuelve la primera promesa que resuelva; si todas fallan, lanza el último error. */
async function firstOk<T>(tasks: Array<() => Promise<T>>): Promise<T> {
  if (!tasks.length) throw new Error('no tasks')
  return new Promise((resolve, reject) => {
    let pending = tasks.length
    let lastErr: unknown
    for (const run of tasks) {
      run()
        .then(resolve)
        .catch((e) => {
          lastErr = e
          pending -= 1
          if (pending === 0) reject(lastErr instanceof Error ? lastErr : new Error(String(lastErr)))
        })
    }
  })
}

async function getNativeCoords(): Promise<Coords> {
  // getCurrentPosition ya pide/chequea permiso en el plugin nativo.
  // No pre-chequear a mano: en algunos casos tira GLOC-0018 falso y la app pedía "reinstalá".
  try {
    await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] })
  } catch {
    /* seguir: a veces el permiso ya está y request falla por otro motivo */
  }

  try {
    return await firstOk([
      () =>
        Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 300_000,
          enableLocationFallback: true,
        }).then(posToCoords),
      () =>
        Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 30_000,
          enableLocationFallback: true,
        }).then(posToCoords),
    ])
  } catch (e) {
    throw e instanceof Error ? e : new Error(errMsg(e) || 'native geo failed')
  }
}

function getBrowserCoords(): Promise<Coords> {
  if (!navigator.geolocation) {
    return Promise.reject(new Error('Geolocalización no disponible en este WebView'))
  }
  const ask = (high: boolean) =>
    new Promise<Coords>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(posToCoords(pos)),
        (err) => reject(err ?? new Error('geolocation failed')),
        { enableHighAccuracy: high, timeout: high ? 15000 : 8000, maximumAge: high ? 30_000 : 300_000 },
      )
    })
  return firstOk([() => ask(false), () => ask(true)])
}

async function getCoords(): Promise<Coords> {
  const native = Capacitor.isNativePlatform()
  const pluginOk = Capacitor.isPluginAvailable('Geolocation')
  const errors: string[] = []

  if (native && pluginOk) {
    try {
      return await getNativeCoords()
    } catch (e) {
      errors.push(`nativo: ${errCode(e) || errMsg(e)}`)
    }
  }

  // Fallback: GPS del WebView (Capacitor ya concede si Android dio el permiso).
  try {
    return await getBrowserCoords()
  } catch (e) {
    errors.push(`webview: ${errMsg(e)}`)
    if (errors.length === 1) throw friendlyGeoError(e)
    throw new Error(friendlyGeoError(e).message)
  }
}

async function fetchReverseGeocode(base: string, lat: number, lon: number): Promise<string> {
  const qs = `lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`
  const url = base.startsWith('/')
    ? `${base}?${qs}`
    : `${base.replace(/\/$/, '')}/api/reverse-geocode?${qs}`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) throw new Error('reverse failed')
  const data = (await res.json()) as { display_name?: string }
  if (!data.display_name) throw new Error('no address')
  return data.display_name
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const saved = localStorage.getItem('reposicion.server')
    if (saved) return await fetchReverseGeocode(saved, lat, lon)
  } catch {
    /* seguir */
  }
  try {
    const origin = await resolveServerOrigin()
    if (origin) return await fetchReverseGeocode(origin, lat, lon)
  } catch {
    /* relativa */
  }
  return fetchReverseGeocode('/api/reverse-geocode', lat, lon)
}

export async function geolocateAddress(onStage?: (msg: string) => void): Promise<string> {
  onStage?.('Buscando ubicación…')
  const { latitude, longitude } = await getCoords()
  onStage?.('Buscando dirección…')
  try {
    return await reverseGeocode(latitude, longitude)
  } catch {
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
  }
}
