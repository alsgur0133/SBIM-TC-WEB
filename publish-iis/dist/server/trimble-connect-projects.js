/**
 * Trimble Connect — 프로젝트 생성(TC API 2.0) 및 참여자 초대(projects-api).
 * 사용자 OAuth 액세스 토큰이 필요합니다(서버에 상주하지 않음).
 *
 * 환경 변수(선택):
 *   TRIMBLE_CONNECT_TC_API_BASE — 기본 https://app.connect.trimble.com/tc/api/2.0
 *   TRIMBLE_CONNECT_PROJECTS_API_BASE — 기본 https://projects-api.connect.trimble.com/v1
 *   TRIMBLE_CONNECT_REGIONS_URL — 리전 카탈로그 (기본 …/tc/api/2.0/regions). 아시아 등은 app31… TC API 사용.
 */

const TC_API_BASE = (process.env.TRIMBLE_CONNECT_TC_API_BASE || 'https://app.connect.trimble.com/tc/api/2.0').replace(/\/$/, '')
const PROJECTS_API_BASE = (process.env.TRIMBLE_CONNECT_PROJECTS_API_BASE || 'https://projects-api.connect.trimble.com/v1').replace(/\/$/, '')
const REGIONS_CATALOG_URL = (
  process.env.TRIMBLE_CONNECT_REGIONS_URL || 'https://app.connect.trimble.com/tc/api/2.0/regions'
).replace(/\/$/, '')

/** @type {{ t: number, list: { base: string, location: string }[] | null }} */
let __trimbleRegionsCache = { t: 0, list: null }
const TRIMBLE_REGIONS_TTL_MS = 60 * 60 * 1000

/**
 * Trimble 공식 /regions — 각 리전의 tc-api 베이스 (북미·유럽·아시아·호주 등)
 * @returns {Promise<{ base: string, location: string }[]>}
 */
async function getTrimbleTcApiRegionEntries() {
  const now = Date.now()
  if (__trimbleRegionsCache.list && now - __trimbleRegionsCache.t < TRIMBLE_REGIONS_TTL_MS) {
    return __trimbleRegionsCache.list
  }
  try {
    const res = await fetch(REGIONS_CATALOG_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const arr = await res.json()
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('empty regions')
    const list = arr
      .map((r) => {
        const tc = r && (r['tc-api'] || r.tcApi)
        if (!tc) return null
        const base = String(tc).replace(/\/+$/, '')
        const location = (r && (r.location || r.region || r.serviceRegion)) || ''
        return { base, location: String(location) }
      })
      .filter(Boolean)
    if (!list.length) throw new Error('no tc-api')
    __trimbleRegionsCache = { t: now, list }
    return list
  } catch (e) {
    console.warn('[Trimble] 리전 카탈로그 조회 실패, TC_API_BASE만 사용:', e.message || e)
    const fallback = [{ base: TC_API_BASE, location: '' }]
    __trimbleRegionsCache = { t: now, list: fallback }
    return fallback
  }
}

async function trimbleJsonFetch(url, accessToken, init = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...(init.headers || {}),
  }
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(url, { ...init, headers })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { _raw: text }
  }
  return { ok: res.ok, status: res.status, data, text }
}

function pickProjectId(data) {
  if (!data || typeof data !== 'object') return null
  if (data.id) return String(data.id)
  if (data.Id) return String(data.Id)
  if (data.projectId) return String(data.projectId)
  if (data.project && data.project.id) return String(data.project.id)
  if (data.data && data.data.id) return String(data.data.id)
  return null
}

/** /users/me 등에서 프로젝트 생성에 쓸 라이선스 ID 추출 */
function pickLicenseIdFromUserMe(data) {
  if (!data || typeof data !== 'object') return null
  const tryLicense = (lic) => {
    if (!lic || typeof lic !== 'object') return null
    return lic.id || lic.Id || lic.licenseId || lic.license_id || null
  }
  if (Array.isArray(data.licenses) && data.licenses.length) {
    for (const lic of data.licenses) {
      const id = tryLicense(lic)
      if (id) return String(id)
    }
  }
  if (data.license) {
    const id = tryLicense(data.license)
    if (id) return String(id)
  }
  if (data.defaultLicenseId || data.DefaultLicenseId) {
    return String(data.defaultLicenseId || data.DefaultLicenseId)
  }
  if (Array.isArray(data.Licenses) && data.Licenses.length) {
    for (const lic of data.Licenses) {
      const id = tryLicense(lic)
      if (id) return String(id)
    }
  }
  return null
}

async function fetchTrimbleUserLicenseId(accessToken) {
  const regions = await getTrimbleTcApiRegionEntries()
  for (const { base } of regions) {
    const meUrl = `${base}/users/me`
    const { ok, data } = await trimbleJsonFetch(meUrl, accessToken, { method: 'GET' })
    if (!ok || !data) continue
    const lic = pickLicenseIdFromUserMe(data)
    if (lic) return lic
  }
  return null
}

/** TC API 응답에서 프로젝트 배열 추출 */
function normalizeProjectsArray(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.items)) return data.items
  if (Array.isArray(data.Items)) return data.Items
  if (Array.isArray(data.projects)) return data.projects
  if (Array.isArray(data.Projects)) return data.Projects
  if (Array.isArray(data.value)) return data.value
  if (Array.isArray(data.data)) return data.data
  if (data.data && Array.isArray(data.data.items)) return data.data.items
  return []
}

function pickProjectListEntry(p) {
  if (!p || typeof p !== 'object') return null
  const id = p.id ?? p.Id ?? p.projectId ?? p.ProjectId
  if (id == null || String(id).trim() === '') return null
  const name =
    p.name ??
    p.Name ??
    p.title ??
    p.Title ??
    p.displayName ??
    p.DisplayName ??
    String(id)
  return { id: String(id).trim(), name: String(name).trim() || String(id) }
}

/**
 * TC API 2.0: 현재 사용자가 접근 가능한 Connect 프로젝트 목록 (모든 리전 병합)
 * — 북미 기본 URL만 쓰면 아시아(app31) 프로젝트가 비어 보이는 문제 방지
 * @returns {{ ok: true, projects: { id: string, name: string, tcRegion?: string }[] } | { ok: false, error: string, status?: number }}
 */
async function listTrimbleConnectProjects(accessToken, { take = 500, skip = 0 } = {}) {
  const regions = await getTrimbleTcApiRegionEntries()
  const q = new URLSearchParams({
    fullyLoaded: 'false',
    take: String(Math.min(Math.max(take, 1), 1000)),
    skip: String(Math.max(skip, 0)),
  })
  const seen = new Set()
  const projects = []
  const errors = []
  for (const { base, location } of regions) {
    const url = `${base}/projects?${q.toString()}`
    let { ok, status, data, text } = await trimbleJsonFetch(url, accessToken, { method: 'GET' })
    if (!ok && status === 404) {
      const retry = await trimbleJsonFetch(`${base}/projects`, accessToken, { method: 'GET' })
      ok = retry.ok
      status = retry.status
      data = retry.data
      text = retry.text
    }
    if (!ok) {
      errors.push(`${location || base}: ${status}`)
      continue
    }
    const raw = normalizeProjectsArray(data)
    for (const row of raw) {
      const entry = pickProjectListEntry(row)
      if (!entry || seen.has(entry.id)) continue
      seen.add(entry.id)
      projects.push(location ? { ...entry, tcRegion: location } : { ...entry })
    }
  }
  if (projects.length === 0 && errors.length === regions.length) {
    const msg =
      errors.join('; ') || '모든 리전에서 프로젝트 목록을 가져오지 못했습니다.'
    return { ok: false, error: String(msg), status: 502 }
  }
  projects.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
  return { ok: true, projects }
}

/**
 * TC API 2.0으로 Trimble Connect 프로젝트 생성
 * @returns {{ ok: true, projectId: string } | { ok: false, error: string, status?: number }}
 */
async function createTrimbleConnectProject(accessToken, { name, description }) {
  const trimmed = (name || '').trim()
  if (!trimmed) {
    return { ok: false, error: '프로젝트 이름이 비어 있습니다.' }
  }
  const desc = description && String(description).trim() ? String(description).trim() : undefined

  const licenseId = await fetchTrimbleUserLicenseId(accessToken)

  function baseBody() {
    const b = { name: trimmed }
    if (desc) b.description = desc
    return b
  }

  const bodies = []
  if (licenseId) {
    bodies.push({ ...baseBody(), licenseId })
    bodies.push({ ...baseBody(), defaultLicenseId: licenseId })
    bodies.push({ ...baseBody(), LicenseId: licenseId })
  }
  bodies.push(baseBody())

  const regions = await getTrimbleTcApiRegionEntries()
  let last = { ok: false, status: 0, data: null, text: '' }
  for (const { base } of regions) {
    const url = `${base}/projects`
    for (const body of bodies) {
      last = await trimbleJsonFetch(url, accessToken, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (last.ok) break
    }
    if (last.ok) {
      const projectId = pickProjectId(last.data)
      if (projectId) return { ok: true, projectId }
    }
  }

  const { ok, status, data, text } = last
  if (ok) {
    const projectId = pickProjectId(data)
    if (projectId) return { ok: true, projectId }
    return { ok: false, error: 'Trimble 응답에 프로젝트 ID가 없습니다.', status }
  }
  let msg =
    (data && (data.message || data.error || data.code || data.title)) ||
    (typeof text === 'string' && text.slice(0, 200)) ||
    `HTTP ${status}`

  if (String(msg).toUpperCase().includes('UNAUTHORIZED_LICENSE') || String(data?.code) === 'UNAUTHORIZED_LICENSE') {
    msg +=
      ' — Trimble 쪽 이슈입니다. BRACE 권한과는 무관하며, Connect에 쓸 수 있는 라이선스(회사/비즈니스 등)가 계정에 없거나 만료된 경우가 많습니다. web.connect.trimble.com 에서 프로젝트를 직접 만들 수 있는지 확인하고, 필요하면 조직의 Trimble 관리자에게 라이선스 배정을 요청하세요.'
  }
  return { ok: false, error: String(msg), status }
}

/**
 * projects-api: 프로젝트에 사용자 추가(초대). 계정 관리자 권한이 필요할 수 있음.
 * @param {string[]} emails
 */
async function inviteUsersToTrimbleConnectProject(accessToken, trimbleProjectId, emails) {
  const pid = String(trimbleProjectId || '').trim()
  if (!pid) return { ok: false, error: 'Trimble 프로젝트 ID가 없습니다.' }
  const list = [...new Set((emails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))]
  if (list.length === 0) return { ok: true, invited: 0, note: '이메일 없음' }

  const url = `${PROJECTS_API_BASE}/projects/update-users`
  const chunks = []
  for (let i = 0; i < list.length; i += 15) {
    chunks.push(list.slice(i, i + 15))
  }
  const errors = []
  let invited = 0
  for (const chunk of chunks) {
    const updates = chunk.map((email) => ({
      action: 'ADD',
      email,
      role: 'USER',
    }))
    const payload = [{ projectId: pid, updates }]
    let { ok, status, data } = await trimbleJsonFetch(url, accessToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (!ok && status === 400) {
      const updatesLower = chunk.map((email) => ({ action: 'add', email, role: 'USER' }))
      const retry = await trimbleJsonFetch(url, accessToken, {
        method: 'POST',
        body: JSON.stringify([{ projectId: pid, updates: updatesLower }]),
      })
      ok = retry.ok
      status = retry.status
      data = retry.data
    }
    if (ok) {
      invited += chunk.length
    } else {
      const msg =
        (data && (data.message || data.error || (Array.isArray(data.errors) && data.errors[0]?.message))) ||
        `HTTP ${status}`
      errors.push(String(msg))
    }
  }
  if (errors.length && invited === 0) {
    return { ok: false, error: errors.join('; ') }
  }
  return {
    ok: true,
    invited,
    partialErrors: errors.length ? errors : undefined,
  }
}

/**
 * TC API 2.0: 프로젝트에 사용자 초대(프로젝트 관리자 권한). 엔드포인트가 없으면 실패할 수 있음.
 */
async function inviteUsersViaTcApi(accessToken, trimbleProjectId, emails) {
  const pid = String(trimbleProjectId || '').trim()
  const list = [...new Set((emails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))]
  const regions = await getTrimbleTcApiRegionEntries()
  const errors = []
  let okCount = 0
  for (const email of list) {
    let done = false
    for (const { base } of regions) {
      const tryUrls = [
        `${base}/projects/${encodeURIComponent(pid)}/users`,
        `${base}/projects/${encodeURIComponent(pid)}/members`,
      ]
      for (const url of tryUrls) {
        for (const body of [{ email }, { Email: email }, { userEmail: email }]) {
          const { ok, status } = await trimbleJsonFetch(url, accessToken, {
            method: 'POST',
            body: JSON.stringify(body),
          })
          if (ok) {
            okCount += 1
            done = true
            break
          }
          if (status !== 404 && status !== 405) {
            errors.push(`${email}: ${status}`)
          }
        }
        if (done) break
      }
      if (done) break
    }
  }
  if (okCount === 0 && list.length) {
    return { ok: false, error: errors[0] || 'TC API 사용자 초대 실패(엔드포인트 미지원일 수 있음)' }
  }
  return { ok: true, invited: okCount }
}

module.exports = {
  createTrimbleConnectProject,
  listTrimbleConnectProjects,
  inviteUsersToTrimbleConnectProject,
  inviteUsersViaTcApi,
  getTrimbleTcApiRegionEntries,
  trimbleJsonFetch,
  TC_API_BASE,
  PROJECTS_API_BASE,
}
