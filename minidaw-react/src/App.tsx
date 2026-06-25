import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import MiniDAWIntegrated from './components/MiniDAWIntegrated'
import { Toaster } from './components/ui/toaster'
import './index.css'

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-background">
        <Routes>
          <Route path="/" element={<MiniDAWIntegrated />} />
          <Route path="/minidaw" element={<MiniDAWIntegrated />} />
          <Route path="/minidaw-react" element={<MiniDAWIntegrated />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
      </div>
    </Router>
  )
}

export default App
