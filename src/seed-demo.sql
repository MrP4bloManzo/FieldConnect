-- Fictional catalog records. No login accounts or shared passwords are created.
INSERT INTO companies(name) VALUES ('Telco México (ejemplo)'),('Infraestructura del Pacífico (ejemplo)') ON CONFLICT(name) DO NOTHING;
INSERT INTO employees(name,kind,email,phone)
SELECT v.* FROM (VALUES
 ('Andrea Torres (ejemplo)','logistics','andrea@example.com',''),
 ('Carlos Ramírez (ejemplo)','logistics','carlos@example.com',''),
 ('Manuel Díaz (ejemplo)','idc','manuel@example.com',''),
 ('Lucía Herrera (ejemplo)','idc','lucia@example.com','')
) AS v(name,kind,email,phone)
WHERE NOT EXISTS(SELECT 1 FROM employees e WHERE e.email=v.email AND e.kind=v.kind);

INSERT INTO tickets(folio,company_id,client,project,site_id,access_folio,service_type,site_name,region,address,scope,logistics_owner,idc_owner,status,logistics_status)
SELECT 'FC-EJEMPLO-001',c.id,c.name,'Modernización de red (ejemplo)','','ENT-EJEMPLO-001','Mantenimiento preventivo','Nodo de ejemplo','Colima','Domicilio ficticio','Inspección y pruebas de conectividad',a.id,i.id,'assigned','in_coordination'
FROM companies c JOIN employees a ON a.email='andrea@example.com' AND a.kind='logistics' AND a.active
JOIN employees i ON i.email='manuel@example.com' AND i.kind='idc' AND i.active
WHERE c.name='Telco México (ejemplo)' AND c.active
AND NOT EXISTS(SELECT 1 FROM tickets WHERE folio='FC-EJEMPLO-001');
