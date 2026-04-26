/**
 * IFC STEP 물리 파일에서 헤더·주요 엔티티 이름을 가볍게 추출 (web-ifc 없음).
 * 대용량 파일은 앞부분만 읽습니다.
 */
const fs = require('fs')

const MAX_READ_BYTES = 35 * 1024 * 1024

/** STEP 문자열 리터럴 내부: '' → ' */
function unescapeStepString(s) {
  return String(s || '').replace(/''/g, "'")
}

/**
 * IFC 엔티티에서 n번째 인자가 문자열이면 반환 (0-based, # 참조·$·숫자는 스킵).
 * 완전 파서는 아니며 일반적인 IFCPROJECT/IFCSITE/IFCBUILDING 행에 맞춤.
 */
function extractNthStringArg(entityBody, index) {
  const inner = entityBody.trim()
  let i = 0
  let arg = 0
  const len = inner.length
  while (i < len && arg < index) {
    while (i < len && /[\s,]/.test(inner[i])) i++
    if (i >= len) return null
    const c = inner[i]
    if (c === "'") {
      i++
      let s = ''
      while (i < len) {
        if (inner[i] === "'" && inner[i + 1] === "'") {
          s += "'"
          i += 2
          continue
        }
        if (inner[i] === "'") break
        s += inner[i++]
      }
      if (inner[i] === "'") i++
      if (arg === index) return unescapeStepString(s)
      arg++
      continue
    }
    if (c === '#' || c === '$' || /[\d.-]/.test(c)) {
      while (i < len && !/[\s,)]/.test(inner[i])) i++
      arg++
      continue
    }
    if (c === '(') {
      let depth = 1
      i++
      while (i < len && depth > 0) {
        if (inner[i] === '(') depth++
        else if (inner[i] === ')') depth--
        i++
      }
      arg++
      continue
    }
    i++
  }
  return null
}

function matchEntity(text, typeName) {
  const re = new RegExp(`${typeName}\\s*\\(([^;]*?)\\)\\s*;`, 'gi')
  const matches = []
  let m
  while ((m = re.exec(text)) !== null) {
    matches.push(m[1])
  }
  return matches
}

function extractIfcSummaryFromString(text) {
  const out = {
    version: 1,
    headerRaw: null,
    fileDescription: null,
    fileName: null,
    fileSchema: null,
    projectName: null,
    siteName: null,
    buildingName: null,
    applicationName: null,
    applicationVersion: null,
    entityCounts: {},
  }

  const headerEnd = text.indexOf('ENDSEC;')
  const dataStart = text.indexOf('DATA;')
  if (headerEnd !== -1 && dataStart !== -1 && headerEnd < dataStart) {
    out.headerRaw = text.slice(0, Math.min(headerEnd + 7, 20000)).trim()
  }

  const fd = text.match(/FILE_DESCRIPTION\s*\(([^;]*)\)\s*;/is)
  if (fd) out.fileDescription = fd[1].replace(/\s+/g, ' ').trim().slice(0, 2000)

  const fn = text.match(/FILE_NAME\s*\(([^;]*)\)\s*;/is)
  if (fn) {
    const inner = fn[1]
    const strings = []
    let i = 0
    while (i < inner.length) {
      while (i < inner.length && /[\s,]/.test(inner[i])) i++
      if (inner[i] === "'") {
        i++
        let s = ''
        while (i < inner.length) {
          if (inner[i] === "'" && inner[i + 1] === "'") {
            s += "'"
            i += 2
            continue
          }
          if (inner[i] === "'") break
          s += inner[i++]
        }
        if (inner[i] === "'") i++
        strings.push(unescapeStepString(s))
      } else i++
    }
    if (strings.length >= 1) {
      out.fileName = {
        name: strings[0] || null,
        timeStamp: strings[1] || null,
        author: strings[2] || null,
        organization: strings[3] || null,
        preprocessorVersion: strings[4] || null,
        originatingSystem: strings[5] || null,
        authorization: strings[6] || null,
      }
    }
  }

  const fsch = text.match(/FILE_SCHEMA\s*\(([^;]*)\)\s*;/is)
  if (fsch) {
    const ids = fsch[1].match(/'([^']*)'/g)
    out.fileSchema = ids ? ids.map((s) => s.replace(/'/g, '')) : [fsch[1].trim().slice(0, 500)]
  }

  const projBodies = matchEntity(text, 'IFCPROJECT')
  if (projBodies.length) {
    const name = extractNthStringArg(projBodies[0], 2)
    if (name) out.projectName = name
  }

  const siteBodies = matchEntity(text, 'IFCSITE')
  if (siteBodies.length) {
    const name = extractNthStringArg(siteBodies[0], 2)
    if (name) out.siteName = name
  }

  const bldgBodies = matchEntity(text, 'IFCBUILDING')
  if (bldgBodies.length) {
    const name = extractNthStringArg(bldgBodies[0], 2)
    if (name) out.buildingName = name
  }

  const appBodies = matchEntity(text, 'IFCAPPLICATION')
  if (appBodies.length) {
    out.applicationName = extractNthStringArg(appBodies[0], 1)
    out.applicationVersion = extractNthStringArg(appBodies[0], 2)
  }

  const countType = (t) => {
    const r = new RegExp(`=${t}\\s*\\(`, 'gi')
    const a = text.match(r)
    return a ? a.length : 0
  }
  /** IFC 부재·건축 요소 유형별 개수 (파일 앞부분 기준, 참고용) */
  const BUJE_IFC_TYPES = [
    'IFCWALL',
    'IFCWALLSTANDARDCASE',
    'IFCWALLTYPE',
    'IFCSLAB',
    'IFCSLABSTANDARDCASE',
    'IFCROOF',
    'IFCFOOTING',
    'IFCPILE',
    'IFCBEAM',
    'IFCBEAMSTANDARDCASE',
    'IFCCOLUMN',
    'IFCCOLUMNSTANDARDCASE',
    'IFCMEMBER',
    'IFCMEMBERSTANDARDCASE',
    'IFCPLATE',
    'IFCPLATESTANDARDCASE',
    'IFCDOOR',
    'IFCWINDOW',
    'IFCOPENINGELEMENT',
    'IFCVOIDINGFEATURE',
    'IFCSTAIR',
    'IFCSTAIRFLIGHT',
    'IFCRAILING',
    'IFCRAMP',
    'IFCCURTAINWALL',
    'IFCBUILDINGELEMENTPROXY',
    'IFCELEMENTASSEMBLY',
    'IFCGRID',
  ]
  const bujeByType = {}
  for (const t of BUJE_IFC_TYPES) {
    const c = countType(t)
    if (c > 0) bujeByType[t] = c
  }
  out.bujeByType = bujeByType
  out.entityCounts = {
    IFCPROJECT: countType('IFCPROJECT'),
    IFCSITE: countType('IFCSITE'),
    IFCBUILDING: countType('IFCBUILDING'),
    IFCBUILDINGSTOREY: countType('IFCBUILDINGSTOREY'),
    IFCWALL: countType('IFCWALL'),
    IFCSLAB: countType('IFCSLAB'),
  }

  return out
}

function extractIfcSummaryFromFile(absPath) {
  const stat = fs.statSync(absPath)
  const toRead = Math.min(stat.size, MAX_READ_BYTES)
  const fd = fs.openSync(absPath, 'r')
  const buf = Buffer.alloc(toRead)
  fs.readSync(fd, buf, 0, toRead, 0)
  fs.closeSync(fd)
  let text
  try {
    text = buf.toString('utf8')
  } catch (_) {
    text = buf.toString('latin1')
  }
  const summary = extractIfcSummaryFromString(text)
  summary.bytesRead = toRead
  summary.fileSizeBytes = stat.size
  summary.truncated = stat.size > toRead
  return summary
}

module.exports = {
  extractIfcSummaryFromFile,
  extractIfcSummaryFromString,
  extractNthStringArg,
  unescapeStepString,
}
