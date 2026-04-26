import type { QuantityRevisionItem } from '../api/quantityFile'

/** 부재별 집계표 파서가 만든 콘크리트 행 + 철근·부속 하위 행을 B.O.M 한 줄로 묶음 */
export type BomBuiltRow = {
  concrete: QuantityRevisionItem
  childItems: QuantityRevisionItem[]
  drawNo: string
  concStrength: string
  structNo: string
  floor: string
  qty: string
  totalVol: string
  unitVol: string
  width: string
  height: string
  depth: string
  rebar: Record<string, string>
}

export function extractFormulaValue(formula: string | null | undefined, key: string): string {
  if (!formula || !key) return ''
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${esc}=([^,]+)`)
  const m = formula.match(re)
  return m ? m[1].trim() : ''
}

export function parseSizeMm(formula: string | null | undefined): { w: string; h: string; d: string } {
  const m = (formula || '').match(/SIZE\(㎜\)=([^,]+)/)
  if (!m) return { w: '', h: '', d: '' }
  const parts = m[1].split(/×|x|X/)
  return {
    w: (parts[0] || '').trim(),
    h: (parts[1] || '').trim(),
    d: (parts[2] || '').trim(),
  }
}

const RE_CONCRETE = /^콘크리트\s+(.+)$/
const RE_REBAR = /^철근·부속\s/

export function buildBomViewFromItems(items: QuantityRevisionItem[]): {
  rows: BomBuiltRow[]
  extraColLabels: string[]
} | null {
  const sorted = [...items].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.id - b.id
  })

  const hasConcrete = sorted.some((it) => RE_CONCRETE.test((it.name || '').trim()))
  if (!hasConcrete) return null

  const rows: BomBuiltRow[] = []
  let current: BomBuiltRow | null = null
  const colSet = new Set<string>()

  const flush = () => {
    if (current) {
      rows.push(current)
      current = null
    }
  }

  for (const it of sorted) {
    const name = (it.name || '').trim()
    const cm = name.match(RE_CONCRETE)
    if (cm) {
      flush()
      const drawNo = cm[1].trim()
      const { w, h, d } = parseSizeMm(it.formula)
      current = {
        concrete: it,
        childItems: [],
        drawNo,
        concStrength: (it.spec || '').trim(),
        structNo: (it.sign || '').trim(),
        floor: (it.floor || '').trim(),
        qty: extractFormulaValue(it.formula, '수량'),
        totalVol: (it.result_value || '').trim(),
        unitVol: extractFormulaValue(it.formula, '단위물량'),
        width: w,
        height: h,
        depth: d,
        rebar: {},
      }
      continue
    }

    if (current && RE_REBAR.test(name) && (it.spec || '').trim()) {
      const spec = (it.spec || '').trim()
      colSet.add(spec)
      current.rebar[spec] = (it.result_value || '').trim()
      current.childItems.push(it)
      continue
    }

    flush()
  }
  flush()

  if (rows.length === 0) return null

  const extraColLabels = Array.from(colSet).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
  return { rows, extraColLabels }
}

export function allIdsForBomRow(row: BomBuiltRow): number[] {
  return [row.concrete.id, ...row.childItems.map((c) => c.id)]
}

export function bomRowMatchesSearch(row: BomBuiltRow, q: string): boolean {
  if (!q.trim()) return true
  const s = q.toLowerCase()
  const parts: string[] = [
    row.drawNo,
    row.concStrength,
    row.structNo,
    row.floor,
    row.qty,
    row.totalVol,
    row.unitVol,
    row.width,
    row.height,
    row.depth,
    row.concrete.formula ?? '',
    row.concrete.guid ?? '',
    ...Object.entries(row.rebar).flatMap(([k, v]) => [k, v]),
  ]
  return parts.some((p) => String(p).toLowerCase().includes(s))
}

export function parseCellNumber(v: string | undefined | null): number | null {
  if (v == null || String(v).trim() === '') return null
  const n = parseFloat(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

export function formatBomTotal(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return n.toLocaleString('ko-KR')
  const t = n.toFixed(4).replace(/\.?0+$/, '')
  return t
}
