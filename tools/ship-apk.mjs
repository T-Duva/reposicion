/**
 * Sube patch version (1.0.5 → 1.0.6), arma APK y publica en GitHub Releases.
 * Uso: node tools/ship-apk.mjs [motivo]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function log(...args) {
  console.log(`[ship]`, ...args)
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...opts,
  })
}

export function readVersion() {
  const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  return String(pj.version || '1.0.0')
}

export function bumpPatchVersion() {
  const pjPath = path.join(root, 'package.json')
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
  const core = String(pj.version || '1.0.0')
    .replace(/^v/i, '')
    .replace(/\s+v$/i, '')
    .trim()
  const parts = core.split('.').map((n) => Number.parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  const next = parts.join('.')
  pj.version = next
  fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n', 'utf8')
  fs.writeFileSync(
    path.join(root, 'src', 'version.ts'),
    `export const APP_VERSION = '${next}'\nexport const APP_NAME = 'REPOSICION'\n`,
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: next }) + '\n', 'utf8')
  const gradlePath = path.join(root, 'android', 'app', 'build.gradle')
  let g = fs.readFileSync(gradlePath, 'utf8')
  g = g.replace(/versionCode\s+(\d+)/, (_, n) => `versionCode ${Number(n) + 1}`)
  g = g.replace(/versionName\s+"[^"]+"/, `versionName "${next}"`)
  fs.writeFileSync(gradlePath, g, 'utf8')

  const url = `https://github.com/T-Duva/reposicion/releases/download/v${next}/REPOSICION-${next}.apk`
  const latest = 'https://github.com/T-Duva/reposicion/releases/latest/download/REPOSICION.apk'
  fs.mkdirSync(path.join(root, 'data'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'data', 'latest-apk.json'),
    JSON.stringify({ version: next, url, latest }, null, 2) + '\n',
    'utf8',
  )
  fs.writeFileSync(
    path.join(root, 'version.json'),
    JSON.stringify({ version: next }, null, 2) + '\n',
    'utf8',
  )
  log('version →', next)
  return { version: next, url, latest }
}

/** Rechaza APK firmado con Android Debug (rompe updates y Play Protect). */
export function assertReleaseSigned(apkPath) {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
  const buildTools = path.join(sdk, 'build-tools')
  let apksigner = null
  try {
    const vers = fs
      .readdirSync(buildTools, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse()
    for (const v of vers) {
      const bat = path.join(buildTools, v, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner')
      if (fs.existsSync(bat)) {
        apksigner = bat
        break
      }
    }
  } catch {
    /* sin sdk */
  }
  if (!apksigner) {
    log('WARN: sin apksigner, no puedo verificar firma')
    return true
  }
  const r = run(apksigner, ['verify', '--print-certs', apkPath], { shell: true })
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  if (r.status !== 0) {
    log('apksigner verify FAIL', out.slice(0, 400))
    return false
  }
  if (/CN=Android Debug/i.test(out) || /O=Android, CN=Android Debug/i.test(out)) {
    log('REJECT: APK firmado con Android Debug — no se publica')
    return false
  }
  if (!/Signer #1 certificate DN:/i.test(out)) {
    log('REJECT: APK sin firma legible')
    return false
  }
  log('firma OK', (out.match(/DN:.*$/m) || [''])[0].trim())
  return true
}

function pushVersionFiles(version) {
  const files = ['version.json', 'package.json', 'src/version.ts', 'android/app/build.gradle']
  run('git', ['add', '--', ...files], { shell: true })
  const st = run('git', ['status', '--porcelain', '--', ...files], { shell: true })
  if (!String(st.stdout || '').trim()) {
    log('git: version files sin cambios')
    return true
  }
  const msg = `Bump version to ${version}.`
  const c = run('git', ['commit', '-m', msg])
  if (c.status !== 0) {
    log('git commit FAIL', String(c.stderr || c.stdout || '').slice(0, 300))
    return false
  }
  const p = run('git', ['push', 'origin', 'master'])
  if (p.status !== 0) {
    log('git push FAIL', String(p.stderr || p.stdout || '').slice(0, 300))
    return false
  }
  log('git push OK version.json →', version)
  return true
}

export function rebuildPhoneBundle() {
  const pubDir = path.join(root, 'public')
  const pubJson = path.join(pubDir, 'server.json')
  const srcJson = path.join(root, 'server.json')
  if (fs.existsSync(srcJson)) {
    fs.mkdirSync(pubDir, { recursive: true })
    fs.copyFileSync(srcJson, pubJson)
    log('public/server.json sync OK')
  }
  log('npm run build…')
  let r = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { shell: false })
  if (r.status !== 0) {
    log('build FAIL', String(r.stderr || r.stdout || '').slice(0, 400))
    return false
  }
  log('cap sync android…')
  r = run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], { shell: false })
  if (r.status !== 0) {
    log('cap sync FAIL', String(r.stderr || r.stdout || '').slice(0, 400))
    return false
  }
  return true
}

export function assembleApk() {
  const gradlew = path.join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  log('assembleRelease…')
  const env = { ...process.env }
  if (!env.JAVA_HOME) {
    try {
      const base = 'C:\\Program Files\\Eclipse Adoptium'
      const jdk = fs.readdirSync(base).find((n) => n.startsWith('jdk-21'))
      if (jdk) env.JAVA_HOME = path.join(base, jdk)
    } catch {}
  }
  const r = run(gradlew, ['assembleRelease'], { cwd: path.join(root, 'android'), env, shell: false })
  if (r.status !== 0) {
    log('gradle FAIL', String(r.stderr || r.stdout || '').slice(-500))
    return false
  }
  const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  if (!fs.existsSync(built)) return false
  if (!assertReleaseSigned(built)) return false
  fs.copyFileSync(built, path.join(root, 'reposicion.apk'))
  fs.copyFileSync(built, path.join(root, 'REPOSICION.apk'))
  const outDir = path.join(root, 'apk-out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.copyFileSync(built, path.join(outDir, 'app-release.apk'))
  return true
}

export function publishRelease(version, notes = '') {
  const apk = path.join(root, 'reposicion.apk')
  if (!fs.existsSync(apk)) return false
  const tools = path.join(root, 'tools')
  fs.mkdirSync(tools, { recursive: true })
  const named = path.join(tools, `REPOSICION-${version}.apk`)
  const plain = path.join(tools, 'REPOSICION.apk')
  fs.copyFileSync(apk, named)
  fs.copyFileSync(apk, plain)
  // Borrar release previo si existe (ok si no hay).
  run('gh', ['release', 'delete', `v${version}`, '--repo', 'T-Duva/reposicion', '--yes'], {
    shell: true,
  })
  const r = run(
    'gh',
    [
      'release',
      'create',
      `v${version}`,
      named,
      `${plain}#REPOSICION.apk`,
      '--repo',
      'T-Duva/reposicion',
      '--title',
      `REPOSICION ${version}`,
      '--notes',
      notes || `Corrección v${version}. Reinstalá el APK para ver el cambio en el celular.`,
      '--latest',
    ],
    { shell: true },
  )
  if (r.status !== 0) {
    const err = String(r.stderr || r.stdout || '')
    log('gh FAIL', err.slice(0, 400))
    // Retry sin shell por si Windows mangla args
    const r2 = run('gh', [
      'release',
      'create',
      `v${version}`,
      named,
      `${plain}#REPOSICION.apk`,
      '--repo',
      'T-Duva/reposicion',
      '--title',
      `REPOSICION ${version}`,
      '--notes',
      notes || `Corrección v${version}.`,
      '--latest',
    ])
    if (r2.status !== 0) {
      log('gh FAIL retry', String(r2.stderr || r2.stdout || '').slice(0, 400))
      return false
    }
  }
  log('published', `v${version}`)
  return true
}

function touchWorking() {
  try {
    const inbox = path.join(root, 'inbox')
    for (const name of fs.readdirSync(inbox)) {
      if (name.startsWith('WORKING.')) {
        fs.writeFileSync(path.join(inbox, name), new Date().toISOString(), 'utf8')
      }
    }
    const busy = path.join(inbox, 'BUSY.lock')
    if (fs.existsSync(busy)) {
      const id = fs.readFileSync(busy, 'utf8').trim()
      if (id) fs.writeFileSync(busy, id, 'utf8')
    }
  } catch {
    /* ok */
  }
}

/** Bump + build + APK + GitHub. Devuelve { version, url, latest } o null. */
export function shipApk(notes = '', opts = {}) {
  touchWorking()
  const noBump = Boolean(opts.noBump)
  const version = readVersion()
  const bumped = noBump
    ? {
        version,
        url: `https://github.com/T-Duva/reposicion/releases/download/v${version}/REPOSICION-${version}.apk`,
        latest: 'https://github.com/T-Duva/reposicion/releases/latest/download/REPOSICION.apk',
      }
    : bumpPatchVersion()
  if (noBump) log('version (sin bump) →', bumped.version)
  touchWorking()
  if (!rebuildPhoneBundle()) return null
  touchWorking()
  if (!assembleApk()) return null
  touchWorking()
  if (!publishRelease(bumped.version, notes || `Corrección automática v${bumped.version}.`)) return null
  pushVersionFiles(bumped.version)
  return bumped
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const argv = process.argv.slice(2)
  const noBump = argv.includes('--no-bump')
  const notes = argv.filter((a) => a !== '--no-bump').join(' ') || ''
  const out = shipApk(notes, { noBump })
  if (!out) process.exit(1)
  console.log(JSON.stringify(out))
}
