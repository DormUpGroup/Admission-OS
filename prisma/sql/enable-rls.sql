-- Defense in depth for public tables. The app uses Prisma with the
-- postgres role (bypasses RLS). anon/authenticated have no policies, so
-- the Data API cannot read rows even if a table is later exposed.
do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not in ('spatial_ref_sys')
  loop
    execute format('alter table public.%I enable row level security', r.table_name);
  end loop;
end $$;
