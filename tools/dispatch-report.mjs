/**
 * Despacha un reporte del inbox a un agente Cursor (SDK local).
 * Uso: node tools/dispatch-report.mjs <reportId>
 *
 * Si el agente falla (cupo, red, timeout), NO marca DONE: el escuchador reencola.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const inbox = path.join(root, 'inbox')
const id = process.argv[2]
const logPath = path.join(inbox, `LOG.${id}.txt`)

if (!id) {
  console.error('Falta reportId')
  process.exit(1)
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`
  console.log(line)
  try {
    fs.appendFileSync(logPath, line + '\n', 'utf8')
  } catch {}
}

function loadEnv() {
  const keyFile = path.join(__dirname, '.cursor_api_key')
  if (fs.existsSync(keyFile)) {
    const k = fs.readFileSync(keyFile, 'utf8').trim()
    if (k && !process.env.CURSOR_API_KEY) process.env.CURSOR_API_KEY = k
  }
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      let val = m[2].replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  }
}

function mark(kind, body = new Date().toISOString()) {
  fs.writeFileSync(path.join(inbox, `${kind}.${id}`), body, 'utf8')
}

function clearWorking() {
  for (const f of [`WORKING.${id}`, 'BUSY.lock', 'AGENT_WAKE.json']) {
    try {
      fs.unlinkSync(path.join(inbox, f))
    } catch {}
  }
}

/** Deja pista para que el escuchador resetee working/launched y reintente. */
function markRetry(reason) {
  const body = `${new Date().toISOString()}\n${String(reason || '').slice(0, 800)}`
  fs.writeFileSync(path.join(inbox, `RETRY.${id}`), body, 'utf8')
}

function countWaiting() {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(inbox, 'PENDING.json'), 'utf8'))
    if (!Array.isArray(arr)) return 0
    return arr.filter((x) => x && x.id && x.id !== id && !x.working).length
  } catch {
    return 0
  }
}

function beat(status, pendingCount = countWaiting()) {
  try {
    const body = JSON.stringify({ status, pendingCount: Math.max(0, Number(pendingCount) || 0) })
    spawnSync(
      process.execPath,
      [
        '-e',
        `fetch('http://127.0.0.1:8788/api/watcher/beat',{method:'POST',headers:{'content-type':'application/json'},body:process.argv[1]}).then(r=>r.text()).catch(()=>{})`,
        body,
      ],
      { cwd: root, stdio: 'ignore', windowsHide: true },
    )
  } catch {}
}

function notifyLead(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  const m = t.match(/^[\s\S]*?[.!?](?:\s|$)/)
  return (m ? m[0] : t).trim().slice(0, 280)
}

function notifyPhone(title, body) {
  try {
    const lead = notifyLead(body)
    const payload = JSON.stringify({ title, body, push: lead || body, to: 'tomas' })
    spawnSync(
      process.execPath,
      [
        '-e',
        `fetch('http://127.0.0.1:8788/api/agent-note',{method:'POST',headers:{'content-type':'application/json'},body:process.argv[1]}).then(r=>r.text()).catch(()=>{})`,
        payload,
      ],
      { cwd: root, stdio: 'ignore', windowsHide: true },
    )
  } catch {}
}

function errText(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  return String(err.message || err.error?.message || err.result || JSON.stringify(err))
}

function isUsageLimit(msg) {
  const t = String(msg || '').toLowerCase()
  return (
    t.includes('out of usage') ||
    t.includes('increase limits') ||
    t.includes('usage limit') ||
    t.includes('rate limit') ||
    t.includes('switch to auto')
  )
}

loadEnv()
const md = path.join(inbox, `${id}.md`)
if (!fs.existsSync(md)) {
  log('No existe', md)
  process.exit(1)
}

const text = fs.readFileSync(md, 'utf8')
const apiKey = (process.env.CURSOR_API_KEY || '').trim()
fs.writeFileSync(path.join(inbox, 'BUSY.lock'), id, 'utf8')
mark('WORKING')
beat('working')
log('start', id)

if (!apiKey) {
  clearWorking()
  markRetry('Sin CURSOR_API_KEY')
  log('Sin CURSOR_API_KEY')
  notifyPhone('REPOSICION', 'Falta API key en la PC; reintento cuando esté.')
  beat('online')
  process.exit(2)
}

const prompt = `Sos el agente automático de REPOSICION. El usuario mandó un REPORTAR desde el celular.
TENÉS QUE HACER EL CAMBIO EN EL CÓDIGO. No digas "listo" sin editar archivos.

Repo: ${root}
Pedido (inbox/${id}.md):
---
${text}
---

Obligatorio:
1. Leé el pedido y aplicá el fix mínimo en src/ o server/ o tools/.
2. Si tocaste frontend: corré npm run build.
3. No inventes que ya estaba hecho: verificá el código actual.
4. Al final, en 1-3 oraciones en español, explicá qué cambiaste (eso lo lee Tomás en el celular).
`

async function main() {
  const { Agent, CursorAgentError } = await import('@cursor/sdk')
  const timeoutMs = Number(process.env.ONCE_AGENT_TIMEOUT_MS || 12 * 60 * 1000)
  // auto = el server elige modelo con cupo; composer-2.5 a veces se queda sin uso.
  const modelId = (process.env.CURSOR_MODEL || 'auto').trim() || 'auto'
  try {
    log('Agent.prompt…', `model=${modelId}`)
    const result = await Promise.race([
      Agent.prompt(prompt, {
        apiKey,
        model: { id: modelId },
        local: { cwd: root },
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout del agente (${Math.round(timeoutMs / 60000)} min)`)), timeoutMs),
      ),
    ])
    const summary =
      typeof result === 'string'
        ? result
        : String(result?.result || result?.text || result?.message || errText(result?.error) || JSON.stringify(result)).slice(
            0,
            1500,
          )
    log('status', result?.status || typeof result)
    log('summary', summary.slice(0, 500))
    fs.writeFileSync(path.join(inbox, `RESULT.${id}.txt`), summary, 'utf8')

    if (result?.status === 'error') {
      const why = errText(result?.error) || summary
      clearWorking()
      markRetry(why)
      beat('online')
      const msg = isUsageLimit(why)
        ? 'Sin cupo del modelo; reintento con Auto.'
        : `Falló, reintento: ${why.slice(0, 200)}`
      notifyPhone('REPOSICION · reintento', msg)
      log('requeue', why.slice(0, 200))
      process.exit(2)
    }

    mark('DONE', summary.slice(0, 500) || 'ok')
    clearWorking()
    try {
      fs.unlinkSync(path.join(inbox, `RETRY.${id}`))
    } catch {}
    beat('done', countWaiting())
    notifyPhone('REPOSICION · hecho', summary.slice(0, 1200) || 'Listo')
    log('done')
    process.exit(0)
  } catch (err) {
    const why = errText(err)
    log('ERR', why)
    clearWorking()
    markRetry(why)
    beat('online')
    notifyPhone(
      'REPOSICION · reintento',
      isUsageLimit(why) ? 'Sin cupo; reintento automático.' : `Error, reintento: ${why.slice(0, 200)}`,
    )
    process.exit(err instanceof CursorAgentError ? 1 : 2)
  }
}

main().catch((err) => {
  console.error(err)
  clearWorking()
  markRetry(String(err?.message || err))
  beat('online')
  process.exit(2)
})
