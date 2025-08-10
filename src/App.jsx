import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './components/auth/AuthProvider'
import AuthGuard from './components/auth/AuthGuard'
import Dashboard from './components/dashboard/Dashboard'
import './index.css'
import '../styles/design-tokens.css'
import '../styles/base-ui.css'

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route 
              path="/*" 
              element={
                <AuthGuard>
                  <Dashboard />
                </AuthGuard>
              } 
            />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  )
}

export default App