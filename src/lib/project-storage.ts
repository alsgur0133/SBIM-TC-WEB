/** localStorage: 선택된 BRACE 프로젝트 id */
export const SELECTED_PROJECT_ID_KEY = 'sbim-tc-selected-project-id'

export function clearStoredProjectSelection(): void {
  try {
    localStorage.removeItem(SELECTED_PROJECT_ID_KEY)
  } catch {
    /* ignore */
  }
}

/** sessionStorage: 설계 차수/리비전 (로그인 직후 깨끗한 상태용) */
export function clearDesignScheduleSessionStorage(): void {
  try {
    sessionStorage.removeItem('sbim-tc-selected-phase-id')
    sessionStorage.removeItem('sbim-tc-selected-revision-id')
  } catch {
    /* ignore */
  }
}

/** 로그인/로그아웃 시 프로젝트·일정 선택 상태 초기화 */
export function clearProjectSessionAfterAuth(): void {
  clearStoredProjectSelection()
  clearDesignScheduleSessionStorage()
}
