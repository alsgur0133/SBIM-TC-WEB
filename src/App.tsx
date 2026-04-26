import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ProjectProvider } from './contexts/ProjectContext'
import { DesignScheduleProvider } from './contexts/DesignScheduleContext'
import AuthLayout from './components/AuthLayout'
import ProtectedRoute from './components/ProtectedRoute'
import RequireAccess from './components/RequireAccess'
import StartOrApp from './components/StartOrApp'
import Dashboard from './pages/Dashboard'
import DesignDoc from './pages/DesignDoc'
import DesignReview from './pages/DesignReview'
import Quantity from './pages/Quantity'
import QuantityFileRegistration from './pages/QuantityFileRegistration'
import QuantitySummary from './pages/QuantitySummary'
import QuantityCompare from './pages/QuantityCompare'
import UserManagement from './pages/UserManagement'
import ProjectManagement from './pages/ProjectManagement'
import ParticipantManagement from './pages/ParticipantManagement'
import DesignSchedule from './pages/DesignSchedule'
import ModelManagement from './pages/ModelManagement'
import SettingsShell from './pages/settings/SettingsShell'
import CodeMappingMemberPage from './pages/settings/CodeMappingMemberPage'
import CodeMappingDongPage from './pages/settings/CodeMappingDongPage'
import CodeMappingFloorPage from './pages/settings/CodeMappingFloorPage'
import CodeMappingMaterialPage from './pages/settings/CodeMappingMaterialPage'
import RebarDatabasePage from './pages/settings/RebarDatabasePage'
import CodeManagementWorkspace from './pages/CodeManagementWorkspace'
import ModelInfo from './pages/ModelInfo'
import CadViewer from './pages/CadViewer'
import TrimbleConnectViewerPopup from './pages/TrimbleConnectViewerPopup'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import TrimbleAuthCallback from './pages/TrimbleAuthCallback'
import TrimbleSignup from './pages/TrimbleSignup'
import Profile from './pages/Profile'
import './App.css'
import { ThemeProvider } from './contexts/ThemeContext'
import AppBusyOverlay from './components/AppBusyOverlay'

function App() {
  return (
    <BrowserRouter basename={((typeof window !== 'undefined' && window.__BASE_PATH__) || import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'}>
      <ThemeProvider>
      <AppBusyOverlay />
      <AuthProvider>
        <Routes>
          {/* 시작 화면: 로그인/가입 (전체 화면, 사이드바 없음) */}
          <Route path="/login" element={<AuthLayout />}>
            <Route index element={<Login />} />
          </Route>
          <Route path="/signup" element={<AuthLayout />}>
            <Route index element={<SignUp />} />
          </Route>
          <Route path="/auth/trimble/callback" element={<AuthLayout />}>
            <Route index element={<TrimbleAuthCallback />} />
          </Route>
          <Route path="/trimble-signup" element={<TrimbleSignup />} />

          {/* 팝업 전용: Trimble Connect 3D 뷰어만 (임베드 API) */}
          <Route path="/model-viewer" element={<ProjectProvider><DesignScheduleProvider><TrimbleConnectViewerPopup mode="standalone" /></DesignScheduleProvider></ProjectProvider>} />
          <Route path="/cad-viewer" element={<CadViewer />} />

          {/* 앱 메인 (로그인 후에만 사이드바 + 콘텐츠) */}
          <Route path="/" element={<ProjectProvider><DesignScheduleProvider><StartOrApp /></DesignScheduleProvider></ProjectProvider>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="design-doc" element={<DesignDoc />} />
            <Route path="design-review" element={<DesignReview />} />
            <Route path="design-schedule" element={<DesignSchedule />} />
            <Route path="design-model/info" element={<ModelInfo />} />
            <Route path="design-model" element={<ModelManagement />} />
            <Route path="trimble-viewer" element={<TrimbleConnectViewerPopup mode="main" />} />
            <Route path="code-mgmt/orgs" element={<Navigate to="/code-mgmt" replace />} />
            <Route path="code-mgmt/codes" element={<Navigate to="/code-mgmt" replace />} />
            <Route path="code-mgmt/classification" element={<Navigate to="/code-mgmt" replace />} />
            <Route path="code-mgmt/obs" element={<Navigate to="/code-mgmt?system=OBS" replace />} />
            <Route path="code-mgmt/mbs" element={<Navigate to="/code-mgmt?system=MBS" replace />} />
            <Route path="code-mgmt/wbs" element={<Navigate to="/code-mgmt?system=WBS" replace />} />
            <Route path="code-mgmt/cbs" element={<Navigate to="/code-mgmt?system=CBS" replace />} />
            <Route path="code-mgmt/ubs" element={<Navigate to="/code-mgmt?system=UBS" replace />} />
            <Route
              path="code-mgmt"
              element={
                <ProtectedRoute>
                  <CodeManagementWorkspace />
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute>
                  <SettingsShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="code-mapping/member" replace />} />
              <Route path="code-mapping/member" element={<CodeMappingMemberPage />} />
              <Route path="code-mapping/dong" element={<CodeMappingDongPage />} />
              <Route path="code-mapping/floor" element={<CodeMappingFloorPage />} />
              <Route path="code-mapping/material" element={<CodeMappingMaterialPage />} />
              <Route path="rebar-db/schedule/wall" element={<RebarDatabasePage section="schedule_wall" title="벽체 일람표" />} />
              <Route path="rebar-db/schedule/lintel" element={<RebarDatabasePage section="schedule_lintel" title="인방보 일람표" />} />
              <Route path="rebar-db/schedule/column" element={<RebarDatabasePage section="schedule_column" title="기둥 일람표" />} />
              <Route path="rebar-db/length/stock" element={<RebarDatabasePage section="length_stock" title="장대 길이" />} />
              <Route path="rebar-db/length/lap" element={<RebarDatabasePage section="length_lap" title="이음·정착 길이" />} />
              <Route path="rebar-db/common/wall" element={<RebarDatabasePage section="common_wall" title="벽체 공통속성" />} />
              <Route path="rebar-db/common/lintel" element={<RebarDatabasePage section="common_lintel" title="인방보 공통속성" />} />
              <Route path="rebar-db/common/column" element={<RebarDatabasePage section="common_column" title="기둥 공통속성" />} />
            </Route>
            <Route path="quantity" element={<Quantity />} />
            <Route path="quantity/file-registration" element={<QuantityFileRegistration />} />
            <Route path="quantity/summary" element={<QuantitySummary />} />
            <Route path="quantity/summary/floor" element={<QuantitySummary />} />
            <Route path="quantity/summary/floor-item" element={<QuantitySummary />} />
            <Route path="quantity/summary/total" element={<QuantitySummary />} />
            <Route path="quantity/compare" element={<QuantityCompare />} />
            <Route
              path="projects/participants"
              element={
                <ProtectedRoute>
                  <RequireAccess access="projectManagement">
                    <ParticipantManagement />
                  </RequireAccess>
                </ProtectedRoute>
              }
            />
            <Route
              path="projects"
              element={
                <ProtectedRoute>
                  <RequireAccess access="projectManagement">
                    <ProjectManagement />
                  </RequireAccess>
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute>
                  <RequireAccess access="userManagement">
                    <UserManagement />
                  </RequireAccess>
                </ProtectedRoute>
              }
            />
            <Route
              path="profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
