/*
  # Fix RLS Policy Infinite Recursion

  1. Problem
    - Current RLS policies on users table create infinite recursion
    - Policies reference users table within themselves causing circular queries

  2. Solution
    - Simplify user policies to avoid self-referencing queries
    - Use auth.uid() directly for user identification
    - Remove complex subqueries that reference users table from within user policies

  3. Changes
    - Drop existing problematic policies on users table
    - Create new simplified policies that don't cause recursion
    - Maintain security while avoiding circular references
*/

-- Drop existing problematic policies on users table
DROP POLICY IF EXISTS "Users can insert new users in same organization" ON users;
DROP POLICY IF EXISTS "Users can read users in same organization" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;

-- Create new simplified policies for users table
-- Policy for users to read their own profile
CREATE POLICY "Users can read own profile"
  ON users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Policy for users to update their own profile
CREATE POLICY "Users can update own profile"
  ON users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Policy for inserting new users (during onboarding)
-- This allows authenticated users to insert their own user record
CREATE POLICY "Users can insert own profile"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Update organizations policies to be simpler and avoid recursion
DROP POLICY IF EXISTS "Users can read own organization" ON organizations;
DROP POLICY IF EXISTS "Users can update own organization" ON organizations;

-- Create new organization policies that don't reference users table
CREATE POLICY "Users can read own organization"
  ON organizations
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT organization_id 
      FROM users 
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update own organization"
  ON organizations
  FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT organization_id 
      FROM users 
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT organization_id 
      FROM users 
      WHERE id = auth.uid()
    )
  );

-- Update tasks policies to avoid potential recursion
DROP POLICY IF EXISTS "Users can insert tasks in same organization" ON tasks;
DROP POLICY IF EXISTS "Users can read tasks in same organization" ON tasks;
DROP POLICY IF EXISTS "Users can update tasks in same organization" ON tasks;
DROP POLICY IF EXISTS "Users can delete tasks in same organization" ON tasks;

CREATE POLICY "Users can read tasks in same organization"
  ON tasks
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert tasks in same organization"
  ON tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update tasks in same organization"
  ON tasks
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tasks in same organization"
  ON tasks
  FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM users 
      WHERE id = auth.uid()
    )
  );

-- Update subtasks policies
DROP POLICY IF EXISTS "Users can insert subtasks in same organization" ON subtasks;
DROP POLICY IF EXISTS "Users can read subtasks in same organization" ON subtasks;
DROP POLICY IF EXISTS "Users can update subtasks in same organization" ON subtasks;
DROP POLICY IF EXISTS "Users can delete subtasks in same organization" ON subtasks;

CREATE POLICY "Users can read subtasks in same organization"
  ON subtasks
  FOR SELECT
  TO authenticated
  USING (
    task_id IN (
      SELECT t.id 
      FROM tasks t
      JOIN users u ON t.organization_id = u.organization_id
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Users can insert subtasks in same organization"
  ON subtasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    task_id IN (
      SELECT t.id 
      FROM tasks t
      JOIN users u ON t.organization_id = u.organization_id
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Users can update subtasks in same organization"
  ON subtasks
  FOR UPDATE
  TO authenticated
  USING (
    task_id IN (
      SELECT t.id 
      FROM tasks t
      JOIN users u ON t.organization_id = u.organization_id
      WHERE u.id = auth.uid()
    )
  )
  WITH CHECK (
    task_id IN (
      SELECT t.id 
      FROM tasks t
      JOIN users u ON t.organization_id = u.organization_id
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Users can delete subtasks in same organization"
  ON subtasks
  FOR DELETE
  TO authenticated
  USING (
    task_id IN (
      SELECT t.id 
      FROM tasks t
      JOIN users u ON t.organization_id = u.organization_id
      WHERE u.id = auth.uid()
    )
  );

-- Update comments policies
DROP POLICY IF EXISTS "Users can insert comments in same organization" ON comments;
DROP POLICY IF EXISTS "Users can read comments in same organization" ON comments;
DROP POLICY IF EXISTS "Users can update own comments" ON comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON comments;

CREATE POLICY "Users can read comments in same organization"
  ON comments
  FOR SELECT
  TO authenticated
  USING (
    task_id IN (
      SELECT t.id 
      FROM tasks t
      JOIN users u ON t.organization_id = u.organization_id
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Users can insert comments in same organization"
  ON comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    task_id IN (
      SELECT t.id 
      FROM tasks t
      JOIN users u ON t.organization_id = u.organization_id
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Users can update own comments"
  ON comments
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own comments"
  ON comments
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());