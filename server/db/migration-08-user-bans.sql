CREATE TABLE IF NOT EXISTS user_bans (
  blocker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);