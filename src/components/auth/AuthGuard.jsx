import React, { useEffect, useState } from 'react'
import { useAuth } from './AuthProvider'
import { needsOnboarding } from '../../lib/supabase'
import OnboardingWizard from '../onboarding/OnboardingWizard'
import AuthPage from './AuthPage'

const AuthGuard = ({ children }) => {
  const { user, loading } = useAuth()
  const [requiresOnboarding, setRequiresOnboarding] = useState(false)
  const [checkingOnboarding, setCheckingOnboarding] = useState(true)

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (user) {
        const needs = await needsOnboarding()
        setRequiresOnboarding(needs)
      }
      setCheckingOnboarding(false)
    }

    if (!loading) {
      checkOnboardingStatus()
    }
  }, [user, loading])

  if (loading || checkingOnboarding) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <AuthPage />
  }

  if (requiresOnboarding) {
    return <OnboardingWizard />
  }

  return children
}

export default AuthGuard