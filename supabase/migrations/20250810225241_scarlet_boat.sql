/*
  # Add INSERT policy for organizations table

  1. Security
    - Add policy to allow authenticated users to insert new organizations
    - This enables the onboarding flow where new users create their clinic/organization
*/

-- Add INSERT policy for organizations table
CREATE POLICY "Users can create organizations"
  ON organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (true);