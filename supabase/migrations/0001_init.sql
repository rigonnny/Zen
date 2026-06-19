-- ════════════════════════════════════════════════════════════════════════
--  ZEN RESIDENCES CRM — Database schema (Supabase / Postgres)
--  Run this once in: Supabase Dashboard → SQL Editor → New query → Run.
--  Idempotent-ish: safe to re-run on a fresh project.
-- ════════════════════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────────────────
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;     -- fast ILIKE search on 1000+ rows

-- ── Enums ───────────────────────────────────────────────────────────────
do $$ begin
  create type transaction_kind as enum ('income', 'expense');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('bank', 'cash');
exception when duplicate_object then null; end $$;

do $$ begin
  create type house_status as enum ('available', 'reserved', 'sold');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_status as enum ('active', 'expired', 'cancelled', 'converted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_category as enum ('documentation', 'floorplan', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type offer_status as enum ('received', 'accepted', 'rejected', 'expired');
exception when duplicate_object then null; end $$;

-- ── Shared helper: keep updated_at fresh ────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ════════════════════════════════════════════════════════════════════════
--  PROFILES (mirrors auth.users for display names / roles)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'member',  -- 'admin' | 'member'
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up / is invited.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ════════════════════════════════════════════════════════════════════════
--  PROPERTIES — Houses → Tipi (type) → individual House
-- ════════════════════════════════════════════════════════════════════════
create table if not exists house_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,          -- "Tipi 1", "Tipi 2", ...
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists houses (
  id            uuid primary key default gen_random_uuid(),
  type_id       uuid not null references house_types(id) on delete restrict,
  name          text not null,               -- "House X"
  code          text unique,                 -- optional human-friendly code
  area_m2       numeric(12,2),
  status        house_status not null default 'available',
  sale_price    numeric(14,2) not null default 0,   -- agreed full price (EUR)
  debt_deadline date,                        -- Afati i Borgjeve
  description   text,                        -- free-text notes
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists houses_set_updated_at on houses;
create trigger houses_set_updated_at before update on houses
  for each row execute function set_updated_at();

create index if not exists idx_houses_type    on houses(type_id);
create index if not exists idx_houses_status  on houses(status);
create index if not exists idx_houses_name_trgm on houses using gin (name gin_trgm_ops);
create index if not exists idx_houses_code_trgm on houses using gin (code gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════
--  FINANCES — single ledger powering the Dashboard + per-house Pagesat
-- ════════════════════════════════════════════════════════════════════════
create table if not exists transactions (
  id           uuid primary key default gen_random_uuid(),
  kind         transaction_kind not null,          -- income | expense
  method       payment_method  not null,           -- bank | cash
  amount       numeric(14,2) not null check (amount >= 0),
  category     text,
  house_id     uuid references houses(id) on delete set null,  -- set → it is a Pagesa
  description  text,
  occurred_on  date not null default current_date,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_tx_house  on transactions(house_id);
create index if not exists idx_tx_kind   on transactions(kind);
create index if not exists idx_tx_method on transactions(method);
create index if not exists idx_tx_date   on transactions(occurred_on);

-- ════════════════════════════════════════════════════════════════════════
--  DOCUMENTS — Dokumentacionet + Planimetria (files in Supabase Storage)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists documents (
  id           uuid primary key default gen_random_uuid(),
  house_id     uuid not null references houses(id) on delete cascade,
  category     document_category not null default 'documentation',
  bucket       text not null default 'documents',
  file_path    text not null,                 -- object path within the bucket
  file_name    text not null,                 -- original display name
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_docs_house on documents(house_id);
create index if not exists idx_docs_cat   on documents(category);
create index if not exists idx_docs_name_trgm on documents using gin (file_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════
--  RESERVATIONS — Rezervimet (a reservation covers one or more houses)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists reservations (
  id             uuid primary key default gen_random_uuid(),
  client_name    text not null,
  client_contact text,
  reserved_on    date not null default current_date,
  hold_until     date not null,               -- expiry / hold date
  status         reservation_status not null default 'active',
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_res_status on reservations(status);
create index if not exists idx_res_hold   on reservations(hold_until);

create table if not exists reservation_houses (
  reservation_id uuid not null references reservations(id) on delete cascade,
  house_id       uuid not null references houses(id) on delete cascade,
  primary key (reservation_id, house_id)
);

create index if not exists idx_reshouses_house on reservation_houses(house_id);

-- ════════════════════════════════════════════════════════════════════════
--  OFFERS — Ofertat (uploaded PDF / email / document per client/house)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists offers (
  id           uuid primary key default gen_random_uuid(),
  client_name  text not null,
  house_id     uuid references houses(id) on delete set null,
  bucket       text not null default 'offers',
  file_path    text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  amount       numeric(14,2),
  status       offer_status not null default 'received',
  offer_date   date not null default current_date,
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_offers_house  on offers(house_id);
create index if not exists idx_offers_status on offers(status);
create index if not exists idx_offers_date   on offers(offer_date);
create index if not exists idx_offers_client_trgm on offers using gin (client_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════
--  PROFIT CALCULATOR — Kalkulator (savable scenarios)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists calc_projects (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  total_area_m2       numeric(14,2) not null default 0,
  landowner_share_pct numeric(5,2) not null default 30,  -- 30% land-owner cut
  notes               text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists calc_projects_set_updated_at on calc_projects;
create trigger calc_projects_set_updated_at before update on calc_projects
  for each row execute function set_updated_at();

create table if not exists calc_subareas (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references calc_projects(id) on delete cascade,
  label      text not null,
  area_m2    numeric(14,2) not null default 0,
  sort_order int not null default 0
);
create index if not exists idx_subareas_project on calc_subareas(project_id);

create table if not exists calc_scenarios (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references calc_projects(id) on delete cascade,
  label        text not null,                 -- e.g. "1.350 €/m²"
  price_per_m2 numeric(14,2) not null default 0,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_scenarios_project on calc_scenarios(project_id);

-- ════════════════════════════════════════════════════════════════════════
--  VIEW — house_financials: per-house paid / debt / overdue (efficient list)
-- ════════════════════════════════════════════════════════════════════════
create or replace view house_financials
with (security_invoker = true) as
select
  h.*,
  ht.name as type_name,
  coalesce(p.total_paid, 0)                              as total_paid,
  (h.sale_price - coalesce(p.total_paid, 0))            as debt,
  case
    when (h.sale_price - coalesce(p.total_paid, 0)) > 0
     and h.debt_deadline is not null
     and h.debt_deadline < current_date
    then true else false
  end                                                    as is_overdue
from houses h
join house_types ht on ht.id = h.type_id
left join (
  select house_id, sum(amount) as total_paid
  from transactions
  where kind = 'income' and house_id is not null
  group by house_id
) p on p.house_id = h.id;

-- ════════════════════════════════════════════════════════════════════════
--  RPC — dashboard summary (income/expense × bank/cash) for a date range
-- ════════════════════════════════════════════════════════════════════════
create or replace function get_dashboard_summary(p_start date default null, p_end date default null)
returns json language sql stable as $$
  select json_build_object(
    'income_bank',  coalesce(sum(amount) filter (where kind='income'  and method='bank'), 0),
    'income_cash',  coalesce(sum(amount) filter (where kind='income'  and method='cash'), 0),
    'expense_bank', coalesce(sum(amount) filter (where kind='expense' and method='bank'), 0),
    'expense_cash', coalesce(sum(amount) filter (where kind='expense' and method='cash'), 0),
    'tx_count',     count(*)
  )
  from transactions
  where (p_start is null or occurred_on >= p_start)
    and (p_end   is null or occurred_on <= p_end);
$$;

-- ════════════════════════════════════════════════════════════════════════
--  RPC — monthly cashflow series for the dashboard chart
-- ════════════════════════════════════════════════════════════════════════
create or replace function get_monthly_cashflow(p_months int default 12)
returns table(month date, income numeric, expense numeric)
language sql stable as $$
  select
    date_trunc('month', occurred_on)::date as month,
    coalesce(sum(amount) filter (where kind='income'),  0) as income,
    coalesce(sum(amount) filter (where kind='expense'), 0) as expense
  from transactions
  where occurred_on >= (date_trunc('month', current_date) - ((p_months - 1) || ' months')::interval)
  group by 1
  order by 1;
$$;

-- ════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY — internal team only (any authenticated user = full)
-- ════════════════════════════════════════════════════════════════════════
alter table profiles            enable row level security;
alter table house_types         enable row level security;
alter table houses              enable row level security;
alter table transactions        enable row level security;
alter table documents           enable row level security;
alter table reservations        enable row level security;
alter table reservation_houses  enable row level security;
alter table offers              enable row level security;
alter table calc_projects       enable row level security;
alter table calc_subareas       enable row level security;
alter table calc_scenarios      enable row level security;

-- Profiles: everyone authenticated can read; you can update your own row.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated using (true);
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- All business tables: any authenticated team member has full access.
do $$
declare t text;
begin
  foreach t in array array[
    'house_types','houses','transactions','documents','reservations',
    'reservation_houses','offers','calc_projects','calc_subareas','calc_scenarios'
  ] loop
    execute format('drop policy if exists %I_all on %I;', t, t);
    execute format(
      'create policy %I_all on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════
--  STORAGE — private buckets + authenticated-only access policies
-- ════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('documents','documents', false),
       ('floorplans','floorplans', false),
       ('offers','offers', false)
on conflict (id) do nothing;

drop policy if exists "zen_storage_read"   on storage.objects;
drop policy if exists "zen_storage_insert" on storage.objects;
drop policy if exists "zen_storage_update" on storage.objects;
drop policy if exists "zen_storage_delete" on storage.objects;

create policy "zen_storage_read" on storage.objects for select to authenticated
  using (bucket_id in ('documents','floorplans','offers'));
create policy "zen_storage_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('documents','floorplans','offers'));
create policy "zen_storage_update" on storage.objects for update to authenticated
  using (bucket_id in ('documents','floorplans','offers'));
create policy "zen_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id in ('documents','floorplans','offers'));

-- ════════════════════════════════════════════════════════════════════════
--  Done. Next: run supabase/seed.sql for sample data (optional).
-- ════════════════════════════════════════════════════════════════════════
