import { useEffect, useState } from 'react'
import { resolveServerOrigin } from '../lib/server'
import { applyAppUpdate } from '../nativeBoot'
import { APP_VERSION } from '../version'

const RELOAD_KEY = 'reposicion.reloadFor'

/** true solo si remote es más nueva que local (no si solo difieren). */
function isNewer(remote: string, local: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('.')
      .map((x) => Number.parseInt(x, 10) || 0)
  const a = parse(remote)
  const b = parse(local)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export function UpdateBanner() {
  const [remote, setRemote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stop = false
    const check = async () => {
      try {
        const origin = await resolveServerOrigin()
        const r = await fetch(`${origin}/api/health?t=${Date.now()}`, { cache: 'no-store' })
        const j = (await r.json()) as { version?: string }
        if (!stop && j.version) setRemote(j.version)
      } catch {
        /* sin red */
      }
    }
    void check()
    const id = window.setInterval(check, 15_000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [])

  const needsUpdate = Boolean(remote && isNewer(remote, APP_VERSION))

  if (!needsUpdate) return null

  return (
    <div className="update-overlay" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="update-modal">
        <strong id="update-title">Hay una versión nueva</strong>
        <span>
          v{APP_VERSION} → v{remote}
        </span>
          <p className="update-hint">Tocá Actualizar. Si queda pantalla negra: Enlace APK e instalá.</p>
        <button
          type="button"
          className="btn update-btn big"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            sessionStorage.removeItem(RELOAD_KEY)
            void applyAppUpdate()
          }}
        >
          {busy ? '…' : 'Actualizar'}
        </button>
      </div>
    </div>
  )
}
