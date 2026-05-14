-- Adds activation email delivery tracking fields to existing users tables.
-- Safe to run more than once and does not alter existing user data.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS activation_email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS activation_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activation_email_provider TEXT,
  ADD COLUMN IF NOT EXISTS activation_email_status TEXT;
