-- Migration: Add is_active column to tags table
-- Created: 2026-04-20
-- Sprint: 09 (Tags)
-- Schema Source: docs/schema_snapshot.json (confirmed against real DB structure)

-- Add is_active column for soft-delete support
ALTER TABLE tags
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Comment for documentation
COMMENT ON COLUMN tags.is_active IS 'Soft-delete flag. false = deactivated tag (hidden from new assignments, kept for history).';
