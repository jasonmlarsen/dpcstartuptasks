/*
  # Fix RLS policies for onboarding

  This migration fixes all RLS policy issues that are preventing the onboarding flow from working:

  1. Organizations table policies
     - Allow authenticated users to create organizations during onboarding
     - Allow users to read organizations they belong to
     - Allow users to update organizations they belong to

  2. Users table policies  
     - Allow authenticated users to read their own user record
     - Allow authenticated users to insert their own user record
     - Allow authenticated users to update their own user record

  3. Security
     - All policies use auth.uid() for proper user identification
     - Policies prevent unauthorized access while enabling onboarding
*/

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can read own organization" ON public.organizations;
DROP POLICY IF EXISTS "Users can update own organization" ON public.organizations;

DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

-- Organizations table policies
CREATE POLICY "Allow authenticated users to create organization" 
  ON public.organizations 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

CREATE POLICY "Allow users to read their organization" 
  ON public.organizations 
  FOR SELECT 
  TO authenticated 
  USING (
    id IN (
      SELECT organization_id 
      FROM public.users 
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "Allow users to update their organization" 
  ON public.organizations 
  FOR UPDATE 
  TO authenticated 
  USING (
    id IN (
      SELECT organization_id 
      FROM public.users 
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT organization_id 
      FROM public.users 
      WHERE id = auth.uid()
    )
  );

-- Users table policies
CREATE POLICY "Allow authenticated users to read their own user record" 
  ON public.users 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = id);

CREATE POLICY "Allow authenticated users to insert their own user record" 
  ON public.users 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Allow authenticated users to update their own user record" 
  ON public.users 
  FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);