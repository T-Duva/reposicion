import type { FocusEvent } from 'react'

/** Centra un elemento en la mitad visible de su contenedor scrolleable. */
export function scrollElementToCenter(container: HTMLElement, el: HTMLElement, smooth = true) {
  const cRect = container.getBoundingClientRect()
  const eRect = el.getBoundingClientRect()
  const offset = eRect.top - cRect.top - (cRect.height - eRect.height) / 2
  container.scrollBy({ top: offset, behavior: smooth ? 'smooth' : 'auto' })
}

function scrollInputIntoView(container: HTMLElement, field: HTMLElement) {
  const vv = window.visualViewport
  const boxRect = container.getBoundingClientRect()
  const tRect = field.getBoundingClientRect()
  const pad = 16
  let visibleBottom = vv ? Math.min(boxRect.bottom, vv.offsetTop + vv.height) : boxRect.bottom
  const dock = document.querySelector('.buy-page .totals-dock')
  if (dock) {
    const dTop = dock.getBoundingClientRect().top
    if (dTop < visibleBottom) visibleBottom = dTop
  }
  const visibleTop = vv ? Math.max(boxRect.top, vv.offsetTop) : boxRect.top
  if (tRect.bottom > visibleBottom - pad) {
    container.scrollTop += tRect.bottom - visibleBottom + pad
  } else if (tRect.top < visibleTop + pad) {
    container.scrollTop -= visibleTop - tRect.top + pad
  }
}

let activeScrollCleanup: (() => void) | null = null

/**
 * Al enfocar un input: una sola pasada para que quede arriba del teclado.
 * No re-centrar en cada scroll del visualViewport (eso bloqueaba scrollear a mano).
 */
export function scrollFieldIntoView(e: FocusEvent<HTMLDivElement>) {
  const t = e.target
  if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return
  const box = e.currentTarget

  activeScrollCleanup?.()

  const run = () => requestAnimationFrame(() => scrollInputIntoView(box, t))
  run()
  const t1 = window.setTimeout(run, 120)
  const t2 = window.setTimeout(run, 320)

  let resizeTimer = 0
  const onVvResize = () => {
    window.clearTimeout(resizeTimer)
    // Solo al abrir/cerrar teclado, no en cada pixel de scroll.
    resizeTimer = window.setTimeout(run, 80)
  }
  window.visualViewport?.addEventListener('resize', onVvResize)

  const cleanup = () => {
    clearTimeout(t1)
    clearTimeout(t2)
    window.clearTimeout(resizeTimer)
    window.visualViewport?.removeEventListener('resize', onVvResize)
    box.removeEventListener('focusout', onFocusOut, true)
    if (activeScrollCleanup === cleanup) activeScrollCleanup = null
  }
  const onFocusOut = (ev: globalThis.FocusEvent) => {
    if (box.contains(ev.relatedTarget as Node)) return
    cleanup()
  }
  box.addEventListener('focusout', onFocusOut, true)
  activeScrollCleanup = cleanup
}
