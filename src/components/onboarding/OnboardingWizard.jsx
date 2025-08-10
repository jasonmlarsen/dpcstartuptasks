import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Building2, Calendar, MapPin, Users, ArrowRight, ArrowLeft } from 'lucide-react'

const OnboardingWizard = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    clinicName: '',
    targetLaunchDate: '',
    city: '',
    state: '',
    inviteEmails: ['', '']
  })

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleInviteEmailChange = (index, value) => {
    setFormData(prev => ({
      ...prev,
      inviteEmails: prev.inviteEmails.map((email, i) => i === index ? value : email)
    }))
  }

  const validateStep = (step) => {
    switch (step) {
      case 1:
        return formData.clinicName.trim().length > 0
      case 2:
        return formData.targetLaunchDate.length > 0
      case 3:
        return true // Optional step
      case 4:
        return true // Optional step
      default:
        return true
    }
  }

  const nextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, 4))
      setError('')
    } else {
      setError('Please fill in the required fields')
    }
  }

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1))
    setError('')
  }

  const completeOnboarding = async () => {
    if (!user) {
      setError('User not authenticated')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Create organization
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert({
          name: formData.clinicName,
          target_launch_date: formData.targetLaunchDate || null,
          city: formData.city || null,
          state: formData.state || null,
        })
        .select()
        .single()

      if (orgError) throw orgError

      // Create user record
      const { error: userError } = await supabase
        .from('users')
        .insert({
          id: user.id,
          organization_id: orgData.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email,
        })

      if (userError) throw userError

      // Send invitations (if any)
      const validEmails = formData.inviteEmails.filter(email => email.trim().length > 0)
      if (validEmails.length > 0) {
        // TODO: Implement invitation system
        console.log('Invitations to send:', validEmails)
      }

      navigate('/dashboard')
    } catch (err) {
      console.error('Onboarding error:', err)
      setError(err.message || 'An error occurred during setup')
    } finally {
      setLoading(false)
    }
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Building2 className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                What's your clinic name?
              </h2>
              <p className="text-gray-600">
                This will help us personalize your experience
              </p>
            </div>
            <div className="form-group">
              <label htmlFor="clinicName" className="block text-sm font-medium text-gray-700 mb-2">
                Clinic Name *
              </label>
              <input
                type="text"
                id="clinicName"
                className="form-input"
                placeholder="e.g., Hometown Family Medicine"
                value={formData.clinicName}
                onChange={(e) => handleInputChange('clinicName', e.target.value)}
                required
              />
            </div>
          </div>
        )

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Calendar className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                When do you plan to launch?
              </h2>
              <p className="text-gray-600">
                We'll use this to set realistic due dates for your tasks
              </p>
            </div>
            <div className="form-group">
              <label htmlFor="targetLaunchDate" className="block text-sm font-medium text-gray-700 mb-2">
                Target Launch Date *
              </label>
              <input
                type="date"
                id="targetLaunchDate"
                className="form-input"
                value={formData.targetLaunchDate}
                onChange={(e) => handleInputChange('targetLaunchDate', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required
              />
            </div>
          </div>
        )

      case 3:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <MapPin className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                Where is your clinic located?
              </h2>
              <p className="text-gray-600">
                Optional - helps us provide location-specific resources
              </p>
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
                  placeholder="e.g., Austin"
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
                  placeholder="e.g., TX"
                  value={formData.state}
                  onChange={(e) => handleInputChange('state', e.target.value)}
                  maxLength={2}
                />
              </div>
            </div>
          </div>
        )

      case 4:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Users className="icon-lg mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                Invite your team
              </h2>
              <p className="text-gray-600">
                Optional - invite up to 2 additional team members
              </p>
            </div>
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
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome to DPC Startup Task Manager
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Let's get your clinic set up in just a few steps
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex justify-center space-x-2">
          {[1, 2, 3, 4].map((step) => (
            <div
              key={step}
              className={`w-3 h-3 rounded-full ${
                step <= currentStep ? 'bg-primary' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>

        <div className="bg-white py-8 px-6 shadow-lg rounded-lg">
          {renderStep()}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="mt-8 flex justify-between">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={prevStep}
                className="btn btn-secondary flex items-center"
                disabled={loading}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </button>
            )}
            
            <div className="ml-auto">
              {currentStep < 4 ? (
                <button
                  type="button"
                  onClick={nextStep}
                  className="btn btn-primary flex items-center"
                  disabled={loading}
                >
                  Next
                  <ArrowRight className="w-4 h-4 ml-2" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={completeOnboarding}
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Setting up...' : 'Complete Setup'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OnboardingWizard