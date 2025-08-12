import React, { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase, getCurrentUserOrganization } from '../../lib/supabase'
import { X, Plus, Trash2, Calendar, User, FileText, Link, Save } from 'lucide-react'

const AddTaskModal = ({ isOpen, onClose, onTaskAdded, teamMembers = [] }) => {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    title: '',
    category: 'General',
    dueDate: '',
    assignedTo: user?.id || '',
    resources: '',
    notes: '',
    subtasks: ['']
  })

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    setError('')
  }

  const handleSubtaskChange = (index, value) => {
    setFormData(prev => ({
      ...prev,
      subtasks: prev.subtasks.map((subtask, i) => i === index ? value : subtask)
    }))
  }

  const addSubtask = () => {
    setFormData(prev => ({
      ...prev,
      subtasks: [...prev.subtasks, '']
    }))
  }

  const removeSubtask = (index) => {
    if (formData.subtasks.length > 1) {
      setFormData(prev => ({
        ...prev,
        subtasks: prev.subtasks.filter((_, i) => i !== index)
      }))
    }
  }

  const resetForm = () => {
    setFormData({
      title: '',
      category: 'General',
      dueDate: '',
      assignedTo: user?.id || '',
      resources: '',
      notes: '',
      subtasks: ['']
    })
    setError('')
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.title.trim()) {
      setError('Task title is required')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Get current user's organization
      const userData = await getCurrentUserOrganization()
      if (!userData || !userData.organization) {
        throw new Error('Organization not found')
      }

      // Create the main task
      const taskData = {
        organization_id: userData.organization.id,
        title: formData.title.trim(),
        category: formData.category,
        priority: 0,
        is_completed: false,
        is_preloaded: false,
        created_by: user.id,
        assigned_to: formData.assignedTo,
        due_date: formData.dueDate || null,
        resources: formData.resources.trim() || null,
        notes: formData.notes.trim() || null
      }

      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert(taskData)
        .select()
        .single()

      if (taskError) throw taskError

      // Create subtasks if any
      const validSubtasks = formData.subtasks.filter(subtask => subtask.trim().length > 0)
      if (validSubtasks.length > 0) {
        const subtaskData = validSubtasks.map(subtask => ({
          task_id: task.id,
          title: subtask.trim(),
          is_completed: false
        }))

        const { error: subtaskError } = await supabase
          .from('subtasks')
          .insert(subtaskData)

        if (subtaskError) throw subtaskError
      }

      // Success - close modal and notify parent
      handleClose()
      if (onTaskAdded) {
        onTaskAdded(task)
      }
    } catch (err) {
      console.error('Error creating task:', err)
      setError(err.message || 'Failed to create task')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Add New Task</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
            disabled={loading}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Task Title */}
          <div className="form-group">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
              Task Title *
            </label>
            <input
              type="text"
              id="title"
              className="form-input"
              placeholder="Enter task title..."
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              required
              disabled={loading}
            />
          </div>

          {/* Due Date and Assigned To */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
              <select
                id="category"
                className="form-input"
                value={formData.category}
                onChange={(e) => handleInputChange('category', e.target.value)}
                disabled={loading}
              >
                <option value="General">General</option>
                <option value="Legal">Legal</option>
                <option value="Financial">Financial</option>
                <option value="Marketing">Marketing</option>
                <option value="Operations">Operations</option>
                <option value="Clinical">Clinical</option>
                <option value="Technology">Technology</option>
                <option value="Insurance">Insurance</option>
              </select>
            </div>
          </div>

          {/* Due Date and Assigned To */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4 inline mr-1" />
                Due Date
              </label>
              <input
                type="date"
                id="dueDate"
                className="form-input"
                value={formData.dueDate}
                onChange={(e) => handleInputChange('dueDate', e.target.value)}
                disabled={loading}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div className="form-group">
              <label htmlFor="assignedTo" className="block text-sm font-medium text-gray-700 mb-2">
                <User className="w-4 h-4 inline mr-1" />
                Assign To
              </label>
              <select
                id="assignedTo"
                className="form-input"
                value={formData.assignedTo}
                onChange={(e) => handleInputChange('assignedTo', e.target.value)}
                disabled={loading}
              >
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Resources */}
          <div className="form-group">
            <label htmlFor="resources" className="block text-sm font-medium text-gray-700 mb-2">
              <Link className="w-4 h-4 inline mr-1" />
              Resources
            </label>
            <textarea
              id="resources"
              className="form-input"
              rows="3"
              placeholder="Add links, documents, or resource information..."
              value={formData.resources}
              onChange={(e) => handleInputChange('resources', e.target.value)}
              disabled={loading}
            />
          </div>

          {/* Notes */}
          <div className="form-group">
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
              <FileText className="w-4 h-4 inline mr-1" />
              Notes
            </label>
            <textarea
              id="notes"
              className="form-input"
              rows="3"
              placeholder="Add any additional notes or context..."
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              disabled={loading}
            />
          </div>

          {/* Subtasks */}
          <div className="form-group">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Subtasks
              </label>
              <button
                type="button"
                onClick={addSubtask}
                className="btn btn-outline-primary text-sm py-1 px-3 flex items-center"
                disabled={loading}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Subtask
              </button>
            </div>
            
            <div className="space-y-2">
              {formData.subtasks.map((subtask, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    type="text"
                    className="form-input flex-1"
                    placeholder={`Subtask ${index + 1}...`}
                    value={subtask}
                    onChange={(e) => handleSubtaskChange(index, e.target.value)}
                    disabled={loading}
                  />
                  {formData.subtasks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSubtask(index)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200"
                      disabled={loading}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary flex items-center"
              disabled={loading}
            >
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddTaskModal