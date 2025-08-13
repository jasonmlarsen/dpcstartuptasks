import React from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider'
import Navigation from '../navigation/Navigation'
import Breadcrumbs from '../navigation/Breadcrumbs'
import Settings from '../settings/Settings'
import AddTaskModal from '../tasks/AddTaskModal'
import TaskList from '../tasks/TaskList'
import TaskFilterSortControls from '../tasks/TaskFilterSortControls'
import { getCurrentUserOrganization, fetchOrganizationUsers, fetchTasks } from '../../lib/supabase'
import { CheckSquare, Users, UserPlus } from 'lucide-react'

const Dashboard = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false)
  const [teamMembers, setTeamMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [pageTitle, setPageTitle] = useState('')
  const [emptyMessage, setEmptyMessage] = useState('')
  
  // Filter and sort state
  const [filters, setFilters] = useState({
    showCompleted: false,
    category: 'All',
    sortBy: 'created_at',
    sortOrder: 'desc',
    assignedTo: ''
  })

  useEffect(() => {
    loadTeamMembers()
  }, [])

  useEffect(() => {
    if (user) {
      loadTasks()
    }
  }, [location.pathname, user, filters])

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

  const loadTasks = async () => {
    try {
      setTasksLoading(true)
      const userData = await getCurrentUserOrganization()
      if (!userData || !userData.organization) {
        setTasks([])
        return
      }

      const organizationId = userData.organization.id
      let taskFilters = { 
        organizationId,
        showCompleted: filters.showCompleted,
        category: filters.category,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder
      }
      let title = ''
      let emptyMsg = ''

      // Determine filters based on current route
      switch (location.pathname) {
        case '/my-tasks':
          taskFilters.assignedToUserId = user.id
          title = 'My Tasks'
          emptyMsg = 'No tasks assigned to you yet. Create a new task or ask a team member to assign one to you.'
          break
        case '/team':
          // Handle team page filtering
          if (filters.assignedTo === 'unassigned') {
            taskFilters.assignedToUserId = null
          } else if (filters.assignedTo) {
            taskFilters.assignedToUserId = filters.assignedTo
          } else {
            taskFilters.excludeAssignedToUserId = user.id
          }
          title = 'Team Tasks'
          emptyMsg = 'No tasks assigned to other team members yet. Create tasks and assign them to your team.'
          break
        default:
          title = 'All Tasks'
          emptyMsg = 'No tasks created yet. Click "Add Task" to create your first task.'
          break
      }

      const fetchedTasks = await fetchTasks(taskFilters)
      setTasks(fetchedTasks)
      setPageTitle(title)
      setEmptyMessage(emptyMsg)
    } catch (err) {
      console.error('Error loading tasks:', err)
      setTasks([])
    } finally {
      setTasksLoading(false)
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
    // Refresh the task list
    loadTasks()
  }

  const handleInviteTeamMembers = () => {
    navigate('/settings')
  }

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters)
  }

  // Helper function to determine if we should show filter controls
  const shouldShowFilters = () => {
    return ['/', '/my-tasks', '/team'].includes(location.pathname)
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
        <Route 
          path="/my-tasks" 
          element={
            <div>
              <div className="container mx-auto px-6 pt-8">
                <TaskFilterSortControls
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  teamMembers={teamMembers}
                  showTeamFilter={false}
                />
              </div>
              <TaskList 
                tasks={tasks} 
                title={pageTitle} 
                emptyMessage={emptyMessage}
                loading={tasksLoading}
                onTaskUpdate={loadTasks}
                teamMembers={teamMembers}
              />
            </div>
          } 
        />
        <Route path="/team" element={
          <main className="container mx-auto px-6 py-8">
            <TaskFilterSortControls
              filters={filters}
              onFiltersChange={handleFiltersChange}
              teamMembers={teamMembers}
              showTeamFilter={true}
            />
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
                
              </div>
            </div>
            <TaskList 
              tasks={tasks} 
              title="Team Tasks" 
              emptyMessage={emptyMessage}
              loading={tasksLoading}
              onTaskUpdate={loadTasks}
              teamMembers={teamMembers}
            />
          </main>
        } />
        <Route 
          path="/*" 
          element={
            <div>
              <div className="container mx-auto px-6 pt-8">
                <TaskFilterSortControls
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  teamMembers={teamMembers}
                  showTeamFilter={false}
                />
              </div>
              <TaskList 
                tasks={tasks} 
                title={pageTitle} 
                emptyMessage={emptyMessage}
                loading={tasksLoading}
                onTaskUpdate={loadTasks}
                teamMembers={teamMembers}
              />
            </div>
          } 
        />
      </Routes>
    </div>
  )
}

export default Dashboard