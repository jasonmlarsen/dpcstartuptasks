import React, { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase, fetchOrganizationUsers } from '../../lib/supabase'
import { X, Save, Plus, Trash2, Calendar, User, FileText, Link, MessageSquare } from 'lucide-react'

const TaskDetailModal = ({ isOpen, onClose, task, onTaskUpdated, teamMembers = [] }) => {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [subtasks, setSubtasks] = useState([])
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')

  const [formData, setFormData] = useState({
    title: '',
    category: 'General',
    dueDate: '',
    assignedTo: '',
    resources: '',
    notes: '',
    isCompleted: false
  })

  useEffect(() => {
    if (isOpen && task) {
      loadTaskDetails()
    }
  }, [isOpen, task])

  const loadTaskDetails = async () => {
    if (!task) return

    setLoading(true)
    setError('')

    try {
      // Set form data from task
      setFormData({
        title: task.title || '',
        category: task.category || 'General',
        dueDate: task.due_date || '',
        assignedTo: task.assigned_to || '',
        resources: task.resources || '',
        notes: task.notes || '',
        isCompleted: task.is_completed || false
      })

      // Load subtasks
      const { data: subtasksData, error: subtasksError } = await supabase
        .from('subtasks')
        .select('*')
        .eq('task_id', task.id)
        .order('created_at', { ascending: true })

      if (subtasksError) throw subtasksError
      setSubtasks(subtasksData || [])

      // Load comments
      const { data: commentsData, error: commentsError } = await supabase
        .from('comments')
        .select(`
          *,
          user:users(id, full_name, email)
        `)
        .eq('task_id', task.id)
        .order('created_at', { ascending: true })

      if (commentsError) throw commentsError
      setComments(commentsData || [])

    } catch (err) {
      console.error('Error loading task details:', err)
      setError('Failed to load task details')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    setError('')
  }

  const handleSubtaskToggle = async (subtaskId, currentStatus) => {
    try {
      const { error } = await supabase
        .from('subtasks')
        .update({ is_completed: !currentStatus })
        .eq('id', subtaskId)

      if (error) throw error

      // Update local state
      setSubtasks(prev => prev.map(subtask => 
        subtask.id === subtaskId 
          ? { ...subtask, is_completed: !currentStatus }
          : subtask
      ))
    } catch (err) {
      console.error('Error updating subtask:', err)
      setError('Failed to update subtask')
    }
  }

  const handleAddComment = async () => {
    if (!newComment.trim()) return

    try {
      const { data: commentData, error } = await supabase
        .from('comments')
        .insert({
          task_id: task.id,
          user_id: user.id,
          content: newComment.trim()
        })
        .select(`
          *,
          user:users(id, full_name, email)
        `)
        .single()

      if (error) throw error

      setComments(prev => [...prev, commentData])
      setNewComment('')
    } catch (err) {
      console.error('Error adding comment:', err)
      setError('Failed to add comment')
    }
  }

  const handleSave = async () => {
    if (!formData.title.trim()) {
      setError('Task title is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          title: formData.title.trim(),
          category: formData.category,
          due_date: formData.dueDate || null,
          assigned_to: formData.assignedTo || null,
          resources: formData.resources.trim() || null,
          notes: formData.notes.trim() || null,
          is_completed: formData.isCompleted
        })
        .eq('id', task.id)

      if (error) throw error

      // Notify parent component
      if (onTaskUpdated) {
        onTaskUpdated()
      }

      onClose()
    } catch (err) {
      console.error('Error updating task:', err)
      setError(err.message || 'Failed to update task')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setError('')
    setNewComment('')
    onClose()
  }

  if (!isOpen || !task) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Task Details</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
            disabled={loading || saving}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading task details...</p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Task Completion Status */}
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="isCompleted"
                className="w-5 h-5 text-primary border-gray-300 rounded focus:ring-primary"
                checked={formData.isCompleted}
                onChange={(e) => handleInputChange('isCompleted', e.target.checked)}
                disabled={saving}
              />
              <label htmlFor="isCompleted" className="text-sm font-medium text-gray-700">
                Mark as completed
              </label>
            </div>

            {/* Task Title */}
            <div className="form-group">
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Task Title *
              </label>
              <input
                type="text"
                id="title"
                className="form-input"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                required
                disabled={saving}
              />
            </div>

            {/* Category and Assignment */}
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
                  disabled={saving}
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
                  disabled={saving}
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Due Date */}
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
                disabled={saving}
                min={new Date().toISOString().split('T')[0]}
              />
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
                disabled={saving}
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
                disabled={saving}
              />
            </div>

            {/* Subtasks */}
            {subtasks.length > 0 && (
              <div className="form-group">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Subtasks ({subtasks.filter(s => s.is_completed).length}/{subtasks.length} completed)
                </label>
                <div className="space-y-2">
                  {subtasks.map((subtask) => (
                    <div key={subtask.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-md">
                      <button
                        onClick={() => handleSubtaskToggle(subtask.id, subtask.is_completed)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors duration-150 ${
                          subtask.is_completed
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-gray-300 hover:border-primary'
                        }`}
                        disabled={saving}
                      >
                        {subtask.is_completed && <span className="text-xs">✓</span>}
                      </button>
                      <span className={`text-sm ${
                        subtask.is_completed 
                          ? 'text-gray-500 line-through' 
                          : 'text-gray-900'
                      }`}>
                        {subtask.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                <MessageSquare className="w-4 h-4 inline mr-1" />
                Comments ({comments.length})
              </label>
              
              {/* Add Comment */}
              <div className="mb-4">
                <div className="flex space-x-3">
                  <textarea
                    className="form-input flex-1"
                    rows="2"
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    disabled={saving}
                  />
                  <button
                    onClick={handleAddComment}
                    className="btn btn-primary px-4"
                    disabled={!newComment.trim() || saving}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Comments List */}
              {comments.length > 0 && (
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {comments.map((comment) => (
                    <div key={comment.id} className="p-3 bg-gray-50 rounded-md">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-900">
                          {comment.user?.full_name || 'Unknown User'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(comment.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{comment.content}</p>
                    </div>
                  ))}
                </div>
              )}
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
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="btn btn-primary flex items-center"
                disabled={saving}
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TaskDetailModal