-- V3.37 - Templates com 4 partes fixas e filas com 4 mensagens congeladas
-- Execute no Supabase antes de publicar o painel/Worker/extensão atualizados.

alter table public.templates
  add column if not exists part_3 text,
  add column if not exists part_4 text;

alter table public.whatsapp_queue_items
  add column if not exists message_3 text,
  add column if not exists message_4 text;

alter table public.instagram_queue_items
  add column if not exists message_3 text,
  add column if not exists message_4 text;

-- Backfill leve: preserva mensagens antigas em data/jsonb e deixa part_3/part_4 como texto vazio quando não existirem.
update public.templates
set
  part_3 = coalesce(part_3, data->>'message3', data->>'part_3', ''),
  part_4 = coalesce(part_4, data->>'message4', data->>'part_4', ''),
  data = jsonb_set(
    jsonb_set(coalesce(data, '{}'::jsonb), '{message3}', to_jsonb(coalesce(part_3, data->>'message3', data->>'part_3', ''))),
    '{message4}', to_jsonb(coalesce(part_4, data->>'message4', data->>'part_4', ''))
  )
where part_3 is null or part_4 is null or not (data ? 'message3') or not (data ? 'message4');

update public.whatsapp_queue_items
set
  message_3 = coalesce(message_3, data->>'message3', data->>'message_3', ''),
  message_4 = coalesce(message_4, data->>'message4', data->>'message_4', ''),
  data = jsonb_set(
    jsonb_set(coalesce(data, '{}'::jsonb), '{message3}', to_jsonb(coalesce(message_3, data->>'message3', data->>'message_3', ''))),
    '{message4}', to_jsonb(coalesce(message_4, data->>'message4', data->>'message_4', ''))
  )
where message_3 is null or message_4 is null or not (data ? 'message3') or not (data ? 'message4');

update public.instagram_queue_items
set
  message_3 = coalesce(message_3, data->>'message3', data->>'message_3', ''),
  message_4 = coalesce(message_4, data->>'message4', data->>'message_4', ''),
  data = jsonb_set(
    jsonb_set(coalesce(data, '{}'::jsonb), '{message3}', to_jsonb(coalesce(message_3, data->>'message3', data->>'message_3', ''))),
    '{message4}', to_jsonb(coalesce(message_4, data->>'message4', data->>'message_4', ''))
  )
where message_3 is null or message_4 is null or not (data ? 'message3') or not (data ? 'message4');
