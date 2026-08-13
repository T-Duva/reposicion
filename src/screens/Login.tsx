import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { stationNamesLine } from '../lib/format'
import { LOGIN_PASS } from '../lib/loginPass'
import { APP_NAME, APP_VERSION } from '../version'
import { useApp } from '../state/store'
import type { UserId } from '../types'

function normalizeUser(raw: string): UserId | null {
  const t = raw.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (t === 'tomas') return 'tomas'
  if (t === 'martin') return 'martin'
  return null
}

export function Login() {
  const login = useApp((s) => s.login)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const passRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const id = normalizeUser(user)
    if (!id || pass !== LOGIN_PASS[id]) {
      setErr('Usuario o contraseña incorrectos')
      return
    }
    login(id)
  }

  const onKey = (field: 'user' | 'pass') => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (field === 'user' && !pass) {
      passRef.current?.focus()
      return
    }
    formRef.current?.requestSubmit()
  }

  return (
    <div className="login-wrap">
      <div className="login-mark" aria-hidden>
        R
      </div>
      <form className="login-card" ref={formRef} onSubmit={onSubmit}>
        <p className="eyebrow">Reposición · {stationNamesLine()}</p>
        <img className="login-icon" src="/icons/icon-192.png" width={72} height={72} alt="" />
        <h1>{APP_NAME}</h1>
        <label>
          Usuario
          <input
            autoComplete="username"
            enterKeyHint="next"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            onKeyDown={onKey('user')}
            placeholder=""
          />
        </label>
        <label>
          Contraseña
          <input
            ref={passRef}
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={onKey('pass')}
            placeholder=""
          />
        </label>
        {err && <p className="err">{err}</p>}
        <button type="submit" className="sr-only">
          Entrar
        </button>
        <p className="hint">Enter para entrar</p>
        <p className="ver">v{APP_VERSION}</p>
      </form>
    </div>
  )
}
