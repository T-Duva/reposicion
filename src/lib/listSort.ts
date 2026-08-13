export type ListSortMode = 'az' | 'price-asc' | 'za' | 'price-desc'

export const LIST_SORT_CYCLE: ListSortMode[] = ['az', 'price-asc', 'za', 'price-desc']

export const LIST_SORT_LABELS: Record<ListSortMode, string> = {
  az: 'A-Z',
  'price-asc': '$-$$',
  za: 'Z-A',
  'price-desc': '$$-$',
}

export function nextListSortMode(mode: ListSortMode): ListSortMode {
  const i = LIST_SORT_CYCLE.indexOf(mode)
  return LIST_SORT_CYCLE[(i + 1) % LIST_SORT_CYCLE.length]
}

export function sortByListMode<T>(
  items: T[],
  mode: ListSortMode,
  getName: (item: T) => string,
  getPrice: (item: T) => number,
): T[] {
  const sorted = [...items]
  const cmpName = (a: T, b: T) => getName(a).localeCompare(getName(b), 'es', { sensitivity: 'base' })
  const cmpPrice = (a: T, b: T) => getPrice(a) - getPrice(b) || cmpName(a, b)
  switch (mode) {
    case 'az':
      return sorted.sort(cmpName)
    case 'za':
      return sorted.sort((a, b) => cmpName(b, a))
    case 'price-asc':
      return sorted.sort(cmpPrice)
    case 'price-desc':
      return sorted.sort((a, b) => cmpPrice(b, a))
  }
}
