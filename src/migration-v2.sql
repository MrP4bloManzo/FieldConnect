-- Safe to re-run. Keep old accounts for audit history, but disable field logins.
CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  site_sequence BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('logistics','idc')),
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  legacy_user_id BIGINT UNIQUE REFERENCES users(id)
);
INSERT INTO employees(name,kind,email,active,legacy_user_id)
SELECT name,role,email,active,id FROM users WHERE role IN ('logistics','idc')
ON CONFLICT(legacy_user_id) DO NOTHING;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET active=FALSE WHERE role IN ('logistics','idc');
UPDATE users SET role='director' WHERE role='superadmin';
-- Archived roles are allowed only on inactive historical accounts.
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('admin','director') OR (role IN ('logistics','idc') AND NOT active)
);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS access_folio TEXT NOT NULL DEFAULT '';
INSERT INTO companies(name) SELECT DISTINCT client FROM tickets ON CONFLICT(name) DO NOTHING;
UPDATE tickets t SET company_id=c.id FROM companies c WHERE c.name=t.client AND t.company_id IS NULL;
ALTER TABLE tickets ALTER COLUMN company_id SET NOT NULL;

-- Convert the old account assignments once; preserve their people and names.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tickets'::regclass AND conname='tickets_logistics_owner_fkey' AND confrelid='users'::regclass) THEN
    ALTER TABLE tickets DROP CONSTRAINT tickets_logistics_owner_fkey;
    UPDATE tickets t SET logistics_owner=e.id FROM employees e WHERE e.legacy_user_id=t.logistics_owner;
    ALTER TABLE tickets ADD CONSTRAINT tickets_logistics_owner_fkey FOREIGN KEY(logistics_owner) REFERENCES employees(id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tickets'::regclass AND conname='tickets_idc_owner_fkey' AND confrelid='users'::regclass) THEN
    ALTER TABLE tickets DROP CONSTRAINT tickets_idc_owner_fkey;
    UPDATE tickets t SET idc_owner=e.id FROM employees e WHERE e.legacy_user_id=t.idc_owner;
    ALTER TABLE tickets ADD CONSTRAINT tickets_idc_owner_fkey FOREIGN KEY(idc_owner) REFERENCES employees(id);
  END IF;
END $$;
UPDATE companies c SET site_sequence=GREATEST(c.site_sequence,COALESCE(
  (SELECT MAX(site_id::bigint) FROM tickets WHERE company_id=c.id AND site_id ~ '^[0-9]{1,15}$'),0));
CREATE UNIQUE INDEX IF NOT EXISTS tickets_company_site_unique ON tickets(company_id,site_id);

CREATE OR REPLACE FUNCTION assign_ticket_tracking() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE next_number BIGINT; company_name TEXT;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.site_id IS DISTINCT FROM OLD.site_id THEN
      RAISE EXCEPTION 'La empresa y el SITE ID de un ticket son inmutables' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF length(trim(NEW.access_folio))=0 THEN
    RAISE EXCEPTION 'El folio de entrada es obligatorio' USING ERRCODE='23514';
  END IF;
  UPDATE companies SET site_sequence=site_sequence+1 WHERE id=NEW.company_id AND active
    RETURNING site_sequence,name INTO next_number,company_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa inexistente o inactiva' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.logistics_owner AND kind='logistics' AND active)
    OR NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.idc_owner AND kind='idc' AND active) THEN
    RAISE EXCEPTION 'Selecciona un ingeniero de apoyo y un IDC activos' USING ERRCODE='23514';
  END IF;
  NEW.site_id := lpad(next_number::text,GREATEST(6,length(next_number::text)),'0');
  NEW.client := company_name;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ticket_tracking ON tickets;
CREATE TRIGGER ticket_tracking BEFORE INSERT OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION assign_ticket_tracking();

-- Backend-only access, including on Supabase: no anonymous Data API exposure.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_evidence ENABLE ROW LEVEL SECURITY;
