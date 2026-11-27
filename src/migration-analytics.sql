CREATE TABLE IF NOT EXISTS mexico_states (name TEXT PRIMARY KEY);
INSERT INTO mexico_states(name) VALUES
 ('Aguascalientes'),('Baja California'),('Baja California Sur'),('Campeche'),('Chiapas'),('Chihuahua'),
 ('Ciudad de México'),('Coahuila'),('Colima'),('Durango'),('Estado de México'),('Guanajuato'),('Guerrero'),
 ('Hidalgo'),('Jalisco'),('Michoacán'),('Morelos'),('Nayarit'),('Nuevo León'),('Oaxaca'),('Puebla'),
 ('Querétaro'),('Quintana Roo'),('San Luis Potosí'),('Sinaloa'),('Sonora'),('Tabasco'),('Tamaulipas'),
 ('Tlaxcala'),('Veracruz'),('Yucatán'),('Zacatecas') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS employee_coverage (
 employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 state_name TEXT NOT NULL REFERENCES mexico_states(name),
 PRIMARY KEY(employee_id,state_name)
);
-- Coverage examples apply only to the explicitly fictional seed personnel.
INSERT INTO employee_coverage(employee_id,state_name)
SELECT e.id,v.state_name FROM employees e JOIN (VALUES
 ('manuel@example.com','Colima'),('manuel@example.com','Jalisco'),
 ('lucia@example.com','Colima'),('lucia@example.com','Michoacán')
) v(email,state_name) ON e.email=v.email WHERE e.kind='idc' AND e.name LIKE '%(ejemplo)%'
ON CONFLICT DO NOTHING;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS service_state TEXT REFERENCES mexico_states(name);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS satisfaction TEXT CHECK (satisfaction IN ('satisfied','neutral','unsatisfied'));
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS satisfaction_notes TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS tickets_created_at_index ON tickets(created_at);
CREATE INDEX IF NOT EXISTS tickets_closed_at_index ON tickets(closed_at) WHERE status='completed';
CREATE INDEX IF NOT EXISTS companies_normalized_name_index ON companies(lower(regexp_replace(btrim(name),'\s+',' ','g')));
ALTER TABLE mexico_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_coverage ENABLE ROW LEVEL SECURITY;
