import type { Database, Patch, Screen, Station, UserId } from '../types'

export function parseUserId(raw: string | null | undefined): UserId | null {
  if (raw === 'tomas' || raw === 'martin') return raw
  return null
}

export function userScreens(_user: UserId): Screen[] {
  return ['home', 'plan', 'buy', 'discounts', 'split', 'accounts', 'audit']
}

export function userCanEditStation(_user: UserId, _station: Station): boolean {
  return true
}

export function userPatchError(_user: UserId, _patch: Patch, _db: Database): string | null {
  return null
}
