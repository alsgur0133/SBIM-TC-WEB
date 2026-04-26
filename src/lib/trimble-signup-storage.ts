/**
 * Trimble 최초 가입 화면(/trimble-signup)용: React Router location.state는 새로고침 시 사라지므로
 * sessionStorage에 임시 보관해 가입 신청 API가 반드시 호출될 수 있게 함.
 */
const KEY = 'sbim-trimble-signup-payload'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface TrimbleSignupUserPayload {
  id: string
  name: string
  email: string
}

interface Stored {
  trimbleUser: TrimbleSignupUserPayload
  savedAt: number
}

export function saveTrimbleSignupPayload(trimbleUser: TrimbleSignupUserPayload) {
  try {
    const payload: Stored = { trimbleUser, savedAt: Date.now() }
    sessionStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function loadTrimbleSignupPayload(): TrimbleSignupUserPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed?.trimbleUser?.email || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return parsed.trimbleUser
  } catch {
    return null
  }
}

export function clearTrimbleSignupPayload() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
