import { LIST_SORT_LABELS, nextListSortMode, type ListSortMode } from '../lib/listSort'

export function ListSortToggle({
  mode,
  onChange,
}: {
  mode: ListSortMode
  onChange: (mode: ListSortMode) => void
}) {
  const label = LIST_SORT_LABELS[mode]
  const isGreen = mode === 'az' || mode === 'za'
  const isBlink = mode === 'za' || mode === 'price-desc'

  return (
    <button
      type="button"
      className={`list-sort-toggle ${isGreen ? 'sort-green' : 'sort-red'}${isBlink ? ' sort-blink' : ''}`}
      onClick={() => onChange(nextListSortMode(mode))}
      aria-label={`Orden: ${label}`}
    >
      <span className="list-sort-light" aria-hidden />
      <span className="list-sort-label">{label}</span>
    </button>
  )
}
