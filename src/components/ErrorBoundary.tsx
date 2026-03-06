import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div style={{
          padding: '2rem',
          maxWidth: '600px',
          margin: '2rem auto',
          fontFamily: 'system-ui, sans-serif',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}>
          <h2 style={{ margin: '0 0 0.5rem', color: '#dc2626' }}>오류가 발생했습니다</h2>
          <p style={{ margin: 0, color: '#64748b' }}>
            아래 오류를 확인한 뒤, 페이지를 새로고침하거나 로그아웃 후 다시 시도하세요.
          </p>
          <pre style={{
            marginTop: '1rem',
            padding: '1rem',
            background: '#f8fafc',
            borderRadius: '6px',
            fontSize: '0.85rem',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {this.state.error.message}
          </pre>
          <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#64748b' }}>
            문제가 계속되면 브라우저 개발자 도구(F12) → Console 탭에서 자세한 오류를 확인하세요.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '0.5rem 1rem',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem('sbim-tc-auth')
                window.location.reload()
              }}
              style={{
                padding: '0.5rem 1rem',
                background: '#64748b',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              저장된 로그인 지우고 새로고침
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
