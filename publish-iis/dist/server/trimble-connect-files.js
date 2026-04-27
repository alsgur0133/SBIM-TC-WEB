/**
 * Trimble Connect TC API 2.0 — 프로젝트 폴더/파일 나열 및 다운로드 URL
 * (trimble-connect-sdk tcps.js 경로와 동일)
 */

const FormData = require('form-data')
const { getTrimbleTcApiRegionEntries, trimbleJsonFetch } = require('./trimble-connect-projects')

/**
 * @param {string} url
 * @param {string} accessToken
 * @param {string} body
 * @param {Record<string, string>} [extraHeaders]
 */
async function postTrimbleConnectJson(url, accessToken, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { _raw: text }
  }
  const location = res.headers.get('location') || res.headers.get('Location') || ''
  return { ok: res.ok, status: res.status, data, text, location }
}

/** @param {string | null | undefined} header */
function parseContentRange(header) {
  if (!header || typeof header !== 'string') return null
  const m = header.trim().match(/^items\s+(\d+)-(\d+)\/(\d+)$/i)
  if (!m) return null
  return { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) }
}

/**
 * @param {string} accessToken
 * @param {string} url
 * @param {RequestInit & { parseJson?: boolean }} [init]
 */
async function trimbleFetch(accessToken, url, init = {}) {
  const parseJson = init.parseJson !== false
  const { parseJson: _p, ...rest } = init
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...(rest.headers || {}),
  }
  const res = await fetch(url, { ...rest, headers })
  const text = await res.text()
  let data = null
  if (parseJson && text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { _raw: text }
    }
  }
  return {
    ok: res.ok,
    status: res.status,
    data,
    text,
    headers: res.headers,
  }
}

/**
 * TC API 베이스(리전)에서 프로젝트 조회 성공 시 반환
 * @returns {Promise<{ apiBase: string, project: object } | null>}
 */
async function resolveTrimbleProject(accessToken, trimbleProjectId) {
  const pid = String(trimbleProjectId || '').trim()
  if (!pid) return null
  const regions = await getTrimbleTcApiRegionEntries()
  for (const { base } of regions) {
    const apiBase = String(base).replace(/\/+$/, '')
    const url = `${apiBase}/projects/${encodeURIComponent(pid)}`
    const { ok, data } = await trimbleJsonFetch(url, accessToken, { method: 'GET' })
    if (ok && data && typeof data === 'object') {
      const rootId = data.rootId ?? data.RootId ?? data.rootFolderId ?? data.fsRootId
      const id = data.id ?? data.Id ?? pid
      if (rootId && id) {
        return { apiBase, project: { ...data, id: String(id), rootId: String(rootId) } }
      }
    }
  }
  return null
}

function normalizeFolderItemsPayload(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.items)) return data.items
  if (Array.isArray(data.Items)) return data.Items
  if (Array.isArray(data.data)) return data.data
  return []
}

/**
 * @param {string} accessToken
 * @param {string} apiBase
 * @param {string} folderId
 * @param {number} [pageSize]
 */
async function listFolderItemsPaged(accessToken, apiBase, folderId, pageSize = 500) {
  const all = []
  let start = 0
  const fid = String(folderId || '').trim()
  if (!fid) return all
  const baseUrl = `${apiBase}/folders/${encodeURIComponent(fid)}/items`

  while (true) {
    const end = start + pageSize - 1
    const { ok, status, data, headers } = await trimbleFetch(accessToken, baseUrl, {
      method: 'GET',
      headers: { Range: `items=${start}-${end}` },
    })
    if (!ok) {
      if (all.length === 0) {
        const err = new Error(`폴더 항목 조회 실패 (HTTP ${status})`)
        err.status = status
        throw err
      }
      break
    }
    const items = normalizeFolderItemsPayload(data)
    for (const it of items) all.push(it)

    const cr = parseContentRange(headers.get('content-range') || headers.get('Content-Range'))
    if (!cr || items.length === 0 || cr.end >= cr.total - 1) break
    start = cr.end + 1
  }
  return all
}

function pickEntryType(item) {
  return String(item.type || item.Type || '').toUpperCase()
}

function isFolderEntryType(item) {
  const t = pickEntryType(item)
  return t === 'FOLDER' || t === 'DIRECTORY' || t === 'DIR'
}

function pickEntryId(item) {
  const id = item.id ?? item.Id
  return id != null ? String(id) : ''
}

function pickEntryName(item) {
  const n = item.name ?? item.Name ?? item.displayName ?? item.DisplayName ?? ''
  return String(n).trim() || 'unnamed'
}

/** Connect 폴더명: OS 금지 문자 제거·길이 제한 */
function sanitizeConnectFolderName(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return 'unnamed'
  s = s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ')
  if (s.length > 180) s = s.slice(0, 180).trim()
  return s || 'unnamed'
}

/**
 * API 표시명과 DB/앱 문자열이 NBSP·전각 공백 등으로 달라도 같은 폴더로 인식하도록 비교 키 생성
 * @param {string | null | undefined} raw
 */
function normalizeFolderNameKey(raw) {
  let s = String(raw ?? '')
  try {
    s = s.normalize('NFKC')
  } catch (_) {
    /* ignore */
  }
  s = s
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitizeConnectFolderName(s).toLowerCase()
}

function pickCreatedFolderId(data) {
  if (!data || typeof data !== 'object') return null
  /** @type {Set<object>} */
  const seen = new Set()
  /** @type {object[]} */
  const stack = [data]
  while (stack.length) {
    const d = stack.pop()
    if (!d || typeof d !== 'object' || seen.has(d)) continue
    seen.add(d)
    const id =
      d.id ??
      d.Id ??
      d.folderId ??
      d.FolderId ??
      (d.resource && typeof d.resource === 'object' && (d.resource.id || d.resource.Id))
    if (id != null && String(id).trim()) return String(id).trim()
    if (d.data && typeof d.data === 'object') stack.push(d.data)
    if (d.folder && typeof d.folder === 'object') stack.push(d.folder)
    if (d.Folder && typeof d.Folder === 'object') stack.push(d.Folder)
    if (d.resource && typeof d.resource === 'object') stack.push(d.resource)
  }
  return null
}

/** @param {string | null | undefined} location */
function pickFolderIdFromLocationHeader(location) {
  if (!location || typeof location !== 'string') return null
  const u = location.trim()
  const m = u.match(/\/folders\/([^/?#]+)\/?(?:\?|$)/i) || u.match(/folders\/([^/?#]+)/i)
  if (m && m[1]) return decodeURIComponent(m[1])
  const m2 = u.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return m2 ? m2[1] : null
}

/**
 * 부모 폴더 아래에서 이름이 같은 FOLDER가 있으면 그 id 반환
 * @param {string} displayName 비교용(원문); 내부에서 sanitize 후 대소문자 무시 비교
 */
async function findChildFolderIdByName(accessToken, apiBase, parentFolderId, displayName) {
  const wantKey = normalizeFolderNameKey(displayName)
  const pid = String(parentFolderId || '').trim()
  if (!wantKey || wantKey === 'unnamed' || !pid) return null
  try {
    const items = await listFolderItemsPaged(accessToken, apiBase, pid)
    for (const it of items) {
      if (!isFolderEntryType(it)) continue
      if (normalizeFolderNameKey(pickEntryName(it)) === wantKey) return pickEntryId(it)
    }
    if (process.env.DEBUG_TRIMBLE_FOLDERS === '1') {
      const folderNames = items.filter(isFolderEntryType).map((it) => pickEntryName(it))
      console.warn('[Trimble] findChildFolderIdByName: no match', { want: displayName, wantKey, folderNames })
    }
  } catch (e) {
    console.warn('[Trimble] findChildFolderIdByName', e && e.message ? e.message : e)
  }
  return null
}

/**
 * TC API 2.0: POST /folders (리전·프로젝트에 따라 projectId 쿼리 필요)
 * @returns {Promise<{ ok: true, folderId: string } | { ok: false, error: string, status?: number }>}
 */
async function createTrimbleConnectFolderOnce(accessToken, apiBase, parentFolderId, displayName, trimbleProjectId) {
  const name = sanitizeConnectFolderName(displayName)
  const parentId = String(parentFolderId || '').trim()
  const tid = trimbleProjectId && String(trimbleProjectId).trim()
  const base = String(apiBase || '').replace(/\/+$/, '')
  if (!parentId || !name) {
    return { ok: false, error: '부모 폴더 또는 폴더 이름이 없습니다.' }
  }

  const pe = encodeURIComponent(parentId)
  const te = tid ? encodeURIComponent(tid) : ''

  /** URL×본문 데카르트 곱은 Trimble 호출이 수백 번까지 늘어 요청이 멈춘 것처럼 보이므로, 우선순위만 순차 시도 */
  /** @type {{ url: string, body: object, headers?: Record<string, string> }[]} */
  const attempts = []
  if (tid) {
    attempts.push({
      url: `${base}/folders?parentId=${pe}&projectId=${te}`,
      body: { name, parentId, parentType: 'FOLDER', projectId: tid },
    })
    attempts.push({
      url: `${base}/folders?parentId=${pe}&projectId=${te}`,
      body: { name, parentId, projectId: tid },
    })
    attempts.push({
      url: `${base}/folders?projectId=${te}`,
      body: { name, parentId, parentType: 'FOLDER', projectId: tid },
    })
    attempts.push({
      url: `${base}/folders`,
      headers: { 'X-Trimble-Connect-Project-Id': tid, 'Trimble-Connect-Project-Id': tid },
      body: { name, parentId, parentType: 'FOLDER' },
    })
    attempts.push({
      url: `${base}/projects/${te}/folders`,
      body: { name, parentId, parentType: 'FOLDER' },
    })
    attempts.push({
      url: `${base}/projects/${te}/folders?parentId=${pe}`,
      body: { name },
    })
  }
  attempts.push({
    url: `${base}/folders?parentId=${pe}`,
    body: { name, parentId, parentType: 'FOLDER' },
  })
  attempts.push({
    url: `${base}/folders`,
    body: { name, parentId },
  })

  let lastErr = 'Trimble Connect 폴더 생성에 실패했습니다.'
  let lastStatus = 0
  for (const { url, body, headers } of attempts) {
    const bodyStr = JSON.stringify(body)
    const { ok, status, data, text, location } = await postTrimbleConnectJson(url, accessToken, bodyStr, headers || {})
    lastStatus = status || lastStatus
    if (ok) {
      const folderId = pickCreatedFolderId(data) || pickFolderIdFromLocationHeader(location)
      if (folderId) return { ok: true, folderId }
    }
    if (status === 401) {
      return { ok: false, error: 'Trimble 인증이 만료되었습니다. Connect로 다시 로그인한 뒤 시도하세요.', status }
    }
    const msg =
      data && typeof data === 'object'
        ? data.message || data.Message || data.error || data.title || data.Title
        : null
    if (msg) lastErr = String(msg)
    else if (text && String(text).length < 400) lastErr = `HTTP ${status}: ${String(text).slice(0, 300)}`
    if (status === 409 || status === 422) {
      const existing = await findChildFolderIdByName(accessToken, apiBase, parentId, name)
      if (existing) return { ok: true, folderId: existing }
    }
  }
  if (lastStatus) lastErr = `${lastErr} (HTTP ${lastStatus})`
  console.warn('[Trimble] createTrimbleConnectFolderOnce 실패:', { parentId, name, lastErr })
  return { ok: false, error: lastErr, status: lastStatus || undefined }
}

/**
 * 설계일정용: 루트 → 차수 폴더 → (선택) 리비전 폴더 id
 * @param {string} revisionDisplayName 리비전명 없음·빈 문자면 리비전 폴더는 조회하지 않음
 * @returns {Promise<{ phaseFolderId: string | null, revisionFolderId: string | null }>}
 */
async function findScheduleTrimbleFolderIds(
  accessToken,
  apiBase,
  rootFolderId,
  trimbleProjectId,
  phaseDisplayName,
  revisionDisplayName
) {
  const phaseFolderId = await findChildFolderIdByName(accessToken, apiBase, rootFolderId, phaseDisplayName)
  if (!phaseFolderId) return { phaseFolderId: null, revisionFolderId: null }
  const revRaw = revisionDisplayName != null ? String(revisionDisplayName).trim() : ''
  if (!revRaw) return { phaseFolderId, revisionFolderId: null }
  const revisionFolderId = await findChildFolderIdByName(accessToken, apiBase, phaseFolderId, revRaw)
  return { phaseFolderId, revisionFolderId: revisionFolderId || null }
}

/**
 * TC API 2.0: DELETE /folders/{id} (리전·프로젝트에 따라 projectId 쿼리 또는 프로젝트 헤더)
 * @returns {Promise<{ ok: true } | { ok: false, error: string, status?: number }>}
 */
async function deleteTrimbleConnectFolderOnce(accessToken, apiBase, folderId, trimbleProjectId) {
  const fid = String(folderId || '').trim()
  if (!fid) return { ok: false, error: '삭제할 폴더 ID가 없습니다.' }
  const base = String(apiBase || '').replace(/\/+$/, '')
  const tid = trimbleProjectId && String(trimbleProjectId).trim()
  const fe = encodeURIComponent(fid)
  const te = tid ? encodeURIComponent(tid) : ''
  /** @type {{ url: string, headers?: Record<string, string> }[]} */
  const attempts = []
  if (tid) {
    attempts.push({ url: `${base}/folders/${fe}?projectId=${te}` })
    attempts.push({
      url: `${base}/folders/${fe}`,
      headers: { 'X-Trimble-Connect-Project-Id': tid, 'Trimble-Connect-Project-Id': tid },
    })
  }
  attempts.push({ url: `${base}/folders/${fe}` })

  let lastErr = 'Trimble Connect 폴더 삭제에 실패했습니다.'
  let lastStatus = 0
  for (const { url, headers } of attempts) {
    const { ok, status, data, text } = await trimbleJsonFetch(url, accessToken, {
      method: 'DELETE',
      headers: headers || {},
    })
    lastStatus = status || lastStatus
    if (ok || status === 204 || status === 404) return { ok: true }
    if (status === 401) {
      return { ok: false, error: 'Trimble 인증이 만료되었습니다. Connect로 다시 로그인한 뒤 시도하세요.', status }
    }
    const msg =
      data && typeof data === 'object'
        ? data.message || data.Message || data.error || data.title || data.Title
        : null
    if (msg) lastErr = String(msg)
    else if (text && String(text).length < 400) lastErr = `HTTP ${status}: ${String(text).slice(0, 300)}`
  }
  if (lastStatus) lastErr = `${lastErr} (HTTP ${lastStatus})`
  console.warn('[Trimble] deleteTrimbleConnectFolderOnce 실패:', { folderId: fid, lastErr })
  return { ok: false, error: lastErr, status: lastStatus || undefined }
}

/**
 * TC API 2.0: 폴더 표시 이름 변경 (PATCH 또는 PUT /folders/{id})
 * @returns {Promise<{ ok: true } | { ok: false, error: string, status?: number }>}
 */
async function patchTrimbleConnectFolderName(accessToken, apiBase, folderId, newDisplayName, trimbleProjectId) {
  const name = sanitizeConnectFolderName(newDisplayName)
  const fid = String(folderId || '').trim()
  if (!fid || !name) return { ok: false, error: '폴더 ID 또는 새 이름이 없습니다.' }
  const base = String(apiBase || '').replace(/\/+$/, '')
  const tid = trimbleProjectId && String(trimbleProjectId).trim()
  const fe = encodeURIComponent(fid)
  const te = tid ? encodeURIComponent(tid) : ''

  const bodyVariants = [JSON.stringify({ name }), JSON.stringify({ Name: name })]
  /** @type {{ method: string, url: string, headers?: Record<string, string> }[]} */
  const plans = []
  if (tid) {
    plans.push({ method: 'PATCH', url: `${base}/folders/${fe}?projectId=${te}` })
    plans.push({
      method: 'PATCH',
      url: `${base}/folders/${fe}`,
      headers: { 'X-Trimble-Connect-Project-Id': tid, 'Trimble-Connect-Project-Id': tid },
    })
  }
  plans.push({ method: 'PATCH', url: `${base}/folders/${fe}` })
  if (tid) {
    plans.push({ method: 'PUT', url: `${base}/folders/${fe}?projectId=${te}` })
    plans.push({
      method: 'PUT',
      url: `${base}/folders/${fe}`,
      headers: { 'X-Trimble-Connect-Project-Id': tid, 'Trimble-Connect-Project-Id': tid },
    })
  }
  plans.push({ method: 'PUT', url: `${base}/folders/${fe}` })

  let lastErr = 'Trimble Connect 폴더 이름 변경에 실패했습니다.'
  let lastStatus = 0
  for (const { method, url, headers } of plans) {
    for (const body of bodyVariants) {
      const { ok, status, data, text } = await trimbleJsonFetch(url, accessToken, {
        method,
        body,
        headers: headers || {},
      })
      lastStatus = status || lastStatus
      if (ok || status === 204) return { ok: true }
      if (status === 401) {
        return { ok: false, error: 'Trimble 인증이 만료되었습니다. Connect로 다시 로그인한 뒤 시도하세요.', status }
      }
      const msg =
        data && typeof data === 'object'
          ? data.message || data.Message || data.error || data.title || data.Title
          : null
      if (msg) lastErr = String(msg)
      else if (text && String(text).length < 400) lastErr = `HTTP ${status}: ${String(text).slice(0, 300)}`
    }
  }
  if (lastStatus) lastErr = `${lastErr} (HTTP ${lastStatus})`
  console.warn('[Trimble] patchTrimbleConnectFolderName 실패:', { folderId: fid, newName: name, lastErr })
  return { ok: false, error: lastErr, status: lastStatus || undefined }
}

/**
 * 부모 아래에 폴더가 없으면 생성, 있으면 기존 id 반환
 * @returns {Promise<{ ok: true, folderId: string, existed?: boolean } | { ok: false, error: string, status?: number }>}
 */
async function getOrCreateConnectFolderInParent(accessToken, apiBase, parentFolderId, folderName, trimbleProjectId) {
  const existing = await findChildFolderIdByName(accessToken, apiBase, parentFolderId, folderName)
  if (existing) return { ok: true, folderId: existing, existed: true }
  const created = await createTrimbleConnectFolderOnce(
    accessToken,
    apiBase,
    parentFolderId,
    folderName,
    trimbleProjectId
  )
  if (!created.ok) return created
  return { ok: true, folderId: created.folderId, existed: false }
}

/**
 * 설계 모델 Connect 업로드용: 루트 → 설계 차수 폴더 → 리비전 폴더 (각 단계 없으면 생성)
 * @returns {Promise<{ ok: true, folderId: string } | { ok: false, error: string, status?: number }>}
 */
async function resolveTrimbleFolderForDesignRevision(
  accessToken,
  apiBase,
  rootFolderId,
  trimbleProjectId,
  phaseDisplayName,
  revisionDisplayName
) {
  let parent = String(rootFolderId || '').trim()
  const tid = String(trimbleProjectId || '').trim()
  if (!parent) return { ok: false, error: 'Trimble 프로젝트 루트 폴더 ID가 없습니다.' }

  const phase = String(phaseDisplayName ?? '').trim()
  if (phase) {
    const r = await getOrCreateConnectFolderInParent(accessToken, apiBase, parent, phase, tid)
    if (!r.ok) return r
    parent = r.folderId
  }
  const rev = String(revisionDisplayName ?? '').trim()
  if (rev) {
    const r = await getOrCreateConnectFolderInParent(accessToken, apiBase, parent, rev, tid)
    if (!r.ok) return r
    parent = r.folderId
  }
  return { ok: true, folderId: parent }
}

function pickVersionId(item) {
  const v = item.versionId ?? item.VersionId ?? item.version_id
  return v != null ? String(v) : ''
}

/**
 * @param {string} accessToken
 * @param {string} apiBase
 * @param {string} rootFolderId
 * @param {{ maxDepth?: number, maxFiles?: number }} [opts]
 * @returns {Promise<{ path: string[], name: string, id: string, versionId: string, item: object }[]>}
 */
async function listAllConnectFiles(accessToken, apiBase, rootFolderId, opts = {}) {
  const maxDepth = Math.min(Math.max(Number(opts.maxDepth) || 20, 1), 50)
  const maxFiles = Math.min(Math.max(Number(opts.maxFiles) || 500, 1), 5000)
  const out = []

  async function walk(folderId, depth, pathParts) {
    if (depth > maxDepth || out.length >= maxFiles) return
    let items
    try {
      items = await listFolderItemsPaged(accessToken, apiBase, folderId)
    } catch (e) {
      console.warn('[Trimble] 폴더 조회 오류:', folderId, e.message || e)
      return
    }
    for (const it of items) {
      if (out.length >= maxFiles) break
      const id = pickEntryId(it)
      if (!id) continue
      const name = pickEntryName(it)
      if (isFolderEntryType(it)) {
        await walk(id, depth + 1, [...pathParts, name])
      } else if (pickEntryType(it) === 'FILE') {
        out.push({
          path: pathParts,
          name,
          id,
          versionId: pickVersionId(it),
          item: it,
        })
      }
    }
  }

  await walk(String(rootFolderId), 0, [])
  return out
}

/**
 * 단일 폴더의 직계 자식만 나열 (Connect 탐색기 UI용). 폴더·파일만 포함.
 * @returns {Promise<{ id: string, name: string, kind: 'folder' | 'file', versionId?: string }[]>}
 */
async function browseTrimbleFolderChildren(accessToken, apiBase, folderId) {
  const fid = String(folderId || '').trim()
  if (!fid) return []
  const raw = await listFolderItemsPaged(accessToken, apiBase, fid)
  const out = []
  for (const it of raw) {
    const id = pickEntryId(it)
    if (!id) continue
    const name = pickEntryName(it)
    if (isFolderEntryType(it)) {
      out.push({ id, name, kind: 'folder' })
    } else if (pickEntryType(it) === 'FILE') {
      const vid = pickVersionId(it)
      out.push({ id, name, kind: 'file', ...(vid ? { versionId: vid } : {}) })
    }
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'ko', { sensitivity: 'base' })
  })
  return out
}

/**
 * @param {string} accessToken
 * @param {string} apiBase
 * @param {string} fileId
 * @param {string} [versionId]
 */
async function getTrimbleFileDownloadUrl(accessToken, apiBase, fileId, versionId) {
  let url = `${apiBase}/files/fs/${encodeURIComponent(fileId)}/downloadurl`
  const q = new URLSearchParams()
  if (versionId) q.set('versionId', versionId)
  const qs = q.toString()
  if (qs) url += `?${qs}`
  const { ok, status, data } = await trimbleJsonFetch(url, accessToken, { method: 'GET' })
  if (!ok) {
    return { ok: false, status, error: `downloadurl HTTP ${status}` }
  }
  const dl =
    (data && (data.url || data.Url || data.downloadUrl || data.DownloadUrl)) || null
  if (!dl || typeof dl !== 'string') {
    return { ok: false, error: '다운로드 URL이 응답에 없습니다.' }
  }
  return { ok: true, url: dl }
}

/**
 * @param {string} accessToken
 * @param {string} downloadUrl
 * @returns {Promise<Buffer>}
 */
async function downloadTrimbleBinary(accessToken, downloadUrl) {
  let res = await fetch(downloadUrl, { method: 'GET' })
  if (res.status === 401) {
    res = await fetch(downloadUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`파일 다운로드 실패 HTTP ${res.status} ${t.slice(0, 120)}`)
  }
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

function pickCreatedFileId(data) {
  if (!data || typeof data !== 'object') return null
  const direct =
    data.id ?? data.Id ?? data.fileId ?? data.FileId ?? data.file_id ?? data.resourceId ?? data.ResourceId
  if (direct != null && String(direct).trim()) return String(direct).trim()
  if (data.data) {
    const inner = pickCreatedFileId(data.data)
    if (inner) return inner
  }
  if (data.file) {
    const inner = pickCreatedFileId(data.file)
    if (inner) return inner
  }
  if (Array.isArray(data) && data[0]) {
    return pickCreatedFileId(data[0])
  }
  return null
}

function pickCreatedVersionId(data) {
  if (!data || typeof data !== 'object') return null
  const v = data.versionId ?? data.VersionId ?? data.version_id ?? data.versionID ?? data.VersionID
  return v != null ? String(v) : null
}

function formatTrimbleUploadError(status, data, text) {
  const parts = []
  if (status) parts.push(`HTTP ${status}`)
  if (data && typeof data === 'object') {
    const msg =
      data.message ||
      data.Message ||
      data.error_description ||
      data.errorDescription ||
      data.error ||
      data.title ||
      data.Title ||
      data.detail ||
      data.Detail
    if (msg) parts.push(String(msg))
    if (data.reason || data.Reason) parts.push(String(data.reason || data.Reason))
  }
  const raw = typeof text === 'string' ? text.trim() : ''
  if (parts.length <= 1 && raw && raw.length < 800) {
    parts.push(raw.slice(0, 500))
  }
  return parts.join(' — ') || 'Trimble Connect 업로드가 거부되었습니다.'
}

/** @param {object | null} data */
function pickInitiateUploadFields(data) {
  if (!data || typeof data !== 'object') return { uploadId: null, uploadURL: null }
  const inner = data.data && typeof data.data === 'object' ? data.data : data
  const uploadId = inner.uploadId ?? inner.UploadId ?? inner.upload_id ?? null
  const uploadURL = inner.uploadURL ?? inner.uploadUrl ?? inner.UploadURL ?? inner.upload_url ?? null
  return {
    uploadId: uploadId != null ? String(uploadId).trim() : null,
    uploadURL: uploadURL != null ? String(uploadURL).trim() : null,
  }
}

/**
 * 공식 trimble-connect-sdk 와 동일: initiate → PUT presigned URL → commit
 * (구식 POST /files?parentId= 멀티파트는 일부 리전에서 405/415)
 * @returns {Promise<{ ok: true, fileId: string, versionId: string | null } | { ok: false, error: string, status?: number }>}
 */
async function uploadFileViaTrimbleFsFlow(accessToken, apiBase, parentFolderId, fileName, buffer, trimbleProjectId) {
  const base = String(apiBase || '').replace(/\/+$/, '')
  const pid = String(parentFolderId || '').trim()
  const name = String(fileName || 'upload.bin').replace(/[\/\\:*?"<>|]/g, '_') || 'upload.bin'
  const tid = trimbleProjectId && String(trimbleProjectId).trim()
  if (!pid || !buffer || !buffer.length) {
    return { ok: false, error: !pid ? '업로드 대상 폴더 ID가 없습니다.' : '파일 내용이 비어 있습니다.' }
  }

  const initQueries = ['']
  if (tid) initQueries.push(`?projectId=${encodeURIComponent(tid)}`)

  let lastFail = /** @type {{ status: number, data: object | null, text: string, url: string }} */ ({
    status: 0,
    data: null,
    text: '',
    url: '',
  })

  for (const initQs of initQueries) {
    const initiateUrl = `${base}/files/fs/initiate${initQs}`
    const commitUrl = `${base}/files/fs/commit${initQs}`
    const initBody = JSON.stringify({ parentId: pid, parentType: 'FOLDER', name })
    const init = await trimbleJsonFetch(initiateUrl, accessToken, { method: 'POST', body: initBody })
    if (!init.ok) {
      lastFail = { status: init.status, data: init.data, text: init.text || '', url: initiateUrl }
      continue
    }
    let { uploadId, uploadURL } = pickInitiateUploadFields(init.data)
    if (!uploadId || !uploadURL) {
      lastFail = {
        status: init.status,
        data: init.data,
        text: init.text || JSON.stringify(init.data),
        url: initiateUrl,
      }
      continue
    }
    try {
      const putRes = await fetch(uploadURL, { method: 'PUT', body: buffer })
      if (!putRes.ok) {
        const t = await putRes.text().catch(() => '')
        return {
          ok: false,
          error: `스토리지 업로드 실패 HTTP ${putRes.status} — ${t.slice(0, 240)}`,
          status: putRes.status,
        }
      }
    } catch (e) {
      return {
        ok: false,
        error: `스토리지 업로드 오류: ${e && e.message ? e.message : String(e)}`,
        status: 0,
      }
    }

    const commit = await trimbleJsonFetch(commitUrl, accessToken, {
      method: 'POST',
      body: JSON.stringify({ uploadId }),
    })
    if (!commit.ok) {
      lastFail = { status: commit.status, data: commit.data, text: commit.text || '', url: commitUrl }
      const detail = formatTrimbleUploadError(lastFail.status, lastFail.data, lastFail.text)
      return { ok: false, error: detail, status: lastFail.status || 502 }
    }

    const payload = commit.data && typeof commit.data === 'object' ? commit.data : null
    const nested = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload
    let fileId = pickCreatedFileId(nested) || pickCreatedFileId(payload)
    let versionId = pickCreatedVersionId(nested) || pickCreatedVersionId(payload)
    if (!fileId) {
      return {
        ok: false,
        error: 'commit 응답에서 파일 ID를 찾을 수 없습니다.',
        status: 502,
      }
    }
    return { ok: true, fileId, versionId: versionId != null ? versionId : null }
  }

  const detail = formatTrimbleUploadError(lastFail.status, lastFail.data, lastFail.text)
  return {
    ok: false,
    error: `${detail}${lastFail.url ? ` (요청: ${lastFail.url.split('?')[0]})` : ''}`,
    status: lastFail.status || 502,
  }
}

/**
 * Trimble Connect 프로젝트 루트(또는 지정 폴더)에 파일 업로드
 * @param {string} [trimbleProjectId] - 일부 리전/버전에서 쿼리 projectId 필요 시
 * @returns {Promise<{ ok: true, fileId: string, versionId: string | null } | { ok: false, error: string, status?: number }>}
 */
async function uploadFileToTrimbleFolder(accessToken, apiBase, parentFolderId, fileName, buffer, trimbleProjectId) {
  const base = String(apiBase || '').replace(/\/+$/, '')
  const pid = String(parentFolderId || '').trim()
  const name = String(fileName || 'upload.bin').replace(/[\/\\:*?"<>|]/g, '_') || 'upload.bin'
  const tid = trimbleProjectId && String(trimbleProjectId).trim()
  if (!pid) {
    return { ok: false, error: '업로드 대상 폴더 ID가 없습니다.' }
  }
  if (!buffer || !buffer.length) {
    return { ok: false, error: '파일 내용이 비어 있습니다.' }
  }

  const fsResult = await uploadFileViaTrimbleFsFlow(accessToken, base, pid, name, buffer, tid)
  if (fsResult.ok) return fsResult

  console.warn('[Trimble] FS initiate/commit 실패, 레거시 POST /files 시도:', fsResult.error)

  /**
   * 레거시: POST /files?parentId= 멀티파트 (구 환경·호환용)
   */
  const tryOnce = async (url, fieldName) => {
    const FileCtor = globalThis.File
    const FormDataCtor = globalThis.FormData
    let headers = { Authorization: `Bearer ${accessToken}` }
    let body
    if (FileCtor && FormDataCtor) {
      const form = new FormDataCtor()
      const file = new FileCtor([buffer], name, { type: 'application/octet-stream' })
      form.append(fieldName, file)
      body = form
    } else {
      const legacy = new FormData()
      legacy.append(fieldName, buffer, { filename: name })
      body = legacy
      Object.assign(headers, legacy.getHeaders())
    }
    const res = await fetch(url, { method: 'POST', headers, body })
    const text = await res.text().catch(() => '')
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { _raw: text }
    }
    return { res, data, text }
  }

  const pe = encodeURIComponent(pid)
  /** @type {{ q: string, field: string }[]} */
  const attempts = []
  if (tid) {
    attempts.push({ q: `parentId=${pe}&projectId=${encodeURIComponent(tid)}`, field: 'file' })
  }
  attempts.push({ q: `parentId=${pe}`, field: 'file' })
  attempts.push({ q: `ParentId=${pe}`, field: 'file' })
  if (name && name !== 'file') {
    attempts.push({ q: `parentId=${pe}`, field: name })
  }

  const urlBase = `${base}/files`
  let lastFail = { status: 0, data: null, text: '', url: '' }

  for (const { q, field } of attempts) {
    const url = `${urlBase}?${q}`
    try {
      const { res, data, text } = await tryOnce(url, field)
      if (!res.ok) {
        lastFail = { status: res.status, data, text, url }
        continue
      }
      let fileId = pickCreatedFileId(data)
      let versionId = pickCreatedVersionId(data)
      if (!fileId) {
        const loc = res.headers.get('location') || res.headers.get('Location')
        if (loc && typeof loc === 'string') {
          const m = loc.match(/\/files\/(?:fs\/)?([^/?#]+)/i)
          if (m && m[1]) fileId = decodeURIComponent(m[1])
        }
      }
      if (fileId) {
        return { ok: true, fileId, versionId: versionId != null ? versionId : null }
      }
      lastFail = { status: res.status, data, text: text || JSON.stringify(data), url }
    } catch (e) {
      console.warn('[Trimble] upload try failed', url, field, e.message || e)
      lastFail = {
        status: 0,
        data: null,
        text: e && e.message ? String(e.message) : String(e),
        url,
      }
    }
  }

  const detail = formatTrimbleUploadError(lastFail.status, lastFail.data, lastFail.text)
  const primary = fsResult.error ? `${fsResult.error} | ` : ''
  console.warn('[Trimble] upload exhausted', lastFail.url, detail)
  return {
    ok: false,
    error: `${primary}${detail}${lastFail.url ? ` (요청: ${lastFail.url.split('?')[0]})` : ''}`,
    status: lastFail.status || fsResult.status || 502,
  }
}

module.exports = {
  resolveTrimbleProject,
  listFolderItemsPaged,
  browseTrimbleFolderChildren,
  listAllConnectFiles,
  getTrimbleFileDownloadUrl,
  downloadTrimbleBinary,
  uploadFileToTrimbleFolder,
  sanitizeConnectFolderName,
  getOrCreateConnectFolderInParent,
  resolveTrimbleFolderForDesignRevision,
  findScheduleTrimbleFolderIds,
  deleteTrimbleConnectFolderOnce,
  patchTrimbleConnectFolderName,
}
