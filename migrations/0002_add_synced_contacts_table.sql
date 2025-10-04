-- Migration: Add synced_contacts table to track GoHighLevel to CallTools sync
-- Created: 2025-10-04

CREATE TABLE IF NOT EXISTS synced_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ghl_contact_id TEXT NOT NULL UNIQUE,
  calltools_contact_id TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending', -- pending, synced, failed, excluded
  last_sync_at TEXT,
  error_message TEXT,
  is_customer INTEGER DEFAULT 0, -- 0 = false, 1 = true
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_synced_contacts_ghl_id ON synced_contacts(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_synced_contacts_calltools_id ON synced_contacts(calltools_contact_id);
CREATE INDEX IF NOT EXISTS idx_synced_contacts_status ON synced_contacts(sync_status);
CREATE INDEX IF NOT EXISTS idx_synced_contacts_is_customer ON synced_contacts(is_customer);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_synced_contacts_timestamp 
AFTER UPDATE ON synced_contacts
BEGIN
  UPDATE synced_contacts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
