/*
  # Add resources and notes columns to tasks table

  1. Changes
    - Add `resources` column to tasks table (text, nullable)
    - Add `notes` column to tasks table (text, nullable)

  2. Security
    - No changes to RLS policies needed as these are just additional columns
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'resources'
  ) THEN
    ALTER TABLE tasks ADD COLUMN resources text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'notes'
  ) THEN
    ALTER TABLE tasks ADD COLUMN notes text;
  END IF;
END $$;