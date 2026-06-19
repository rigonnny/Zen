-- ════════════════════════════════════════════════════════════════════════
--  ZEN RESIDENCES CRM — Seed data (sample records for testing)
--  Run AFTER 0001_init.sql, in the Supabase SQL Editor.
--  Uses fixed UUIDs + ON CONFLICT so it is safe to re-run.
--  NOTE: document/offer rows point at placeholder storage paths; the file
--        download will 404 until you upload real files via the app.
-- ════════════════════════════════════════════════════════════════════════

-- ── House types (Tipet) ─────────────────────────────────────────────────
insert into house_types (id, name, description, sort_order) values
  ('10000000-0000-4000-8000-000000000001', 'Tipi 1', 'Shtëpi njëkatëshe — modeli bazë',      1),
  ('10000000-0000-4000-8000-000000000002', 'Tipi 2', 'Shtëpi dykatëshe me oborr',            2),
  ('10000000-0000-4000-8000-000000000003', 'Tipi 3', 'Vilë premium me garazh',               3)
on conflict (id) do nothing;

-- ── Houses (Shtëpitë) ───────────────────────────────────────────────────
insert into houses (id, type_id, name, code, area_m2, status, sale_price, debt_deadline, description) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Shtëpia A1','T1-A1',110.00,'sold',      120000.00, current_date + 30, 'Kompletuar, dorëzuar klientit.'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Shtëpia A2','T1-A2',110.00,'available', 122000.00, null,             'E lirë.'),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Shtëpia A3','T1-A3',115.00,'reserved',  125000.00, current_date + 14, 'E rezervuar.'),
  ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Shtëpia A4','T1-A4',115.00,'reserved',  125000.00, current_date + 14, 'E rezervuar.'),
  ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','Shtëpia B1','T2-B1',150.00,'sold',      185000.00, current_date - 5,  'Borxh i mbetur, afati ka kaluar.'),
  ('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','Shtëpia B2','T2-B2',150.00,'available', 189000.00, null,             'E lirë.'),
  ('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000002','Shtëpia B3','T2-B3',160.00,'sold',      195000.00, current_date + 45, 'Pagesa në vazhdim.'),
  ('20000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000003','Shtëpia C1','T3-C1',220.00,'available', 320000.00, null,             'Vilë premium.'),
  ('20000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000003','Shtëpia C2','T3-C2',230.00,'reserved',  335000.00, current_date + 7,  'E rezervuar nga klient VIP.')
on conflict (id) do nothing;

-- ── Transactions (Të hyrat / Shpenzimet) ────────────────────────────────
-- Income rows tied to a house_id == that house's Pagesat.
insert into transactions (id, kind, method, amount, category, house_id, description, occurred_on) values
  -- House A1 — fully paid (120k)
  ('70000000-0000-4000-8000-000000000001','income','bank',  80000.00,'Pagesë','20000000-0000-4000-8000-000000000001','Kësti i parë',  current_date - 150),
  ('70000000-0000-4000-8000-000000000002','income','cash',  40000.00,'Pagesë','20000000-0000-4000-8000-000000000001','Kësti i fundit', current_date - 60),
  -- House B1 — partially paid (owes remainder, overdue)
  ('70000000-0000-4000-8000-000000000003','income','bank', 100000.00,'Pagesë','20000000-0000-4000-8000-000000000005','Paradhënie',     current_date - 120),
  ('70000000-0000-4000-8000-000000000004','income','cash',  30000.00,'Pagesë','20000000-0000-4000-8000-000000000005','Kësti 2',        current_date - 40),
  -- House B3 — in progress
  ('70000000-0000-4000-8000-000000000005','income','bank',  60000.00,'Pagesë','20000000-0000-4000-8000-000000000007','Paradhënie',     current_date - 25),
  -- General company expenses (no house_id)
  ('70000000-0000-4000-8000-000000000010','expense','bank', 45000.00,'Materiale ndërtimi', null,'Çimento dhe hekur',      current_date - 130),
  ('70000000-0000-4000-8000-000000000011','expense','cash', 12000.00,'Paga',               null,'Paga punëtorësh',        current_date - 95),
  ('70000000-0000-4000-8000-000000000012','expense','bank', 22000.00,'Nënkontraktor',      null,'Punime elektrike',       current_date - 70),
  ('70000000-0000-4000-8000-000000000013','expense','cash',  8000.00,'Transport',          null,'Transport materialesh',  current_date - 35),
  ('70000000-0000-4000-8000-000000000014','expense','bank', 30000.00,'Materiale ndërtimi', null,'Dritare dhe dyer',       current_date - 15)
on conflict (id) do nothing;

-- ── Reservations (Rezervimet) ───────────────────────────────────────────
insert into reservations (id, client_name, client_contact, reserved_on, hold_until, status, notes) values
  ('30000000-0000-4000-8000-000000000001','Arben Krasniqi','+383 44 123 456', current_date - 5,  current_date + 14, 'active',  '2 shtëpi — Tipi 1'),
  ('30000000-0000-4000-8000-000000000002','Vesa Hoxha',    '+383 49 987 654', current_date - 40, current_date - 5,  'expired', 'Afati ka kaluar'),
  ('30000000-0000-4000-8000-000000000003','Driton Berisha','driton@example.com', current_date - 2, current_date + 7, 'active', 'Vilë premium')
on conflict (id) do nothing;

insert into reservation_houses (reservation_id, house_id) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003'),
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006'),
  ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000009')
on conflict do nothing;

-- ── Offers (Ofertat) — metadata only until real files are uploaded ──────
insert into offers (id, client_name, house_id, file_path, file_name, mime_type, amount, status, offer_date, notes) values
  ('50000000-0000-4000-8000-000000000001','Arben Krasniqi','20000000-0000-4000-8000-000000000003','seed/oferta-arben.pdf','Oferta_Arben_Krasniqi.pdf','application/pdf',124000.00,'received', current_date - 5,  'Ofertë për Shtëpinë A3'),
  ('50000000-0000-4000-8000-000000000002','Driton Berisha','20000000-0000-4000-8000-000000000009','seed/oferta-driton.pdf','Oferta_Driton_Berisha.pdf','application/pdf',330000.00,'accepted', current_date - 2,  'Ofertë premium e pranuar'),
  ('50000000-0000-4000-8000-000000000003','Leart Gashi',   null,                                  'seed/oferta-leart.eml','Oferta_Leart_Gashi.eml','message/rfc822',null,'received', current_date - 10, 'Email i ruajtur manualisht')
on conflict (id) do nothing;

-- ── Documents (Dokumentacionet + Planimetria) — metadata only ───────────
insert into documents (id, house_id, category, bucket, file_path, file_name, mime_type) values
  ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','documentation','documents', 'seed/kontrata-a1.pdf','Kontrata_Shitjes_A1.pdf','application/pdf'),
  ('60000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','floorplan',    'floorplans','seed/planimetria-a1.pdf','Planimetria_A1.pdf','application/pdf'),
  ('60000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000005','documentation','documents', 'seed/kontrata-b1.pdf','Kontrata_Shitjes_B1.pdf','application/pdf')
on conflict (id) do nothing;

-- ── Profit calculator (Kalkulatori) ─────────────────────────────────────
insert into calc_projects (id, name, total_area_m2, landowner_share_pct, notes) values
  ('40000000-0000-4000-8000-000000000001','Toka Kryesore — 27.000 m²', 27000.00, 30.00, 'Projekti kryesor i zhvillimit')
on conflict (id) do nothing;

insert into calc_subareas (id, project_id, label, area_m2, sort_order) values
  ('41000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Zona A — banim',  4000.00, 1),
  ('41000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','Zona B — komerciale', 1000.00, 2)
on conflict (id) do nothing;

insert into calc_scenarios (id, project_id, label, price_per_m2, sort_order) values
  ('42000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','1.350 €/m²', 1350.00, 1),
  ('42000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','1.400 €/m²', 1400.00, 2),
  ('42000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','1.500 €/m²', 1500.00, 3)
on conflict (id) do nothing;
