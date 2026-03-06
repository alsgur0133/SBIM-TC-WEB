import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getPendingUsersApi, approveUserApi } from '../api/auth'

interface PendingUser {
  id: string
  name: string
  email: string
  created_at: string
}

function formatDate(value: string) {
  if (!value) return '-'
  const d = value.slice(0, 10)
  return d.replace(/-/g, '.')
}

export default function PendingApproval() {
  const { user } = useAuth()
  const [list, setList] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const isAdmin = user?.isAdmin === true || user?.email === 'sa'

  function normalizeError(msg: string): string {
    if (!msg) return '목록을 불러올 수 없습니다.'
    if (msg.includes('경로를 찾을 수 없습니다') || msg.includes('404'))
      return '승인 대기 API를 사용할 수 없습니다. 터미널에서 "npm run server"로 API 서버를 실행했는지 확인하세요.'
    if (msg.includes('연결할 수 없습니다') || msg.includes('Failed to fetch'))
      return '서버에 연결할 수 없습니다. API 서버가 실행 중인지 확인하세요. (npm run server)'
    return msg
  }

  const fetchList = useCallback(() => {
    if (!user?.email || !isAdmin) return
    setError('')
    setLoading(true)
    getPendingUsersApi(user.email)
      .then((res) => {
        if (res.success && res.users) setList(res.users)
        else setError(normalizeError(res.error || '목록을 불러올 수 없습니다.'))
      })
      .catch((err) => setError(normalizeError(err instanceof Error ? err.message : '목록을 불러올 수 없습니다.')))
      .finally(() => setLoading(false))
  }, [user?.email, isAdmin])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  async function handleApprove(pendingUser: PendingUser) {
    if (!user?.email) return
    setApprovingId(pendingUser.id)
    setError('')
    try {
      const res = await approveUserApi(user.email, pendingUser.id)
      if (res.success) {
        setList((prev) => prev.filter((u) => u.id !== pendingUser.id))
      } else {
        setError(res.error || '승인에 실패했습니다.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '승인에 실패했습니다.')
    } finally {
      setApprovingId(null)
    }
  }

  return (
    <div className="user-mgmt">
      <header className="user-mgmt__header">
        <h1 className="user-mgmt__title">승인 대기</h1>
        <p className="user-mgmt__desc">
          회원가입 후 관리자 승인을 기다리는 사용자 목록입니다. 승인하면 해당 사용자가 로그인할 수 있습니다.
        </p>
      </header>

      <div className="user-mgmt__toolbar">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => fetchList()}
          disabled={loading}
        >
          새로고침
        </button>
      </div>

      {error && <div className="auth-form__error">{error}</div>}

      {loading ? (
        <div className="card">
          <p className="user-mgmt__empty">불러오는 중...</p>
        </div>
      ) : list.length === 0 ? (
        <div className="card">
          <p className="user-mgmt__empty">승인 대기 중인 사용자가 없습니다.</p>
        </div>
      ) : (
        <div className="user-mgmt__table-wrap">
          <table className="user-mgmt__table">
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>가입 신청일</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {list.map((pending) => (
                <tr key={pending.id}>
                  <td>{pending.name}</td>
                  <td>{pending.email}</td>
                  <td>{formatDate(pending.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={approvingId === pending.id}
                      onClick={() => handleApprove(pending)}
                    >
                      {approvingId === pending.id ? '처리 중...' : '승인'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
