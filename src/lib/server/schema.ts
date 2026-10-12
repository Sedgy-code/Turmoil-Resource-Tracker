export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_members (
  id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT,
  global_display_name TEXT,
  avatar_url TEXT,
  global_avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_updated_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS global_display_name TEXT;
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS global_avatar_url TEXT;
CREATE TABLE IF NOT EXISTS resource_entries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES app_members(id),
  week_start DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  resources JSONB NOT NULL DEFAULT '{}'::jsonb,
  summoning_costs JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '' CHECK (LENGTH(notes) <= 2000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL REFERENCES app_members(id),
  UNIQUE (member_id, week_start)
);
ALTER TABLE resource_entries ADD COLUMN IF NOT EXISTS summoning_costs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE resource_entries ADD COLUMN IF NOT EXISTS planning_details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS badge TEXT;
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS cosmetic_title TEXT;
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS cosmetic_accent TEXT;
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS cosmetic_frame TEXT;
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
CREATE TABLE IF NOT EXISTS member_banks (
  member_id TEXT PRIMARY KEY REFERENCES app_members(id),
  resources JSONB NOT NULL DEFAULT '{}'::jsonb,
  summoning_costs JSONB NOT NULL DEFAULT '{}'::jsonb,
  planning_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL REFERENCES app_members(id)
);
INSERT INTO member_banks (member_id, resources, summoning_costs, planning_details, notes, updated_at, updated_by)
SELECT DISTINCT ON (member_id) member_id, resources, summoning_costs, planning_details, notes, updated_at, updated_by
FROM resource_entries ORDER BY member_id, week_start DESC, updated_at DESC
ON CONFLICT (member_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS bank_versions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES app_members(id),
  resources JSONB NOT NULL,
  summoning_costs JSONB NOT NULL,
  planning_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by TEXT NOT NULL REFERENCES app_members(id)
);
CREATE INDEX IF NOT EXISTS bank_versions_cutoff_idx ON bank_versions(member_id, updated_at DESC);
INSERT INTO bank_versions (id, member_id, resources, summoning_costs, planning_details, notes, updated_at, updated_by)
SELECT 'initial:' || b.member_id, b.member_id, b.resources, b.summoning_costs, b.planning_details, b.notes, b.updated_at, b.updated_by
FROM member_banks b WHERE NOT EXISTS (SELECT 1 FROM bank_versions v WHERE v.member_id = b.member_id)
ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS member_status_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES app_members(id),
  active BOOLEAN NOT NULL,
  role TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT,
  changed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS member_status_cutoff_idx ON member_status_events(member_id, changed_at DESC);
INSERT INTO member_status_events (id,member_id,active,role,username,avatar_url,changed_at)
SELECT 'initial:' || m.id,m.id,m.active,m.role,COALESCE(NULLIF(m.display_name,''),m.username),m.avatar_url,m.joined_at
FROM app_members m WHERE NOT EXISTS (SELECT 1 FROM member_status_events e WHERE e.member_id=m.id)
ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS bank_snapshots (
  week_start DATE PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL,
  automatic BOOLEAN NOT NULL DEFAULT TRUE,
  members JSONB NOT NULL,
  entries JSONB NOT NULL,
  totals JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_history_state (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL
);
INSERT INTO bank_history_state(id,started_at) VALUES('live-banks',clock_timestamp()) ON CONFLICT(id) DO NOTHING;
INSERT INTO bank_history_state(id,started_at) VALUES('chance-war-estimates',clock_timestamp()) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS clan_settings (
  id TEXT PRIMARY KEY,
  capacity INTEGER NOT NULL DEFAULT 50 CHECK (capacity BETWEEN 1 AND 1000),
  war_rates JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS bank_manual_snapshots (
  id TEXT PRIMARY KEY,
  week_start DATE NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  members JSONB NOT NULL,
  entries JSONB NOT NULL,
  totals JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS snipe_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  activities JSONB NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL REFERENCES app_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_result JSONB
);
CREATE TABLE IF NOT EXISTS snipe_responses (
  snipe_id TEXT NOT NULL REFERENCES snipe_plans(id),
  member_id TEXT NOT NULL REFERENCES app_members(id),
  answer TEXT NOT NULL CHECK (answer IN ('yes','no')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (snipe_id, member_id)
);
CREATE TABLE IF NOT EXISTS snipe_attendance (
  snipe_id TEXT NOT NULL REFERENCES snipe_plans(id),
  member_id TEXT NOT NULL REFERENCES app_members(id),
  confirmed_by TEXT NOT NULL REFERENCES app_members(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (snipe_id, member_id)
);
CREATE TABLE IF NOT EXISTS dew_balances (
  member_id TEXT PRIMARY KEY REFERENCES app_members(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0)
);
CREATE TABLE IF NOT EXISTS dew_earnings (
  member_id TEXT NOT NULL REFERENCES app_members(id),
  earned_on DATE NOT NULL,
  PRIMARY KEY (member_id, earned_on)
);
CREATE TABLE IF NOT EXISTS dew_weekly_earnings (
  member_id TEXT NOT NULL REFERENCES app_members(id),
  week_start DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  reason TEXT NOT NULL CHECK (reason IN ('resources', 'snipe')),
  amount INTEGER NOT NULL CHECK ((reason = 'resources' AND amount = 20) OR (reason = 'snipe' AND amount = 10)),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (member_id, week_start, reason)
);
CREATE TABLE IF NOT EXISTS dew_owned (
  member_id TEXT NOT NULL REFERENCES app_members(id),
  item_id TEXT NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, item_id)
);
`;
