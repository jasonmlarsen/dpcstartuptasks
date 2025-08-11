import React from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Navigation from '../navigation/Navigation'
import Breadcrumbs from '../navigation/Breadcrumbs'
import Settings from '../settings/Settings'
import AddTaskModal from '../tasks/AddTaskModal'
import { getCurrentUserOrganization, fetchOrganizationUsers } from '../../lib/supabase'
import { CheckSquare, Users, UserPlus } from 'lucide-react'

const Dashboard = () => {
  const navigate = useNavigate()
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false)
  const [teamMembers, setTeamMembers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadTeamMembers()
  }, [])

  const loadTeamMembers = async () => {
    try {
      const userData = await getCurrentUserOrganization()
      if (userData && userData.organization) {
        const members = await fetchOrganizationUsers(userData.organization.id)
        setTeamMembers(members)
      }
    } catch (err) {
      console.error('Error loading team members:', err)
    } finally {
      setLoading(false)
    }
  }

  const openAddTaskModal = () => {
    setIsAddTaskModalOpen(true)
  }

  const closeAddTaskModal = () => {
    setIsAddTaskModalOpen(false)
  }

  const handleTaskAdded = (newTask) => {
    // Task was successfully created
    console.log('New task created:', newTask)
    // You can add additional logic here like refreshing task lists
  }

  const handleInviteTeamMembers = () => {
    navigate('/settings')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation onAddTask={openAddTaskModal} />
      <Breadcrumbs />
      
      {/* Add Task Modal */}
      <AddTaskModal
        isOpen={isAddTaskModalOpen}
        onClose={closeAddTaskModal}
        onTaskAdded={handleTaskAdded}
        teamMembers={teamMembers}
      />

      {/* Main Content */}
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/my-tasks" element={
          <main className="container mx-auto px-6 py-8">
            <div className="bg-white rounded-lg shadow-sm p-8 text-center">
              <CheckSquare className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                My Tasks Coming Soon
              </h2>
              <p className="text-gray-600">
                View and manage tasks assigned specifically to you.
              </p>
            </div>
          </main>
        } />
        <Route path="/team" element={
          <main className="container mx-auto px-6 py-8">
            <div className="bg-white rounded-lg shadow-sm p-8">
              <div className="text-center mb-8">
                <Users className="icon-lg mx-auto mb-4" />
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  Team Management
                </h2>
                <p className="text-gray-600 mb-6">
                  Collaborate with your team members to launch your clinic successfully.
                </p>
              </div>
              
              <div className="max-w-md mx-auto">
                <div className="bg-gray-50 rounded-lg p-6 mb-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Invite Team Members
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Add up to 3 team members to collaborate on your clinic startup tasks.
                  </p>
                  <button
                    onClick={handleInviteTeamMembers}
                    className="btn btn-primary flex items-center w-full justify-center"
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Manage Team & Send Invitations
                  </button>
                </div>
                
                <div className="text-center">
                  <p className="text-sm text-gray-500">
                    Team collaboration features will be available soon.
                  </p>
                </div>
              </div>
            </div>
          </main>
        } />
        <Route path="/*" element={
          <main className="container mx-auto px-6 py-8">
            <div className="bg-white rounded-lg shadow-sm p-8 text-center">
              <CheckSquare className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                All Tasks Coming Soon
              </h2>
              <p className="text-gray-600 mb-6">
                View and manage all tasks for your clinic.
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