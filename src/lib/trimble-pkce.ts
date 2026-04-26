/**
 * Trimble Identity OAuth 2.0 - PKCE (Proof Key for Code Exchange)
 * https://developer.trimble.com/docs/authentication/guides/authorization-code-pkce
 */

const TRIMBLE_CODE_VERIFIER_KEY = 'trimble_oauth_code_verifier'
const TRIMBLE_STATE_KEY = 'trimble_oauth_state'

/** 43~128자 영숫자 + ._-~ */
function randomVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-~'
  const len = 64
  let s = ''
  const arr = new Uint8Array(len)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
    for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length]
  } else {
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  }
  return s
}

/**
 * 순수 JS SHA-256 (crypto.subtle 미지원 환경용, 예: HTTP)
 * https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto - secure context 필요
 */
function sha256Sync(data: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const r = (n: number, x: number) => (x >>> n) | (x << (32 - n))
  const w = new Uint8Array(64)
  const W = new Uint32Array(64)
  const len = data.length
  const padLen = ((len + 9 + 63) >> 6) << 6
  const padded = new Uint8Array(padLen)
  padded.set(data)
  padded[len] = 0x80
  new DataView(padded.buffer).setUint32(padLen - 4, len * 8, false)
  const out = new Uint8Array(32)
  const view = new DataView(out.buffer)
  for (let block = 0; block < padLen; block += 64) {
    for (let t = 0; t < 16; t++) {
      const i = block + t * 4
      W[t] = (padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]
    }
    for (let t = 16; t < 64; t++) {
      const s0 = r(7, W[t - 15]) ^ r(18, W[t - 15]) ^ (W[t - 15] >>> 3)
      const s1 = r(17, W[t - 2]) ^ r(19, W[t - 2]) ^ (W[t - 2] >>> 10)
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = [H[0], H[1], H[2], H[3], H[4], H[5], H[6], H[7]]
    for (let t = 0; t < 64; t++) {
      const S1 = r(6, e) ^ r(11, e) ^ r(25, e)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0
      const S0 = r(2, a) ^ r(13, a) ^ r(22, a)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0
    H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0
    H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0
    H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0
    H[7] = (H[7] + h) >>> 0
  }
  for (let i = 0; i < 8; i++) view.setUint32(i * 4, H[i], false)
  return out
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 후 Base64-URL 인코딩 (code_challenge). HTTP 등 secure context 아닐 때는 순수 JS SHA-256 사용 */
async function sha256Base64Url(plain: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (subtle) {
    try {
      const hash = await subtle.digest('SHA-256', data)
      return bytesToBase64Url(new Uint8Array(hash))
    } catch (_) {
      // fallback to sync SHA-256
    }
  }
  return bytesToBase64Url(sha256Sync(data))
}

export interface PKCEPair {
  codeVerifier: string
  codeChallenge: string
}

export async function generatePKCE(): Promise<PKCEPair> {
  const codeVerifier = randomVerifier()
  const codeChallenge = await sha256Base64Url(codeVerifier)
  return { codeVerifier, codeChallenge }
}

export function savePKCEForCallback(codeVerifier: string, state: string): void {
  try {
    sessionStorage.setItem(TRIMBLE_CODE_VERIFIER_KEY, codeVerifier)
    sessionStorage.setItem(TRIMBLE_STATE_KEY, state)
  } catch (_) {
    // ignore
  }
}

export function getStoredCodeVerifierAndState(): { codeVerifier: string; state: string } | null {
  try {
    const codeVerifier = sessionStorage.getItem(TRIMBLE_CODE_VERIFIER_KEY)
    const state = sessionStorage.getItem(TRIMBLE_STATE_KEY)
    if (codeVerifier && state) return { codeVerifier, state }
  } catch (_) {
    // ignore
  }
  return null
}

export function clearStoredPKCE(): void {
  try {
    sessionStorage.removeItem(TRIMBLE_CODE_VERIFIER_KEY)
    sessionStorage.removeItem(TRIMBLE_STATE_KEY)
  } catch (_) {
    // ignore
  }
}
