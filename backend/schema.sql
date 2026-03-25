-- Lightweight event-sourcing schema (SQLite)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  selected_domain TEXT,
  target_role TEXT,
  question_type TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS onboarding_profiles (
  session_id TEXT PRIMARY KEY,
  dream_role TEXT,
  current_field TEXT,
  level TEXT,
  time_commitment TEXT,
  is_onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session_id_created_at
ON events(session_id, created_at);
