import type { ReactNode } from 'react'
import { useRef } from 'react'
import { useApp, otherUser } from '../state/store'
import { USER_LABEL } from '../types'

/** No spamear presencia en cada focus: en Android eso re-renderiza y cierra el teclado. */
export function FocusField({ id, children }: { id: string; children: ReactNode }) {
  const me = useApp((s) => s.user)
  const setFocus = useApp((s) => s.setFocus)
  const presence = useApp((s) => s.presence)
  const other = me ? otherUser(me) : null
  const here = other && presence.find((p) => p.user === other && p.fieldId === id && Date.now() - p.updatedAt < 8000)
  const last = useRef<string | null>(null)

  return (
    <div
      className={`focus-wrap ${here ? `taken taken-${other}` : ''}`}
      onFocusCapture={() => {
        if (last.current === id) return
        last.current = id
        setFocus(id)
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          last.current = null
          setFocus(null)
        }
      }}
    >
      {here && other && <span className={`chip-presence ${other}`}>{USER_LABEL[other]} acá</span>}
      {children}
    </div>
  )
}
