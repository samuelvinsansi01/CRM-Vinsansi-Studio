-- PATCH V30: importação usando Supabase/sent_contacts como fonte de verdade
-- Rode depois do 02 e do 03, se ainda não tiver rodado.

alter table public.leads
add column if not exists normalized_phone text;

alter table public.leads
add column if not exists lead_type text;

alter table public.leads
add column if not exists has_own_site boolean default false;

-- Evita duplicidade ativa por telefone no cadastro de leads.
-- Se já houver duplicados, limpe/una antes de criar o índice.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_leads_user_normalized_phone_unique_v30'
  ) then
    create unique index idx_leads_user_normalized_phone_unique_v30
    on public.leads (user_id, normalized_phone)
    where normalized_phone is not null and normalized_phone <> '';
  end if;
end $$;

notify pgrst, 'reload schema';
