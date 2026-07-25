-- V3.39.47 — corrige a persistência/leitura da chave da Evolution nos chips.
-- Compatível com bases que guardavam a chave somente dentro de chips.data.

alter table public.chips
  add column if not exists api_key text;

update public.chips
set api_key = coalesce(
  nullif(api_key, ''),
  nullif(data ->> 'api_key', ''),
  nullif(data ->> 'apiKey', ''),
  nullif(data ->> 'apikey', '')
)
where coalesce(api_key, '') = ''
  and coalesce(
    nullif(data ->> 'api_key', ''),
    nullif(data ->> 'apiKey', ''),
    nullif(data ->> 'apikey', '')
  ) is not null;

update public.chips
set data = coalesce(data, '{}'::jsonb)
  || jsonb_build_object(
    'apiKey', api_key,
    'api_key', api_key
  )
where coalesce(api_key, '') <> '';
