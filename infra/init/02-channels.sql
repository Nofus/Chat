ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_private    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_system     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE channel_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channel_members_role_check') THEN
    ALTER TABLE channel_members
      ADD CONSTRAINT channel_members_role_check
      CHECK (role IN ('owner','admin','member'));
  END IF;
END $$;

INSERT INTO channels (name, is_system) VALUES ('general', true)
  ON CONFLICT (name) DO UPDATE SET is_system = true;