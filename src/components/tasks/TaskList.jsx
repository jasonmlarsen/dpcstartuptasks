import React from 'react'
import { Calendar, User, FileText, Link, CheckSquare, Clock, Users } from 'lucide-react'

const TaskList = ({ tasks = [], title, emptyMessage, loading = false }) => {
  const formatDate = (dateString) => {
    if (!dateString) return null
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const isOverdue = (dueDateString) => {
    if (!dueDateString) return false
    const dueDate = new Date(dueDateString)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return dueDate < today
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
        <div className="space-y-6">
          {tasks.map((task) => (
            <div key={task.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              {/* Task Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {task.title}
                  </h3>
                  
                  {/* Task Meta Information */}
                  <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                    {/* Assigned To */}
                    {task.assigned_user && (
                      <div className="flex items-center">
                        <User className="w-4 h-4 mr-1" />
                        <span>{task.assigned_user.full_name}</span>
                      </div>
                    )}
                    
                    {/* Due Date */}
                    {task.due_date && (
                      <div className={`flex items-center ${
                        isOverdue(task.due_date) ? 'text-red-600' : ''
                      }`}>
                        <Calendar className="w-4 h-4 mr-1" />
                        <span>
                          Due {formatDate(task.due_date)}
                          {isOverdue(task.due_date) && ' (Overdue)'}
                        </span>
                      </div>
                    )}
                    
                    {/* Category */}
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-md text-xs font-medium">
                        {task.category}
                      </span>
                    </div>
                    
                    {/* Created Date */}
                    <div className="flex items-center text-gray-500">
                      <Clock className="w-4 h-4 mr-1" />
                      <span>Created {formatDate(task.created_at)}</span>
                    </div>
                  </div>
                </div>
                
                {/* Task Status */}
                <div className="ml-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    task.is_completed 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {task.is_completed ? 'Completed' : 'In Progress'}
                  </span>
                </div>
              </div>

              {/* Resources */}
              {task.resources && (
                <div className="mb-4">
                  <div className="flex items-center mb-2">
                    <Link className="w-4 h-4 mr-2 text-primary" />
                    <h4 className="text-sm font-medium text-gray-900">Resources</h4>
                  </div>
                  <div className="bg-gray-50 rounded-md p-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{task.resources}</p>
                  </div>
                </div>
              )}

              {/* Notes */}
              {task.notes && (
                <div className="mb-4">
                  <div className="flex items-center mb-2">
                    <FileText className="w-4 h-4 mr-2 text-primary" />
                    <h4 className="text-sm font-medium text-gray-900">Notes</h4>
                  </div>
                  <div className="bg-gray-50 rounded-md p-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{task.notes}</p>
                  </div>
                </div>
              )}

              {/* Subtasks */}
              {task.subtasks && task.subtasks.length > 0 && (
                <div>
                  <div className="flex items-center mb-3">
                    <CheckSquare className="w-4 h-4 mr-2 text-primary" />
                    <h4 className="text-sm font-medium text-gray-900">
                      Subtasks ({task.subtasks.filter(st => st.is_completed).length}/{task.subtasks.length} completed)
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {task.subtasks.map((subtask) => (
                      <div key={subtask.id} className="flex items-center">
                        <div className={`w-4 h-4 rounded border-2 mr-3 flex items-center justify-center ${
                          subtask.is_completed 
                            ? 'bg-green-500 border-green-500' 
                            : 'border-gray-300'
                        }`}>
                          {subtask.is_completed && (
                            <CheckSquare className="w-3 h-3 text-white" />
                          )}
                        </div>
                        <span className={`text-sm ${
                          subtask.is_completed 
                            ? 'text-gray-500 line-through' 
                            : 'text-gray-700'
                        }`}>
                          {subtask.title}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

export default TaskList