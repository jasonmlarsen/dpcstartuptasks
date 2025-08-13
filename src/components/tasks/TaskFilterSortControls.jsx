import React from 'react'
import { Filter, SortAsc, Eye, EyeOff, User, Tag, Calendar } from 'lucide-react'

const TaskFilterSortControls = ({ 
  filters, 
  onFiltersChange, 
  teamMembers = [], 
  showTeamFilter = false 
}) => {
  const categories = [
    'All',
    'General',
    'Legal', 
    'Financial',
    'Marketing',
    'Operations',
    'Clinical',
    'Technology',
    'Insurance'
  ]

  const sortOptions = [
    { value: 'created_at', label: 'Date Created' },
    { value: 'due_date', label: 'Due Date' },
    { value: 'category', label: 'Category' }
  ]

  const handleFilterChange = (key, value) => {
    onFiltersChange({
      ...filters,
      [key]: value
    })
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Filter className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-medium text-gray-900">Filter & Sort</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Show Completed Toggle */}
        <div className="flex items-center space-x-3">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
              checked={filters.showCompleted}
              onChange={(e) => handleFilterChange('showCompleted', e.target.checked)}
            />
            <span className="ml-2 text-sm font-medium text-gray-700 flex items-center">
              {filters.showCompleted ? (
                <Eye className="w-4 h-4 mr-1" />
              ) : (
                <EyeOff className="w-4 h-4 mr-1" />
              )}
              Show Completed
            </span>
          </label>
        </div>

        {/* Category Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Tag className="w-4 h-4 inline mr-1" />
            Category
          </label>
          <select
            className="form-input text-sm"
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        {/* Team Member Filter (only on team page) */}
        {showTeamFilter && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <User className="w-4 h-4 inline mr-1" />
              Assigned To
            </label>
            <select
              className="form-input text-sm"
              value={filters.assignedTo || ''}
              onChange={(e) => handleFilterChange('assignedTo', e.target.value)}
            >
              <option value="">All Team Members</option>
              <option value="unassigned">Unassigned</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sort By */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <SortAsc className="w-4 h-4 inline mr-1" />
            Sort By
          </label>
          <div className="flex space-x-2">
            <select
              className="form-input text-sm flex-1"
              value={filters.sortBy}
              onChange={(e) => handleFilterChange('sortBy', e.target.value)}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="form-input text-sm"
              value={filters.sortOrder}
              onChange={(e) => handleFilterChange('sortOrder', e.target.value)}
            >
              <option value="asc">↑ Asc</option>
              <option value="desc">↓ Desc</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TaskFilterSortControls