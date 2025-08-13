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

  const { data: userDataArray, error } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .limit(1)

  if (error || !userDataArray || userDataArray.length === 0 || !userDataArray[0]?.organization_id) {
    return true
  }

  return false
}

// Helper function to fetch organization users
export const fetchOrganizationUsers = async (organizationId) => {
  if (!organizationId) return []

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, full_name')
    .eq('organization_id', organizationId)
    .order('full_name', { ascending: true })

  if (error) {
    console.error('Error fetching organization users:', error)
    return []
  }

  return users || []
}
// Helper function to fetch tasks with filters
export const fetchTasks = async (filters = {}) => {
  const { 
    organizationId, 
    assignedToUserId, 
    excludeAssignedToUserId,
    category,
    showCompleted = false,
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = filters

  if (!organizationId) return []

  let query = supabase
    .from('tasks')
    .select(`
      *,
      assigned_user:users!tasks_assigned_to_fkey(id, full_name, email),
      created_by_user:users!tasks_created_by_fkey(id, full_name, email),
      subtasks(id, title, is_completed)
    `)
    .eq('organization_id', organizationId)

  // Apply filters
  if (assignedToUserId) {
    query = query.eq('assigned_to', assignedToUserId)
  }

  if (excludeAssignedToUserId) {
    query = query.neq('assigned_to', excludeAssignedToUserId)
  }

  // Filter by category
  if (category && category !== 'All') {
    query = query.eq('category', category)
  }

  // Hide completed tasks by default
  if (!showCompleted) {
    query = query.eq('is_completed', false)
  }

  // Apply sorting
  const ascending = sortOrder === 'asc'
  if (sortBy === 'due_date') {
    // Handle null due dates by putting them at the end
    query = query.order('due_date', { ascending, nullsLast: true })
  } else if (sortBy === 'category') {
    query = query.order('category', { ascending })
  } else {
    // Default to created_at
    query = query.order('created_at', { ascending })
  }

  const { data: tasks, error } = await query

  if (error) {
    console.error('Error fetching tasks:', error)
    return []
  }

  return tasks || []
}