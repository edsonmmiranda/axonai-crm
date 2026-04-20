-- Migration: Add is_active column to leads table for soft delete
-- Created: 2026-04-20
-- Schema Source: docs/schema_snapshot.json (leads table has no is_active column)

-- Step 1: Add is_active column with default true
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Step 2: Index for filtering active/inactive leads
CREATE INDEX IF NOT EXISTS idx_leads_is_active
ON leads (organization_id, is_active);

COMMENT ON COLUMN leads.is_active IS 'Soft delete flag — false means deactivated (hidden from default listings)';
