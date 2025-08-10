import React, { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase, getCurrentUserOrganization } from '../../lib/supabase'
import { Settings as SettingsIcon, Building2, Calendar, MapPin, User, Users, Save, AlertCircle, UserPlus } from 'lucide-react'

const Settings = () => {
  const { user, signOut } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    clinicName: '',
    targetLaunchDate: '',
    city: '',
    state: '',
    inviteEmails: ['', '']
  })

  const [organizationId, setOrganizationId] = useState(null)
  const [teamMembers, setTeamMembers] = useState([])
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    loadUserData()
    loadTeamMembers()
  }, [])

  const loadUserData = async () => {
    try {
      setLoading(true)
      const userData = await getCurrentUserOrganization()
      
      if (userData && userData.organization) {
        setFormData({
          fullName: userData.full_name || '',
          email: userData.email || '',
          clinicName: userData.organization.name || '',
          targetLaunchDate: userData.organization.target_launch_date || '',
          city: userData.organization.city || '',
          state: userData.organization.state || '',
          inviteEmails: ['', '']
        })
        setOrganizationId(userData.organization.id)
      }
    } catch (err) {
      console.error('Error loading user data:', err)
      setError('Failed to load user data')
    } finally {
      setLoading(false)
    }
  }

  const loadTeamMembers = async () => {
    try {
      const userData = await getCurrentUserOrganization()
      if (userData && userData.organization) {
        const { data: members, error } = await supabase
          .from('users')
          .select('id, email, full_name, created_at')
          .eq('organization_id', userData.organization.id)
          .order('created_at', { ascending: true })

        if (error) throw error
        setTeamMembers(members || [])
      }
    } catch (err) {
      console.error('Error loading team members:', err)
    }
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    setError('')
    setSuccess('')
  }

  const handleInviteEmailChange = (index, value) => {
    setFormData(prev => ({
      ...prev,
      inviteEmails: prev.inviteEmails.map((email, i) => i === index ? value : email)
    }))
    setError('')
    setSuccess('')
  }

  const handleSave = async () => {
    if (!organizationId) {
      setError('Organization not found')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      // Update user information
      const { error: userError } = await supabase
        .from('users')
        .update({
          full_name: formData.fullName,
        })
        .eq('id', user.id)

      if (userError) throw userError

      // Update organization information
      const { error: orgError } = await supabase
        .from('organizations')
        .update({
          name: formData.clinicName,
          target_launch_date: formData.targetLaunchDate || null,
          city: formData.city || null,
          state: formData.state || null,
        })
        .eq('id', organizationId)

      if (orgError) throw orgError

      setSuccess('Settings saved successfully!')
    } catch (err) {
      console.error('Error saving settings:', err)
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleSendInvitations = async () => {
    const validEmails = formData.inviteEmails.filter(email => email.trim().length > 0)
    
    if (validEmails.length === 0) {
      setError('Please enter at least one email address to invite')
      return
    }

    // Check if we would exceed the 3-user limit
    if (teamMembers.length + validEmails.length > 3) {
      setError(`Cannot invite ${validEmails.length} members. Maximum 3 users per organization (currently have ${teamMembers.length})`)
      return
    }

    setInviting(true)
    setError('')
    setSuccess('')

    try {
      // TODO: Implement actual invitation system
      // For now, just show a success message
      console.log('Invitations to send:', validEmails)
      
      // Clear the invitation emails
      setFormData(prev => ({
        ...prev,
        inviteEmails: ['', '']
      }))
      
      setSuccess(`Invitations sent to ${validEmails.join(', ')}! (Note: Invitation system not yet implemented)`)
    } catch (err) {
      console.error('Error sending invitations:', err)
      setError(err.message || 'Failed to send invitations')
    } finally {
      setInviting(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <SettingsIcon className="h-8 w-8 text-primary" />
              <h1 className="text-xl font-semibold text-gray-900">
                Settings
              </h1>
            </div>
            <button
              onClick={handleSignOut}
              className="btn btn-secondary"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm p-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">
              Account & Clinic Settings
            </h2>

            <div className="space-y-8">
              {/* Personal Information */}
              <div>
                <div className="flex items-center mb-4">
                  <User className="w-5 h-5 text-primary mr-2" />
                  <h3 className="text-lg font-medium text-gray-900">Personal Information</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="form-group">
                    <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      id="fullName"
                      className="form-input"
                      value={formData.fullName}
                      onChange={(e) => handleInputChange('fullName', e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      id="email"
                      className="form-input bg-gray-50"
                      value={formData.email}
                      disabled
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      Email cannot be changed from this page
                    </p>
                  </div>
                </div>
              </div>

              {/* Clinic Information */}
              <div>
                <div className="flex items-center mb-4">
                  <Building2 className="w-5 h-5 text-primary mr-2" />
                  <h3 className="text-lg font-medium text-gray-900">Clinic Information</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="form-group">
                    <label htmlFor="clinicName" className="block text-sm font-medium text-gray-700 mb-2">
                      Clinic Name
                    </label>
                    <input
                      type="text"
                      id="clinicName"
                      className="form-input"
                      value={formData.clinicName}
                      onChange={(e) => handleInputChange('clinicName', e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="targetLaunchDate" className="block text-sm font-medium text-gray-700 mb-2">
                      Target Launch Date
                    </label>
                    <input
                      type="date"
                      id="targetLaunchDate"
                      className="form-input"
                      value={formData.targetLaunchDate}
                      onChange={(e) => handleInputChange('targetLaunchDate', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Location Information */}
              <div>
                <div className="flex items-center mb-4">
                  <MapPin className="w-5 h-5 text-primary mr-2" />
                  <h3 className="text-lg font-medium text-gray-900">Location</h3>
                </div>
                
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-2">
                      City
                    </label>
                    <input
                      type="text"
                      id="city"
                      className="form-input"
                      value={formData.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-2">
                      State
                    </label>
                    <input
                      type="text"
                      id="state"
                      className="form-input"
                      value={formData.state}
                      onChange={(e) => handleInputChange('state', e.target.value)}
                      maxLength={2}
                      placeholder="TX"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Team Management */}
            <div>
              <div className="flex items-center mb-4">
                <Users className="w-5 h-5 text-primary mr-2" />
                <h3 className="text-lg font-medium text-gray-900">Team Management</h3>
              </div>
              
              {/* Current Team Members */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-700 mb-3">
                  Current Team Members ({teamMembers.length}/3)
                </h4>
                <div className="space-y-2">
                  {teamMembers.map((member) => (
                    <div key={member.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                      <div>
                        <p className="font-medium text-gray-900">{member.full_name}</p>
                        <p className="text-sm text-gray-600">{member.email}</p>
                      </div>
                      {member.id === user.id && (
                        <span className="text-xs bg-primary text-white px-2 py-1 rounded">You</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Invite New Members */}
              {teamMembers.length < 3 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                    Invite Team Members
                  </h4>
                  <div className="space-y-4">
                    {formData.inviteEmails.map((email, index) => (
                      <div key={index} className="form-group">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Team Member {index + 1} Email
                        </label>
                        <input
                          type="email"
                          className="form-input"
                          placeholder="colleague@example.com"
                          value={email}
                          onChange={(e) => handleInviteEmailChange(index, e.target.value)}
                        />
                      </div>
                    ))}
                    <button
                      onClick={handleSendInvitations}
                      disabled={inviting}
                      className="btn btn-outline-primary flex items-center"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      {inviting ? 'Sending Invitations...' : 'Send Invitations'}
                    </button>
                  </div>
                </div>
              )}

              {teamMembers.length >= 3 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-sm text-blue-600">
                    Your team is at the maximum capacity of 3 members.
                  </p>
                </div>
              )}
            </div>
            {/* Messages */}
            {error && (
              <div className="mt-6 p-3 bg-red-50 border border-red-200 rounded-md flex items-center">
                <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {success && (
              <div className="mt-6 p-3 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm text-green-600">{success}</p>
              </div>
            )}

            {/* Save Button */}
            <div className="mt-8 flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary flex items-center"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default Settings