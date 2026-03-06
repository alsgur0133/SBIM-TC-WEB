import { Link } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'

export default function Quantity() {
  const { selectedProject } = useProject()
  const {
    selectedPhaseId,
    selectedRevisionId,
    selectedPhase,
    selectedRevision,
    loadingPhases,
  } = useDesignSchedule()

  if (!selectedProject) {
    return (
      <section className="card">
        <h2>물량 관리</h2>
        <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
          물량 관리는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
        </p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/projects" className="btn btn--primary">
            프로젝트 관리에서 선택하기
          </Link>
        </p>
      </section>
    )
  }

  if (!selectedPhaseId && !loadingPhases) {
    return (
      <section className="card">
        <h2>물량 관리</h2>
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          프로젝트: <strong>{selectedProject.name}</strong>
        </p>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          <strong>설계 차수</strong>와 <strong>리비전</strong>을 선택하세요. 상단 헤더에서 선택하거나, 설계일정 관리에서 차수·리비전을 먼저 등록해 두어야 합니다.
        </p>
      </section>
    )
  }

  if (selectedPhaseId && !selectedRevisionId) {
    return (
      <section className="card">
        <h2>물량 관리</h2>
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          프로젝트: <strong>{selectedProject.name}</strong> · 설계 차수: <strong>{selectedPhase?.name ?? '선택됨'}</strong>
        </p>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          상단 헤더에서 <strong>리비전</strong>을 선택하면 해당 리비전 기준 물량 데이터를 조회할 수 있습니다.
        </p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>물량 관리</h2>
      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
        프로젝트: <strong>{selectedProject.name}</strong> · 설계 차수: <strong>{selectedPhase?.name}</strong> · 리비전: <strong>{selectedRevision?.revision_name}</strong>
      </p>
      <p>
        물량 데이터를 관리하는 화면입니다. 추후 기능을 확장할 수 있습니다.
      </p>
    </section>
  )
}
