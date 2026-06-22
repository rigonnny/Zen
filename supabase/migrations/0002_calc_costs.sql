-- Construction / infrastructure cost line items per calculator project (€/m²)
create table if not exists calc_costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references calc_projects(id) on delete cascade,
  label       text not null,
  cost_per_m2 numeric(14,2) not null default 0,
  sort_order  int not null default 0
);
create index if not exists idx_costs_project on calc_costs(project_id);

alter table calc_costs enable row level security;
drop policy if exists calc_costs_all on calc_costs;
create policy calc_costs_all on calc_costs for all to authenticated
  using (true) with check (true);
