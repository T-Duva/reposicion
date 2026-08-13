export function apkDownloadUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/reposicion.apk`
}

export async function copyApkDownloadUrl(origin: string): Promise<string> {
  const url = apkDownloadUrl(origin)
  await navigator.clipboard.writeText(url)
  return url
}

/** Si el texto trae un enlace APK, lo copia al portapapeles. */
export function copyApkUrlFromText(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+\/reposicion\.apk\b/i)
  if (!m) return null
  void navigator.clipboard.writeText(m[0]).catch(() => {})
  return m[0]
}
