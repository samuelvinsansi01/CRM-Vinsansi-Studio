-- V30 — limpeza segura de duplicados
-- Execute no Supabase SQL Editor.
-- Antes de deletar, cria backups das tabelas principais.

create table if not exists leads_backup_before_dedupe_v30 as
select * from leads;

create table if not exists whatsapp_messages_backup_before_dedupe_v30 as
select * from whatsapp_messages;

-- 1) Mapear duplicados de leads por usuário.
-- Prioridade de identidade:
-- maps_url > telefone+nome > website+nome > nome.
-- Mantém o registro mais completo/recente e remove os demais.
drop table if exists tmp_lead_dupes_v30;

create temp table tmp_lead_dupes_v30 as
with normalized as (
  select
    id,
    user_id,
    company_name,
    phone,
    website,
    maps_url,
    updated_at,
    case
      when nullif(trim(coalesce(maps_url, '')), '') is not null then
        'maps:' || lower(regexp_replace(trim(coalesce(maps_url, '')), '/+$', ''))
      when nullif(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), '') is not null
        and nullif(trim(coalesce(company_name, '')), '') is not null then
        'phone-name:' || regexp_replace(coalesce(phone, ''), '\\D', '', 'g') || ':' || lower(trim(coalesce(company_name, '')))
      when nullif(trim(coalesce(website, '')), '') is not null
        and nullif(trim(coalesce(company_name, '')), '') is not null then
        'site-name:' || lower(regexp_replace(trim(coalesce(website, '')), '/+$', '')) || ':' || lower(trim(coalesce(company_name, '')))
      when nullif(trim(coalesce(company_name, '')), '') is not null then
        'name:' || lower(trim(coalesce(company_name, '')))
      else
        'id:' || id
    end as identity_key,
    case when crm_data is not null then 1 else 0 end as has_crm_data,
    case when nullif(trim(coalesce(phone, '')), '') is not null then 1 else 0 end as has_phone,
    case when nullif(trim(coalesce(website, '')), '') is not null then 1 else 0 end as has_website,
    case when nullif(trim(coalesce(maps_url, '')), '') is not null then 1 else 0 end as has_maps
  from leads
), ranked as (
  select
    *,
    first_value(id) over (
      partition by user_id, identity_key
      order by has_crm_data desc, has_maps desc, has_phone desc, has_website desc, updated_at desc nulls last, id asc
    ) as keep_id,
    row_number() over (
      partition by user_id, identity_key
      order by has_crm_data desc, has_maps desc, has_phone desc, has_website desc, updated_at desc nulls last, id asc
    ) as rn
  from normalized
  where identity_key is not null and identity_key <> ''
)
select
  user_id,
  identity_key,
  keep_id,
  id as duplicate_id
from ranked
where rn > 1;

-- Conferência antes de aplicar efeitos.
select * from tmp_lead_dupes_v30 order by user_id, identity_key;

-- 2) Reapontar tabelas filhas para o lead mantido.
update lead_notes n
set lead_id = d.keep_id
from tmp_lead_dupes_v30 d
where n.user_id = d.user_id
  and n.lead_id = d.duplicate_id;

update lead_history h
set lead_id = d.keep_id
from tmp_lead_dupes_v30 d
where h.user_id = d.user_id
  and h.lead_id = d.duplicate_id;

update lead_followups f
set lead_id = d.keep_id
from tmp_lead_dupes_v30 d
where f.user_id = d.user_id
  and f.lead_id = d.duplicate_id;

update whatsapp_messages m
set lead_id = d.keep_id
from tmp_lead_dupes_v30 d
where m.user_id = d.user_id
  and m.lead_id = d.duplicate_id;

update whatsapp_contact_map cm
set lead_id = d.keep_id,
    updated_at = now()
from tmp_lead_dupes_v30 d
where cm.user_id = d.user_id
  and cm.lead_id = d.duplicate_id;

-- 3) Remover apenas os registros duplicados de leads.
delete from leads l
using tmp_lead_dupes_v30 d
where l.user_id = d.user_id
  and l.id = d.duplicate_id;

-- 4) Limpar duplicidade de histórico de mensagens somente quando external_id for exatamente igual.
-- Isso NÃO apaga mensagens diferentes; só remove cópias idênticas de persistência.
with ranked_messages as (
  select
    id,
    row_number() over (
      partition by user_id, external_id
      order by created_at asc nulls last, occurred_at asc nulls last, id asc
    ) as rn
  from whatsapp_messages
  where external_id is not null
    and trim(external_id) <> ''
)
delete from whatsapp_messages wm
using ranked_messages rm
where wm.id = rm.id
  and rm.rn > 1;

-- 5) Índice preventivo para não duplicar histórico de mensagem com mesmo external_id.
create unique index if not exists ux_whatsapp_messages_user_external_id_v30
on whatsapp_messages (user_id, external_id)
where external_id is not null and trim(external_id) <> '';

-- 6) Relatório final.
select
  'leads_restantes' as metric,
  count(*) as total
from leads
union all
select
  'duplicados_removidos',
  count(*)
from tmp_lead_dupes_v30;
