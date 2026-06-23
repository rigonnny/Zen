-- Allow a document (floor plan) to belong to a house TYPE instead of a single house.
alter table documents alter column house_id drop not null;
alter table documents add column if not exists type_id uuid references house_types(id) on delete cascade;
create index if not exists idx_docs_type on documents(type_id);

do $$ begin
  alter table documents
    add constraint documents_owner_chk check (house_id is not null or type_id is not null);
exception when duplicate_object then null; end $$;
