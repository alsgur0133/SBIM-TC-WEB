import {
  getPhasesApi,
  createPhaseApi,
  getRevisionsApi,
  createRevisionApi,
} from '../api/designSchedule'

/** 프로젝트에 설계차수·리비전이 없으면 기본 항목을 만들고 리비전 id를 반환합니다. */
export async function ensureDefaultDesignRevisionId(
  userEmail: string,
  projectId: string
): Promise<string> {
  const phasesRes = await getPhasesApi(projectId)
  const phases = phasesRes.success && phasesRes.phases ? phasesRes.phases : []
  let phaseId = phases[0]?.id
  if (!phaseId) {
    const created = await createPhaseApi(userEmail, '기본 설계차수', projectId)
    if (!created.success || !created.phase?.id) {
      throw new Error(created.error || '기본 설계차수를 만들 수 없습니다.')
    }
    phaseId = created.phase.id
  }
  const revRes = await getRevisionsApi(phaseId)
  const revs = revRes.success && revRes.revisions ? revRes.revisions : []
  if (revs.length > 0) return revs[0].id
  const r = await createRevisionApi(userEmail, phaseId, 'R0')
  if (!r.success || !r.revision?.id) {
    throw new Error(r.error || '기본 리비전을 만들 수 없습니다.')
  }
  return r.revision.id
}
