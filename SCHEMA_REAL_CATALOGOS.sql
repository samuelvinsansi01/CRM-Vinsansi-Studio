-- Execute no SQL Editor e envie o resultado para confirmar os IDs sem assumir
-- ordem de cadastro. Somente leitura; nao altera o banco.
SELECT 'channels' AS catalogo,
       channels_id::text AS id,
       channels_name AS nome
FROM public.channels
UNION ALL
SELECT 'lead_status', lead_status_id::text, lead_status_name
FROM public.lead_status
UNION ALL
SELECT 'status', status_id::text, status_name
FROM public.status
UNION ALL
SELECT 'contact_sources', contact_sources_id::text,
       contact_sources_name || ' [' || contact_sources_key || ']'
FROM public.contact_sources
ORDER BY catalogo, id::bigint;
