ALTER TABLE messages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'user';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_type_check') THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_type_check CHECK (type IN ('user','system'));
  END IF;
END $$;