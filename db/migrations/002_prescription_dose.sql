CREATE TABLE IF NOT EXISTS prescription (
  id          BIGSERIAL PRIMARY KEY,
  member_id   BIGINT NOT NULL REFERENCES member(id),
  start_date  DATE NOT NULL,
  days        INT NOT NULL,
  meds        JSONB NOT NULL,        -- [{ name, qty, freq:'TID', timing:'飯後' }]
  status      TEXT NOT NULL DEFAULT 'active',  -- active | ended
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dose_event (
  id              TEXT PRIMARY KEY,  -- prescriptionId + 'YYYY-MM-DD' + slot
  prescription_id BIGINT NOT NULL REFERENCES prescription(id),
  member_id       BIGINT NOT NULL,
  slot            TEXT NOT NULL,     -- morning | noon | evening | bedtime
  scheduled_at    TIMESTAMPTZ NOT NULL,
  meds            JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'SCHEDULED',
  confirmed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dose_status_time ON dose_event(status, scheduled_at);
