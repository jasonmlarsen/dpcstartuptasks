import React from 'react'
import { Routes, Route } from 'react-router-dom'
import Navigation from '../navigation/Navigation'
import Breadcrumbs from '../navigation/Breadcrumbs'
import Settings from '../settings/Settings'
import { Building2 } from 'lucide-react'

const Dashboard = () => {

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <Breadcrumbs />

      {/* Main Content */}
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/tasks" element={
          <main className="container mx-auto px-6 py-8">
            <div className="bg-white rounded-lg shadow-sm p-8 text-center">
              <Building2 className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                Task Management Coming Soon
              </h2>
              <p className="text-gray-600">
                We're working on bringing you comprehensive task management features.
              </p>
            </div>
          </main>
        } />
        <Route path="/team" element={
          <main className="container mx-auto px-6 py-8">
            <div className="bg-white rounded-lg shadow-sm p-8 text-center">
              <Building2 className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                Team Management Coming Soon
              </h2>
              <p className="text-gray-600">
                Team collaboration features will be available soon.
              </p>
            </div>
          </main>
        } />
        <Route path="/*" element={
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
        } />
      </Routes>
    </div>
  )
}

export default Dashboard