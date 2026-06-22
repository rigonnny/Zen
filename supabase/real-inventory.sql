-- ════════════════════════════════════════════════════════════════════════
--  ZEN RESIDENCES — Real project inventory
--  Loads 8 typologies + 4 building types + 84 property records
--  (79 houses + 2 administrata + hotel + kopsht + qendër tregtare).
--
--  Units are auto-numbered: T1-01..T1-12, T2-01..T2-38, etc.
--  After a sale, just rename the property to the owner's name — the code
--  (e.g. T1-07) stays as the permanent unit reference.
--
--  SAFE: removes ONLY the demo sample rows (the fixed IDs from seed.sql);
--  anything you added yourself is kept. Idempotent — safe to re-run.
--  Run in: Supabase → SQL Editor → New query → paste → Run.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Remove the demo sample data (precise: only the seed's fixed IDs)
delete from transactions   where id::text like '70000000-0000-4000-8000-%';
delete from offers         where id::text like '50000000-0000-4000-8000-%';
delete from documents      where id::text like '60000000-0000-4000-8000-%';
delete from reservations   where id::text like '30000000-0000-4000-8000-%';
delete from houses         where id::text like '20000000-0000-4000-8000-%';
delete from calc_scenarios where id::text like '42000000-0000-4000-8000-%';
delete from calc_subareas  where id::text like '41000000-0000-4000-8000-%';
delete from calc_projects  where id::text like '40000000-0000-4000-8000-%';
delete from house_types    where id::text like '10000000-0000-4000-8000-%';

-- 2) Typologies + building types
insert into house_types (name, description, sort_order) values
  ('Tipi 1',   '192.20 m² — 12 njësi', 1),
  ('Tipi 2',   '267.40 m² — 38 njësi', 2),
  ('Tipi 3',   '318.13 m² — 10 njësi', 3),
  ('Tipi 3.1', '318.13 m² — 1 njësi',  4),
  ('Tipi 4',   '390.83 m² — 5 njësi',  5),
  ('Tipi 5',   '482.00 m² — 3 njësi',  6),
  ('Tipi 6',   '176.40 m² — 5 njësi',  7),
  ('Tipi 6.1', '163.94 m² — 5 njësi',  8),
  ('Administratë',    'Ndërtesë administrate', 9),
  ('Hotel',           'Hotel',                 10),
  ('Kopsht',          'Çerdhe / kopsht',       11),
  ('Qendër Tregtare', 'Qendër tregtare',       12)
on conflict (name) do nothing;

-- 3) Houses per typology (auto-numbered: T1-01, T1-02, …)
insert into houses (type_id, name, code, area_m2, status)
select t.id,
       p.prefix || '-' || lpad(g::text, 2, '0'),   -- name (rename to owner later)
       p.prefix || '-' || lpad(g::text, 2, '0'),   -- code (permanent unit ref)
       p.area,
       'available'
from (values
  ('Tipi 1',   'T1',   192.20, 12),
  ('Tipi 2',   'T2',   267.40, 38),
  ('Tipi 3',   'T3',   318.13, 10),
  ('Tipi 3.1', 'T3.1', 318.13, 1),
  ('Tipi 4',   'T4',   390.83, 5),
  ('Tipi 5',   'T5',   482.00, 3),
  ('Tipi 6',   'T6',   176.40, 5),
  ('Tipi 6.1', 'T6.1', 163.94, 5)
) as p(tname, prefix, area, cnt)
join house_types t on t.name = p.tname
cross join lateral generate_series(1, p.cnt) as g
on conflict (code) do nothing;

-- 4) Other buildings
insert into houses (type_id, name, code, area_m2, status)
select t.id, b.bname, b.bcode, null::numeric, 'available'
from (values
  ('Administratë',    'Administratë 1',  'ADM-01'),
  ('Administratë',    'Administratë 2',  'ADM-02'),
  ('Hotel',           'Hotel',           'HOTEL'),
  ('Kopsht',          'Kopshti',         'KOPSHT'),
  ('Qendër Tregtare', 'Qendra Tregtare', 'QT')
) as b(tname, bname, bcode)
join house_types t on t.name = b.tname
on conflict (code) do nothing;

-- Done → 12 types and 84 properties. Check: Pronat should show 84 records.
