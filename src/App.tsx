import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ProjectProvider } from './contexts/ProjectContext'
import { DesignScheduleProvider } from './contexts/DesignScheduleContext'
import AuthLayout from './components/AuthLayout'
import ProtectedRoute from './components/ProtectedRoute'
import StartOrApp from './components/StartOrApp'
import Home from './pages/Home'
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
import ModelViewerLoader from './components/ModelViewerLoader'
import CadViewer from './pages/CadViewer'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import Profile from './pages/Profile'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* 시작 화면: 로그인/가입 (전체 화면, 사이드바 없음) */}
          <Route path="/login" element={<AuthLayout />}>
            <Route index element={<Login />} />
          </Route>
          <Route path="/signup" element={<AuthLayout />}>
            <Route index element={<SignUp />} />
          </Route>

          {/* 팝업 전용 (레이아웃 없음) */}
          <Route path="/model-viewer" element={<ModelViewerLoader />} />
          <Route path="/cad-viewer" element={<CadViewer />} />

          {/* 앱 메인 (로그인 후에만 사이드바 + 콘텐츠) */}
          <Route path="/" element={<ProjectProvider><DesignScheduleProvider><StartOrApp /></DesignScheduleProvider></ProjectProvider>}>
            <Route index element={<Home />} />
            <Route path="design-doc" element={<DesignDoc />} />
            <Route path="design-review" element={<DesignReview />} />
            <Route path="design-schedule" element={<DesignSchedule />} />
            <Route path="design-model" element={<ModelManagement />} />
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
                  <ParticipantManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="projects"
              element={
                <ProtectedRoute>
                  <ProjectManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute>
                  <UserManagement />
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
    </BrowserRouter>
  )
}

export default App
