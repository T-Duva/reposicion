function nameWords(name: string): string[] {
  return (name || '')
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9áéíóúüñ]+/i)
    .filter(Boolean)
}

function isNeonWord(w: string): boolean {
  return w === 'neón' || w === 'neon'
}

function isLedWord(w: string): boolean {
  return w === 'led'
}

/** Bloquea cruce LED↔Neón: «led» no agarra «Neón…» ni «Neón LED…», y al revés. */
function categoryCrossMatch(firstWord: string, query: string): boolean {
  const w = firstWord.toLowerCase()
  const q = query.trim().toLowerCase()
  return (isNeonWord(q) && isLedWord(w)) || (isLedWord(q) && isNeonWord(w))
}

/** Palabras internas solo con consulta más larga (evita que «neón» agarre «LED Neón…»). */
const SUBWORD_MIN = 5

/** «Neón LED …» debe aparecer al buscar «led» aunque la consulta sea corta. */
function neonLedException(words: string[], q: string): boolean {
  return isLedWord(q) && isNeonWord(words[0]) && words.some((w, i) => i > 0 && isLedWord(w))
}

export function isProductCategoryQuery(query: string): boolean {
  const q = query.trim().toLowerCase()
  return isLedWord(q) || isNeonWord(q)
}

/** Prefijo del nombre, primera palabra, o palabra interna (sin cruzar LED/Neón). */
export function nameMatchesQuery(name: string, query: string): boolean {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  const n = (name || '').trim().toLowerCase()
  if (n.startsWith(q)) return true
  const words = nameWords(name)
  if (!words.length) return false
  if (words[0].startsWith(q)) {
    if (categoryCrossMatch(words[0], q)) return false
    return true
  }
  if (neonLedException(words, q)) return true
  if (categoryCrossMatch(words[0], q)) return false
  if (q.length >= SUBWORD_MIN) {
    return words.some((w, i) => i > 0 && w.startsWith(q))
  }
  return false
}

export function unitPriceMatchesQuery(unitPrice: number, query: string): boolean {
  const q = query.trim()
  if (!q || !unitPrice) return false
  const digits = q.replace(/[^\d]/g, '')
  if (!digits) return false
  return String(unitPrice).includes(digits)
}
