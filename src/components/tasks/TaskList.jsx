import React from 'react'
import { CheckSquare, User, Tag, List } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import TaskDetailModal from './TaskDetailModal'

const TaskList = ({ tasks = [], title, emptyMessage, loading = false, onTaskUpdate, teamMembers = [] }) => {
  const [selectedTask, setSelectedTask] = React.useState(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = React.useState(false)

  const handleTaskToggle = async (taskId, currentStatus) => {
    // Prevent event bubbling when clicking checkbox
    event.stopPropagation()
    
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ is_completed: !currentStatus })
        .eq('id', taskId)

      if (error) throw error

      // Notify parent component to refresh tasks
      if (onTaskUpdate) {
        onTaskUpdate()
      }
    } catch (err) {
      console.error('Error updating task:', err)
    }
  }

  const handleTaskClick = (task) => {
    setSelectedTask(task)
    setIsDetailModalOpen(true)
  }

  const handleCloseDetailModal = () => {
    setIsDetailModalOpen(false)
    setSelectedTask(null)
  }

  const handleTaskUpdated = () => {
    // Refresh the task list
    if (onTaskUpdate) {
      onTaskUpdate()
    }
  }

  if (loading) {
    return (
      <main className="container mx-auto px-6 py-8">
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading tasks...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="container mx-auto px-6 py-8">
      {/* Task Detail Modal */}
      <TaskDetailModal
        isOpen={isDetailModalOpen}
        onClose={handleCloseDetailModal}
        task={selectedTask}
        onTaskUpdated={handleTaskUpdated}
        teamMembers={teamMembers}
      />

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600">
          {tasks.length === 0 ? emptyMessage : `${tasks.length} task${tasks.length !== 1 ? 's' : ''} found`}
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <CheckSquare className="icon-lg mx-auto mb-4 text-gray-400" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Tasks Found</h2>
          <p className="text-gray-600">{emptyMessage}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {/* Table Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="grid grid-cols-12 gap-4 items-center text-sm font-medium text-gray-700">
              <div className="col-span-1"></div>
              <div className="col-span-4">Task</div>
              <div className="col-span-2">Assigned To</div>
              <div className="col-span-2">Due Date</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-1">Subtasks</div>
            </div>
          </div>
          
          {/* Task List */}
          {tasks.map((task) => (
            <div 
              key={task.id} 
              className={`px-6 py-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors duration-150 cursor-pointer ${
                task.is_completed ? 'opacity-60' : ''
              }`}
              onClick={() => handleTaskClick(task)}
            >
              <div className="grid grid-cols-12 gap-4 items-center">
                {/* Checkbox */}
                <div className="col-span-1">
                  {task.subtasks && task.subtasks.length > 0 ? (
                    <div className="w-5 h-5 bg-gray-100 border border-gray-300 rounded flex items-center justify-center">
                      <span className="text-xs text-gray-500">—</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleTaskToggle(task.id, task.is_completed)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors duration-150 ${
                        task.is_completed
                          ? 'bg-green-500 border-green-500 text-white'
                          : 'border-gray-300 hover:border-primary'
                      }`}
                    >
                      {task.is_completed && <CheckSquare className="w-3 h-3" />}
                    </button>
                  )}
                </div>

                {/* Task Title */}
                <div className="col-span-4">
                  <h3 className={`text-sm font-medium ${
                    task.is_completed 
                      ? 'text-gray-500 line-through' 
                      : 'text-gray-900'
                  }`}>
                    {task.title}
                  </h3>
                </div>

                {/* Assigned User */}
                <div className="col-span-2">
                  <span className="text-sm text-gray-600">
                    {task.assigned_user ? task.assigned_user.full_name : 'Unassigned'}
                  </span>
                </div>

                {/* Due Date */}
                <div className="col-span-2">
                  <span className="text-sm text-gray-600">
                    {task.due_date 
                      ? new Date(task.due_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })
                      : '—'
                    }
                  </span>
                </div>

                {/* Category */}
                <div className="col-span-2">
                  <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-md font-medium">
                    {task.category}
                  </span>
                </div>

                {/* Subtasks Indicator */}
                <div className="col-span-1 text-center">
                  {task.subtasks && task.subtasks.length > 0 && (
                    <div className="flex items-center justify-center">
                      <List className="w-4 h-4 text-gray-400" />
                      <span className="ml-1 text-xs text-gray-500">
                        {task.subtasks.length}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

export default TaskList