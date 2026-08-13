import type { KeyboardEvent } from 'react'

export function enterTo(fn: () => void) {
  return (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    fn()
  }
}
