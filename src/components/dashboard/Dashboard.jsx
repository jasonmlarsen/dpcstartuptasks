import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Building2, LogOut, Settings as SettingsIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import Settings from '../settings/Settings'

const Dashboard = () => {
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <Routes>
      <Route path="/settings" element={<Settings />} />
      <Route path="/*" element={
        <div className="min-h-screen bg-gray-50">
          {/* Header */}
          <header className="bg-white shadow-sm border-b border-gray-200">
            <div className="container mx-auto px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Building2 className="h-8 w-8 text-primary" />
                  <h1 className="text-xl font-semibold text-gray-900">
                    DPC Startup Task Manager
                  </h1>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-600">
                    Welcome, {user?.user_metadata?.full_name || user?.email}
                  </span>
                  <Link
                    to="/settings"
                    className="btn btn-secondary flex items-center"
                  >
                    <SettingsIcon className="w-4 h-4 mr-2" />
                    Settings
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="btn btn-secondary flex items-center"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="container mx-auto px-6 py-8">
            <div className="bg-white rounded-lg shadow-sm p-8 text-center">
              <Building2 className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                Welcome to Your Task Manager!
              </h2>
              <p className="text-gray-600 mb-6">
                Your clinic setup is complete. We'll be adding your task management features next.
              </p>
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-2">Coming Soon:</h3>
                <ul className="text-left text-gray-600 space-y-2">
                  <li>• Preloaded startup tasks for DPC clinics</li>
                  <li>• Task assignment and collaboration</li>
                  <li>• Progress tracking and due dates</li>
                  <li>• Comments and team communication</li>
                </ul>
              </div>
            </div>
          </main>
        </div>
      } />
    </Routes>
  )
}

export default Dashboard