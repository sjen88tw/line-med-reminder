CREATE TABLE IF NOT EXISTS member (
  id            BIGSERIAL PRIMARY KEY,
  line_user_id  TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
