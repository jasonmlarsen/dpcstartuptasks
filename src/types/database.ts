export interface Organization {
  id: string
  name: string
  target_launch_date?: string
  city?: string
  state?: string
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  organization_id: string
  email: string
  full_name: string
  created_at: string
  updated_at: string
  organization?: Organization
}

export interface Task {
  id: string
  organization_id: string
  title: string
  description?: string
  category: string
  priority: number
  is_completed: boolean
  assigned_to?: string
  due_date?: string
  is_preloaded: boolean
  created_by?: string
  created_at: string
  updated_at: string
  assigned_user?: User
  created_by_user?: User
}

export interface Subtask {
  id: string
  task_id: string
  title: string
  is_completed: boolean
  created_at: string
  updated_at: string
}

export interface Comment {
  id: string
  task_id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  user?: User
}