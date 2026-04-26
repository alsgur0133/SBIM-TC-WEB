import { flattenIfcProps } from '../lib/ifcModelSession'

export type IfcQtyLine = { name: string; value: string }

const QTY_MEASURE_KEYS = ['LengthValue', 'AreaValue', 'VolumeValue', 'WeightValue', 'CountValue', 'TimeValue'] as const

const PATH_HINT =
  /quantity|qto_|tekla|basequantit|elementquantity|footprint|surface|tons|gross|net|calculated|physical|measure/i

const LEAF_NAME_HINT =
  /^(weight|volume|length|width|height|depth|area|count|gross|net|perimeter|thickness)$/i

function unwrapNestedValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object' && v !== null && 'value' in v) {
    return unwrapNestedValue((v as { value: unknown }).value)
  }
  return ''
}

function tryQuantityMeasure(obj: Record<string, unknown>): string | null {
  for (const k of QTY_MEASURE_KEYS) {
    if (!(k in obj)) continue
    const s = unwrapNestedValue(obj[k])
    if (s !== '') return s
  }
  return null
}

function prettifyLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
}

function formatNumericDisplay(s: string): string {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (Math.abs(n) >= 1e6) return n.toExponential(3)
  const t = Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '')
  return t
}

/**
 * web-ifc getItemProperties(recursive) 결과에서 Qto_* / Tekla 등 물량·치수 성격 항목만 골라냄.
 */
export function extractIfcQuantityLines(props: Record<string, unknown>): IfcQtyLine[] {
  const out: IfcQtyLine[] = []
  const seen = new Set<string>()

  function pushUnique(name: string, value: string) {
    const v = formatNumericDisplay(value.trim())
    if (!v) return
    const sig = `${name}\0${v}`
    if (seen.has(sig)) return
    seen.add(sig)
    out.push({ name: prettifyLabel(name), value: v })
  }

  function walk(o: unknown, path: string, depth: number) {
    if (depth > 16 || o == null) return
    if (Array.isArray(o)) {
      for (const el of o) walk(el, path, depth + 1)
      return
    }
    if (typeof o !== 'object') return
    const rec = o as Record<string, unknown>
    for (const k of Object.keys(rec)) {
      const v = rec[k]
      const p = path ? `${path}.${k}` : k
      if (v && typeof v === 'object') {
        const vo = v as Record<string, unknown>
        const q = tryQuantityMeasure(vo)
        if (q != null) {
          if (PATH_HINT.test(p) || LEAF_NAME_HINT.test(k)) {
            pushUnique(k, q)
            continue
          }
        }
        if ('value' in vo && typeof vo.value !== 'object') {
          const raw = String(vo.value ?? '').trim()
          if (raw && /^-?\d/.test(raw)) {
            if (PATH_HINT.test(p) || LEAF_NAME_HINT.test(k)) {
              pushUnique(k, raw)
              continue
            }
          }
        }
        walk(v, p, depth + 1)
      }
    }
  }

  walk(props, '', 0)

  const flat = flattenIfcProps(props)
  for (const { key, value } of flat) {
    const val = String(value ?? '').trim()
    if (!val) continue
    const last = key.split('.').pop() || key
    if (PATH_HINT.test(key) || LEAF_NAME_HINT.test(last)) {
      if (/^-?\d/.test(val) || /^-?\d+\.\d+$/.test(val)) {
        pushUnique(last, val)
      }
    }
  }

  return out
}

export function formatIfcQuantitySummary(lines: IfcQtyLine[], maxLen = 72): string {
  if (!lines.length) return ''
  const parts = lines.slice(0, 5).map((l) => `${l.name}: ${l.value}`)
  let s = parts.join(' · ')
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + '…'
  return s
}

export function formatIfcQuantityTooltip(lines: IfcQtyLine[]): string {
  if (!lines.length) return ''
  return lines.map((l) => `${l.name}\t${l.value}`).join('\n')
}
