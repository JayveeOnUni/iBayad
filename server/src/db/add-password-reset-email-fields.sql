-- Adds password reset tokens and provider message ID tracking for account emails.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS activation_email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_email_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token_hash
  ON users(password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;
