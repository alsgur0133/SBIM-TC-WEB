import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { initThemeFromStorage } from './contexts/ThemeContext'
import { installAppBusyFetch } from './lib/appBusy'
import './index.css'

initThemeFromStorage()
installAppBusyFetch()

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML = '<p style="padding:2rem;font-family:system-ui;">오류: #root 요소를 찾을 수 없습니다.</p>'
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
