import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Helper function to get current user's organization
export const getCurrentUserOrganization = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: userData, error } = await supabase
    .from('users')
    .select(`
      *,
      organization:organizations(*)
    `)
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('Error fetching user organization:', error)
    return null
  }

  return userData
}

// Helper function to check if user needs onboarding
export const needsOnboarding = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return true

  const { data: userData, error } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (error || !userData?.organization_id) {
    return true
  }

  return false
}