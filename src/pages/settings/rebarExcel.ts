import * as XLSX from 'xlsx'
import type { ColumnDef } from './rebarDbColumns'

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '_').trim() || 'export'
}

/** 1행 = 한글 헤더(컬럼 정의 label), 이후 데이터 */
export function exportRebarRowsToXlsx(
  cols: ColumnDef[],
  dataRows: Record<string, string>[],
  fileBaseName: string
): void {
  const aoa: (string | number)[][] = [cols.map((c) => c.label)]
  for (const row of dataRows) {
    aoa.push(cols.map((c) => (row[c.key] != null ? String(row[c.key]) : '')))
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const name = sanitizeFilenamePart(fileBaseName)
  XLSX.writeFile(wb, `${name}.xlsx`)
}

/** 헤더 셀과 label이 일치하면 해당 key로 매핑. 이전보내기 호환: 직경(mm) → 직경 컬럼 */
function buildLabelToKeyMap(cols: ColumnDef[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of cols) {
    m.set(c.label.trim(), c.key)
  }
  const dMm = cols.find((c) => c.key === 'diameter_mm')
  if (dMm && !m.has('직경(mm)')) m.set('직경(mm)', 'diameter_mm')
  return m
}

export async function parseRebarXlsxToRows(file: File, cols: ColumnDef[]): Promise<Record<string, string>[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as (
    | string
    | number
    | null
    | undefined
  )[][]
  if (!aoa.length) return []

  const labelToKey = buildLabelToKeyMap(cols)
  const headerRow = (aoa[0] ?? []).map((h) => String(h ?? '').trim())
  const colIndexToKey: (string | null)[] = headerRow.map((h) => labelToKey.get(h) ?? null)

  const empty = (): Record<string, string> => {
    const o: Record<string, string> = {}
    for (const c of cols) o[c.key] = ''
    return o
  }

  const out: Record<string, string>[] = []
  for (let r = 1; r < aoa.length; r++) {
    const line = aoa[r]
    if (!line || !line.some((cell) => String(cell ?? '').trim() !== '')) continue
    const row = empty()
    let any = false
    for (let i = 0; i < colIndexToKey.length; i++) {
      const key = colIndexToKey[i]
      if (!key) continue
      const v = line[i]
      const s = v != null ? String(v).trim() : ''
      if (s) any = true
      row[key] = s
    }
    if (any) out.push(row)
  }
  return out
}
