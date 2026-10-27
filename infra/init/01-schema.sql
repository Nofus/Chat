CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  avatar_url TEXT,
  bio TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_private BOOLEAN NOT NULL DEFAULT false,
  password_hash TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_direct BOOLEAN NOT NULL DEFAULT false,
  avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'user' CHECK (type IN ('user','system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  image_url TEXT
);

CREATE TABLE IF NOT EXISTS channel_bans (
  channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  banned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_bans (
  blocker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages (channel_id, created_at DESC);

INSERT INTO channels (name, is_system) VALUES ('general', true) ON CONFLICT (name) DO UPDATE SET is_system = true;