import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useApp } from '../state/store'

const MAX_PHOTOS = 4

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const max = 1200
    let { width, height } = bitmap
    if (width > max || height > max) {
      const scale = max / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Sin canvas')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } finally {
    bitmap.close()
  }
}

export function ReportModal() {
  const open = useApp((s) => s.reportOpen)
  const setOpen = useApp((s) => s.setReportOpen)
  const send = useApp((s) => s.sendReport)
  const user = useApp((s) => s.user)
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const canSend = text.trim().length > 0 || photos.length > 0

  const submit = async () => {
    const t = text.trim()
    if (!canSend || sending.current || busy) return
    sending.current = true
    send(t, photos.length ? photos : undefined)
    setText('')
    setPhotos([])
    window.setTimeout(() => {
      sending.current = false
    }, 800)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit()
  }

  const onPickPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) return
    setBusy(true)
    try {
      const next: string[] = []
      for (const file of files.slice(0, room)) {
        if (!file.type.startsWith('image/')) continue
        next.push(await compressImage(file))
      }
      if (next.length) setPhotos((prev) => [...prev, ...next].slice(0, MAX_PHOTOS))
    } finally {
      setBusy(false)
    }
  }

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <form className="modal report-modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h2>Reportar</h2>
        <p className="hint">
          {user === 'tomas'
            ? 'Lo tomo como orden y lo hago desde acá. Podés adjuntar fotos. Enter = nueva línea.'
            : 'Tomás recibe el aviso en el celular. Queda en logs, sin cambios automáticos. Podés adjuntar fotos. Enter = nueva línea.'}
        </p>
        <textarea
          autoFocus
          rows={4}
          enterKeyHint="enter"
          placeholder="¿Qué pasó o qué hay que cambiar?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="report-photos">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => void onPickPhotos(e)}
          />
          <button
            type="button"
            className="btn ghost report-photo-btn"
            disabled={busy || photos.length >= MAX_PHOTOS}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Procesando…' : photos.length ? `Foto (${photos.length}/${MAX_PHOTOS})` : 'Agregar foto'}
          </button>
          {photos.length > 0 && (
            <div className="report-photo-grid">
              {photos.map((src, i) => (
                <div key={i} className="report-photo-thumb">
                  <img src={src} alt={`Adjunto ${i + 1}`} />
                  <button type="button" className="icon-x" aria-label="Quitar foto" onClick={() => removePhoto(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="submit" className="btn primary" disabled={!canSend || busy}>
          Enviar
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cerrar
        </button>
      </form>
    </div>
  )
}
