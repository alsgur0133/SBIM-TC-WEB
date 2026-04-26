export const CODE_MGMT_SYSTEMS = ['OBS', 'MBS', 'WBS', 'CBS', 'UBS'] as const
export type CodeMgmtSystem = (typeof CODE_MGMT_SYSTEMS)[number]

export const CODE_MGMT_SYSTEM_LABELS: Record<CodeMgmtSystem, string> = {
  OBS: '객체분류체계 (OBS)',
  MBS: '모델분류체계 (MBS)',
  WBS: '작업분류체계 (WBS)',
  CBS: '내역분류체계 (CBS)',
  UBS: '사용자분류체계 (UBS)',
}

/** URL 쿼리 ?system=OBS|MBS|… 파싱. 없거나 잘못된 값이면 OBS */
export function parseCodeMgmtSystemQuery(raw: string | null): CodeMgmtSystem {
  if (raw == null || raw.trim() === '') return 'OBS'
  const u = raw.trim().toUpperCase()
  return (CODE_MGMT_SYSTEMS as readonly string[]).includes(u) ? (u as CodeMgmtSystem) : 'OBS'
}

/** 구 링크 호환: 코드관리 화면으로 이동 (분류체계는 쿼리로 보존) */
export function codeMgmtUrlWithSystem(system: CodeMgmtSystem): string {
  return `/code-mgmt?system=${encodeURIComponent(system)}`
}
