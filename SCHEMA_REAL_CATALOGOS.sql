SELECT
  catalogo,
  id,
  nome
FROM (
  SELECT 'channels'::text AS catalogo, channels_id::bigint AS id, channels_name::text AS nome
  FROM public.channels
  UNION ALL
  SELECT 'lead_status'::text, lead_status_id::bigint, lead_status_name::text
  FROM public.lead_status
  UNION ALL
  SELECT 'status'::text, status_id::bigint, status_name::text
  FROM public.status
  UNION ALL
  SELECT 'contact_sources'::text, contact_sources_id::bigint,
    (contact_sources_name || ' [' || contact_sources_key || ']')::text
  FROM public.contact_sources
) AS catalogos
ORDER BY catalogo, id;
