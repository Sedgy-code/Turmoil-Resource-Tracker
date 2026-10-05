export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_members (
  id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_updated_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS resource_entries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES app_members(id),
  week_start DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  resources JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '' CHECK (LENGTH(notes) <= 2000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL REFERENCES app_members(id),
  UNIQUE (member_id, week_start)
);
CREATE INDEX IF NOT EXISTS entries_week_idx ON resource_entries(week_start);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES app_members(id),
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  oauth_expires_at TIMESTAMPTZ NOT NULL,
  membership_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON auth_sessions(expires_at);
`;
