CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','logistics','idc')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  folio TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL,
  project TEXT NOT NULL,
  site_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  site_name TEXT NOT NULL,
  region TEXT NOT NULL,
  address TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  access_instructions TEXT DEFAULT '',
  scheduled_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  scope TEXT NOT NULL,
  activities TEXT DEFAULT '',
  tools TEXT DEFAULT '',
  materials TEXT DEFAULT '',
  prerequisites TEXT DEFAULT '',
  technical_notes TEXT DEFAULT '',
  agreed_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (agreed_amount >= 0),
  travel_expenses NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (travel_expenses >= 0),
  other_expenses NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (other_expenses >= 0),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','partial','paid','not_applicable')),
  financial_notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','assigned','in_progress','on_hold','completed','cancelled')),
  logistics_status TEXT NOT NULL DEFAULT 'pending' CHECK (logistics_status IN ('pending','in_coordination','ready')),
  created_by BIGINT REFERENCES users(id),
  logistics_owner BIGINT REFERENCES users(id),
  idc_owner BIGINT REFERENCES users(id),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result TEXT DEFAULT '',
  close_checklist JSONB NOT NULL DEFAULT '[false,false,false,false,false,false]'::jsonb,
  closed_by BIGINT REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id BIGINT REFERENCES users(id),
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_notes (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id BIGINT REFERENCES users(id),
  note_type TEXT NOT NULL CHECK (note_type IN ('note','incident','blocker')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_evidence (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  added_by BIGINT REFERENCES users(id),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_logistics_status ON tickets(logistics_status);
CREATE INDEX IF NOT EXISTS idx_tickets_idc_owner ON tickets(idc_owner);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_ticket ON ticket_notes(ticket_id, created_at DESC);
