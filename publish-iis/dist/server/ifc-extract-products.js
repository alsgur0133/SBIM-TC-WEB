/**
 * IFC STEP 파일을 줄 단위로 읽어 IfcProduct 계열 엔티티 목록 추출 (web-ifc 없음).
 * IfcRoot 계열 가정: 문자열 인자 0=GlobalId, 2=Name, 4=ObjectType (일반보내기 기준).
 */

const fs = require('fs')
const readline = require('readline')
const { extractNthStringArg } = require('./ifc-extract-summary')
const { isIfcProductType } = require('./ifc-product-types')

const DEFAULT_MAX_ROWS = 250000

/**
 * @param {string} line
 * @returns {{ expressID: number, typeName: string, body: string } | null}
 */
function parseStepEntityLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('*')) return null
  const m = trimmed.match(/^#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/)
  if (!m) return null
  const expressID = parseInt(m[1], 10)
  if (!Number.isFinite(expressID)) return null
  const typeName = m[2].toUpperCase()
  let depth = 1
  let i = m[0].length
  const len = trimmed.length
  while (i < len && depth > 0) {
    const c = trimmed[i]
    if (c === "'") {
      i++
      while (i < len) {
        if (trimmed[i] === "'" && trimmed[i + 1] === "'") {
          i += 2
          continue
        }
        if (trimmed[i] === "'") {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth--
    i++
  }
  if (depth !== 0) return null
  const body = trimmed.slice(m[0].length, i - 1)
  return { expressID, typeName, body }
}

/**
 * @param {string} absPath
 * @param {{ maxRows?: number }} [options]
 * @returns {Promise<{ version: number, rows: object[], total: number, truncated: boolean, storedCount: number }>}
 */
async function extractIfcProductsFromFileStream(absPath, options = {}) {
  const maxRows = Math.min(Math.max(options.maxRows ?? DEFAULT_MAX_ROWS, 1000), 500000)
  const rows = []
  let totalMatched = 0
  let truncated = false

  const rl = readline.createInterface({
    input: fs.createReadStream(absPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const parsed = parseStepEntityLine(line)
    if (!parsed) continue
    if (!isIfcProductType(parsed.typeName)) continue
    totalMatched += 1
    if (rows.length < maxRows) {
      const globalId = extractNthStringArg(parsed.body, 0) || ''
      const name = extractNthStringArg(parsed.body, 2) || ''
      const objectType = extractNthStringArg(parsed.body, 4) || ''
      rows.push({
        expressID: parsed.expressID,
        typeName: parsed.typeName,
        name,
        globalId,
        objectType,
      })
    } else {
      truncated = true
    }
  }

  return {
    version: 1,
    rows,
    total: totalMatched,
    truncated,
    storedCount: rows.length,
  }
}

module.exports = {
  extractIfcProductsFromFileStream,
  DEFAULT_MAX_ROWS,
  parseStepEntityLine,
}
