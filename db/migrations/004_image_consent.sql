CREATE TABLE IF NOT EXISTS consent (
  member_id  BIGINT PRIMARY KEY REFERENCES member(id),
  agreed_at  TIMESTAMPTZ NOT NULL,
  version    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prescription_image (
  id           BIGSERIAL PRIMARY KEY,
  member_id    BIGINT NOT NULL REFERENCES member(id),
  object_key   TEXT NOT NULL,        -- private bucket key; never a public URL
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | filed | unreadable
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
