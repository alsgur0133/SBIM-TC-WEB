import { useState, useMemo, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getUsersApi, approveUserApi, deleteUserApi, updateUserApi, type ApiUserRow } from '../api/auth'
import type { User, UserFormInput } from '../types/user'
import UserFormModal from '../components/UserFormModal'
import { VirtualDataGrid } from '../components/VirtualDataGrid'

function mapApiUserToUser(row: ApiUserRow): User & { statusLabel: string } {
  const role = row.is_admin ? '관리자' : (row.role || '일반 사용자') as User['role']
  const status = (row.status === '활성' || row.status === '비활성' ? row.status : '비활성') as User['status']
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    status,
    statusLabel: row.status,
    createdAt: row.created_at?.slice(0, 10) ?? '',
    company: row.company ?? undefined,
  }
}

export default function UserManagement() {
  const { user } = useAuth()
  const [users, setUsers] = useState<(User & { statusLabel?: string })[]>([])
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<(User & { statusLabel?: string }) | null>(null)
  const [pendingApprove, setPendingApprove] = useState<(User & { statusLabel?: string }) | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const isProtectedAdmin = (u: { email?: string }) =>
    (u.email || '').toLowerCase() === 'sa'

  function normalizeError(msg: string, forSave = false): string {
    if (!msg) return forSave ? '저장에 실패했습니다.' : '목록을 불러올 수 없습니다.'
    if (msg.includes('경로를 찾을 수 없습니다') || msg.includes('404'))
      return 'API를 사용할 수 없습니다. 터미널에서 "npm run server"로 API 서버를 재시작한 뒤 새로고침해 보세요.'
    if (msg.includes('연결할 수 없습니다') || msg.includes('Failed to fetch'))
      return '서버에 연결할 수 없습니다. API 서버가 실행 중인지 확인하세요. (npm run server)'
    return msg
  }

  const fetchUsers = useCallback(() => {
    if (!user?.email) return
    setError('')
    setLoading(true)
    getUsersApi(user.email)
      .then((res) => {
        if (res.success && res.users) {
          setUsers(res.users.map(mapApiUserToUser))
        } else {
          setError(normalizeError(res.error || '목록을 불러올 수 없습니다.'))
        }
      })
      .catch((err) =>
        setError(normalizeError(err instanceof Error ? err.message : '목록을 불러올 수 없습니다.'))
      )
      .finally(() => setLoading(false))
  }, [user?.email])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.trim().toLowerCase()
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.company || '').toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    )
  }, [users, search])

  const deletableFiltered = useMemo(
    () => filteredUsers.filter((u) => !isProtectedAdmin(u)),
    [filteredUsers]
  )
  const allDeletableSelected =
    deletableFiltered.length > 0 &&
    deletableFiltered.every((u) => selectedIds.has(u.id))
  const someSelected = selectedIds.size > 0
  const oneSelected = selectedIds.size === 1
  const selectedUser = oneSelected
    ? filteredUsers.find((u) => selectedIds.has(u.id)) ?? null
    : null

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allDeletableSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        deletableFiltered.forEach((u) => next.delete(u.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        deletableFiltered.forEach((u) => next.add(u.id))
        return next
      })
    }
  }

  async function deleteSelected() {
    const toDelete = filteredUsers.filter((u) => selectedIds.has(u.id) && !isProtectedAdmin(u))
    if (toDelete.length === 0) {
      setError('삭제할 항목을 선택하세요.')
      return
    }
    if (!window.confirm(`선택한 ${toDelete.length}명의 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return
    if (!user?.email) return
    setError('')
    setDeletingIds(new Set(toDelete.map((u) => u.id)))
    const failed: string[] = []
    for (const u of toDelete) {
      const res = await deleteUserApi(user.email, u.id)
      if (!res.success) failed.push(u.name)
    }
    setDeletingIds(new Set())
    setSelectedIds(new Set())
    if (failed.length > 0) {
      setError(`일부 삭제 실패: ${failed.join(', ')}`)
    }
    setUsers((prev) => prev.filter((u) => !toDelete.some((d) => d.id === u.id)))
  }

  function openCreate() {
    setError('')
    setEditingUser(null)
    setModalOpen(true)
  }

  function openEdit(u: User) {
    setError('')
    setEditingUser(u)
    setModalOpen(true)
  }

  function handleSave(data: UserFormInput, id?: string): void | Promise<void> {
    if (!user?.email) return
    if (id) {
      setError('')
      setSavingUser(true)
      return updateUserApi(user.email, id, {
        name: data.name,
        email: data.email,
        role: data.role,
        status: data.status,
        company: data.company,
      })
        .then((res) => {
          if (res.success) {
            setUsers((prev) =>
              prev.map((u) =>
                u.id === id
                  ? {
                      ...u,
                      name: data.name,
                      email: data.email,
                      role: data.role,
                      status: data.status,
                      statusLabel: data.status,
                      company: data.company,
                    }
                  : u
              )
            )
            setModalOpen(false)
            setEditingUser(null)
          } else {
            const errMsg = res.error || '저장에 실패했습니다.'
            setError(normalizeError(errMsg, true))
            return Promise.reject(new Error(errMsg))
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : '저장에 실패했습니다.'
          setError(normalizeError(msg, true))
          return Promise.reject(err)
        })
        .finally(() => setSavingUser(false))
    } else {
      setUsers((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          ...data,
          createdAt: new Date().toISOString().slice(0, 10),
        } as User & { statusLabel?: string },
      ])
      setModalOpen(false)
      setEditingUser(null)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !user?.email) return
    const u = pendingDelete
    setPendingDelete(null)
    setError('')
    try {
      const res = await deleteUserApi(user.email, u.id)
      if (res.success) {
        setUsers((prev) => prev.filter((usr) => usr.id !== u.id))
      } else {
        const errMsg = res.error || '삭제에 실패했습니다.'
        setError(
          errMsg.includes('경로를 찾을 수 없습니다') || errMsg.includes('404')
            ? '삭제 API를 사용할 수 없습니다. API 서버를 재시작한 뒤 다시 시도해 보세요. (npm run server)'
            : errMsg
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '삭제에 실패했습니다.'
      setError(
        msg.includes('경로를 찾을 수 없습니다') || msg.includes('404')
          ? '삭제 API를 사용할 수 없습니다. API 서버를 재시작한 뒤 다시 시도해 보세요. (npm run server)'
          : msg
      )
    }
  }

  function askApprove(u: User & { statusLabel?: string }) {
    if (u.statusLabel !== '승인대기') return
    setPendingApprove(u)
  }

  async function confirmApprove() {
    if (!pendingApprove || !user?.email) return
    const u = pendingApprove
    setPendingApprove(null)
    setApprovingId(u.id)
    setError('')
    try {
      const res = await approveUserApi(user.email, u.id)
      if (res.success) {
        setUsers((prev) =>
          prev.map((usr) =>
            usr.id === u.id
              ? { ...usr, status: '활성' as const, statusLabel: '활성' }
              : usr
          )
        )
      } else {
        setError(res.error || '승인 처리에 실패했습니다.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '승인 처리에 실패했습니다.')
    } finally {
      setApprovingId(null)
    }
  }

  const statusLabel = (u: (User & { statusLabel?: string })) => u.statusLabel ?? u.status
  const pendingUsers = useMemo(
    () => users.filter((u) => (u.statusLabel ?? u.status) === '승인대기'),
    [users]
  )

  return (
    <div className="user-mgmt">
      <header className="user-mgmt__header">
        <h1 className="user-mgmt__title">사용자 관리</h1>
        <p className="user-mgmt__desc">
          시스템 사용자 목록을 조회·추가·수정·삭제할 수 있습니다. 가입 후 승인 대기 중인 사용자는 아래에서
          <strong> 승인 클릭</strong>으로 로그인을 허용할 수 있습니다.
        </p>
      </header>

      {/* 승인 대기 전용 영역 - 항상 표시 */}
      <section className="user-mgmt__approval-section" aria-label="승인 대기">
        <h2 className="user-mgmt__approval-title">
          승인 대기 {pendingUsers.length > 0 ? `(${pendingUsers.length}명)` : ''}
        </h2>
        {pendingUsers.length === 0 ? (
          <p className="user-mgmt__approval-empty">승인 대기 사용자가 없습니다. (회원가입 시 여기에 표시됩니다)</p>
        ) : (
          <div className="user-mgmt__approval-list">
            {pendingUsers.map((u) => (
              <div key={u.id} className="user-mgmt__approval-item">
                <span className="user-mgmt__approval-name">{u.name}</span>
                <span className="user-mgmt__approval-company" title="회사">
                  {u.company?.trim() ? u.company : '—'}
                </span>
                <span className="user-mgmt__approval-email">{u.email}</span>
                <span className="user-mgmt__approval-date">{u.createdAt}</span>
                <button
                  type="button"
                  className="btn btn--primary user-mgmt__btn-approve"
                  disabled={approvingId === u.id}
                  onClick={() => askApprove(u)}
                  title="해당 사용자 로그인 허용"
                >
                  {approvingId === u.id ? '처리 중...' : '승인 클릭'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="user-mgmt__toolbar">
        <input
          type="search"
          className="user-mgmt__search"
          placeholder="이름, 이메일, 역할로 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="user-mgmt__toolbar-hover">
          <button
            type="button"
            className="btn btn--primary user-mgmt__btn-add"
            onClick={openCreate}
            title="사용자 추가"
          >
            사용자 추가
          </button>
          <button
            type="button"
            className="btn btn--primary user-mgmt__btn-edit-select"
            disabled={!oneSelected}
            onClick={() => selectedUser && openEdit(selectedUser)}
            title={oneSelected ? '선택한 사용자 수정' : '수정할 사용자 1명을 선택하세요'}
          >
            선택 항목 수정
          </button>
        </div>
        <button
          type="button"
          className="btn btn--danger"
          disabled={!someSelected || deletingIds.size > 0}
          onClick={deleteSelected}
          title={someSelected ? `선택한 ${selectedIds.size}명 삭제` : '삭제할 항목을 선택하세요'}
        >
          {deletingIds.size > 0 ? '삭제 중...' : '선택 항목 삭제'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={fetchUsers} disabled={loading}>
          새로고침
        </button>
      </div>

      {error && <div className="auth-form__error">{error}</div>}
      {loading ? (
        <p className="user-mgmt__loading">사용자 목록을 불러오는 중...</p>
      ) : (
        <div className="user-mgmt__table-wrap">
          <table className="user-mgmt__table">
            <thead>
              <tr>
                <th className="user-mgmt__th-check">
                  {deletableFiltered.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allDeletableSelected}
                      onChange={toggleSelectAll}
                      aria-label="전체 선택(삭제 가능한 사용자만)"
                    />
                  )}
                </th>
                <th>이름</th>
                <th>이메일</th>
                <th>업체</th>
                <th>역할</th>
                <th>상태</th>
                <th>가입일</th>
                <th>작업</th>
              </tr>
            </thead>
          </table>
          {filteredUsers.length === 0 ? (
            <div className="user-mgmt__empty" style={{ padding: '1rem' }}>
              {search ? '검색 결과가 없습니다.' : '등록된 사용자가 없습니다.'}
            </div>
          ) : (
            <VirtualDataGrid
              wrapClassName="virtual-data-grid user-mgmt-virtual-grid"
              bodyClassName="virtual-data-grid__body user-mgmt-virtual-body"
              gridTemplateColumns="40px minmax(88px,1fr) minmax(140px,1.6fr) minmax(96px,1fr) minmax(80px,0.9fr) minmax(88px,1fr) minmax(88px,0.85fr) minmax(120px,1.3fr)"
              rowHeight={52}
              scrollResetKey={`${search}|${filteredUsers.length}`}
              getKey={(u) => u.id}
              getRowProps={(u) => ({
                className: 'user-mgmt__row',
                role: 'button',
                tabIndex: 0,
                onDoubleClick: () => openEdit(u),
                onKeyDown: (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openEdit(u)
                  }
                },
                'aria-label': `${u.name} 더블클릭 시 수정`,
                title: '더블클릭 시 수정',
              })}
              renderRow={(u) => (
                <>
                  <span className="user-mgmt__td-check" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    {isProtectedAdmin(u) ? (
                      <span className="user-mgmt__no-delete" title="기본 관리자 계정은 삭제할 수 없습니다.">
                        —
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                        disabled={deletingIds.has(u.id)}
                        aria-label={`${u.name} 선택`}
                      />
                    )}
                  </span>
                  <span>{u.name}</span>
                  <span>{u.email}</span>
                  <span>{u.company || '—'}</span>
                  <span>{u.role}</span>
                  <span>
                    <span className={`user-mgmt__status user-mgmt__status--${u.status === '활성' ? 'active' : 'inactive'}`}>
                      {statusLabel(u)}
                    </span>
                  </span>
                  <span>{u.createdAt}</span>
                  <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <div className="user-mgmt__actions">
                      {statusLabel(u) === '승인대기' && user?.email && (
                        <button
                          type="button"
                          className="btn btn--sm btn--primary user-mgmt__btn-approve"
                          disabled={approvingId === u.id}
                          onClick={() => askApprove(u)}
                          title="해당 사용자 로그인 허용"
                        >
                          {approvingId === u.id ? '처리 중...' : '승인 클릭'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--sm btn--secondary user-mgmt__btn-edit-hover"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(u)
                        }}
                        title="수정"
                      >
                        수정
                      </button>
                    </div>
                  </span>
                </>
              )}
              items={filteredUsers}
            />
          )}
        </div>
      )}

      <UserFormModal
        open={modalOpen}
        user={editingUser}
        onClose={() => { setModalOpen(false); setEditingUser(null); setError('') }}
        onSave={handleSave}
        saving={savingUser}
        saveError={modalOpen && editingUser ? error : undefined}
      />

      {pendingApprove && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="approve-confirm-title">
          <div className="modal">
            <h2 id="approve-confirm-title" className="modal__title">사용자 승인</h2>
            <div className="modal__body">
              <p>
                <strong>"{pendingApprove.name}"</strong>
                {pendingApprove.company?.trim() ? (
                  <> · 회사: <strong>{pendingApprove.company}</strong></>
                ) : null}
                <br />
                ( {pendingApprove.email} ) 사용자를 승인하시겠습니까?
              </p>
              <p className="user-mgmt__confirm-note">
                승인하면 해당 사용자가 로그인할 수 있습니다.
              </p>
            </div>
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setPendingApprove(null)}
              >
                아니오
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={confirmApprove}
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <div className="modal">
            <h2 id="delete-confirm-title" className="modal__title">사용자 삭제</h2>
            <div className="modal__body">
              <p>
                정말 <strong>"{pendingDelete.name}"</strong>( {pendingDelete.email} ) 사용자를 삭제하시겠습니까?
              </p>
              <p className="user-mgmt__confirm-note">
                삭제된 사용자는 로그인할 수 없으며, 이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setPendingDelete(null)}
              >
                아니오
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={confirmDelete}
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
