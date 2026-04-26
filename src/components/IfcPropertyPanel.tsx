import type { ObjectProperties } from 'trimble-connect-workspace-api'

function formatPropValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object' && v !== null && 'value' in (v as object)) {
    const o = v as { value?: unknown }
    return o.value === null || o.value === undefined ? '—' : String(o.value)
  }
  return String(v)
}

/**
 * Trimble Connect 뷰어 getObjectProperties 결과 — IFC에서 온 속성 세트를 트리/표로 표시
 */
export default function IfcPropertyPanel({
  obj,
  expandAllPropertySets,
  resolvedIfcExpressId,
  trimbleRuntimeId,
}: {
  obj: ObjectProperties | null
  /** true면 모든 속성 세트(details)를 펼친 상태로 표시 (하단 객체 목록 등) */
  expandAllPropertySets?: boolean
  /** 서버 IFC / GlobalId 매칭으로 복원한 STEP express — 모델 정보의 ElementId와 동일 */
  resolvedIfcExpressId?: number | null
  /** Trimble 뷰어 내부 객체 ID(0,1,2…). IFC express와 다름 */
  trimbleRuntimeId?: number | null
}) {
  if (!obj) {
    return <p className="trimble-workbench__muted">뷰어에서 객체를 선택하면 IFC 속성이 표시됩니다.</p>
  }

  const sets = obj.properties ?? []
  const product = obj.product

  return (
    <div className="trimble-workbench__ifc">
      <div className="trimble-workbench__ifc-meta">
        {resolvedIfcExpressId != null && Number.isFinite(resolvedIfcExpressId) && (
          <p className="trimble-workbench__ifc-line" title="web-ifc·서버 IFC와 동일한 STEP express 번호입니다.">
            <span className="trimble-workbench__ifc-k">IFC ElementId</span> {Math.floor(resolvedIfcExpressId)}
          </p>
        )}
        {trimbleRuntimeId != null && Number.isFinite(trimbleRuntimeId) && (
          <p
            className="trimble-workbench__ifc-line"
            title="Trimble Connect 뷰어가 부여한 내부 ID입니다. IFC ElementId(STEP)와 다를 수 있습니다."
          >
            <span className="trimble-workbench__ifc-k">뷰어 내부 ID</span> {String(trimbleRuntimeId)}
          </p>
        )}
        {obj.class != null && obj.class !== '' && (
          <p className="trimble-workbench__ifc-line">
            <span className="trimble-workbench__ifc-k">IFC 클래스</span> {obj.class}
          </p>
        )}
        {product?.objectType != null && product.objectType !== '' && (
          <p className="trimble-workbench__ifc-line">
            <span className="trimble-workbench__ifc-k">객체 유형</span> {product.objectType}
          </p>
        )}
        {product?.name != null && product.name !== '' && (
          <p className="trimble-workbench__ifc-line">
            <span className="trimble-workbench__ifc-k">제품/이름</span> {product.name}
          </p>
        )}
      </div>
      {sets.length === 0 ? (
        <p className="trimble-workbench__muted">이 객체에 대한 속성 세트가 없습니다.</p>
      ) : (
        sets.map((ps, idx) => (
          <details
            key={`${ps.name ?? 'ps'}-${idx}`}
            className="trimble-workbench__ifc-pset"
            open={expandAllPropertySets ? true : idx < 3}
          >
            <summary className="trimble-workbench__ifc-pset-sum">{ps.name || '(속성 세트)'}</summary>
            <table className="trimble-workbench__prop-table trimble-workbench__prop-table--ifc">
              <thead>
                <tr>
                  <th>속성</th>
                  <th>값</th>
                </tr>
              </thead>
              <tbody>
                {(ps.properties ?? []).map((p, i) => (
                  <tr key={`${p.name}-${i}`}>
                    <td title={p.name}>{p.name}</td>
                    <td>{formatPropValue(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))
      )}
    </div>
  )
}
