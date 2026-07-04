-- Lead Certo V2 - limpeza segura de lead_id invalido na fila Instagram.
-- Objetivo: remover referencias antigas que apontam para pre_send_leads em vez de leads.
-- Seguro para rodar no SQL Editor: nao apaga filas nem leads.

do $$
begin
  if to_regclass('public.instagram_dispatch_items') is null or to_regclass('public.leads') is null then
    return;
  end if;

  update public.instagram_dispatch_items i
  set
    lead_id = null,
    data = jsonb_set(coalesce(i.data, '{}'::jsonb), '{lead_id}', 'null'::jsonb, true),
    updated_at = now()
  where i.lead_id is not null
    and not exists (
      select 1
      from public.leads l
      where l.id = i.lead_id
    );
end $$;
