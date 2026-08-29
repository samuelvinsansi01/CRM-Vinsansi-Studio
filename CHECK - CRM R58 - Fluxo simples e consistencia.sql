-- CRM - Vinsansi Studio v2.4.0-R58
-- CHECK pós-migration: somente leitura.

-- 1) Catálogo esperado.
SELECT lead_status_id, lead_status_name
FROM public.lead_status
WHERE lead_status_id BETWEEN 1 AND 8
ORDER BY lead_status_id;

SELECT channels_id, channels_name
FROM public.channels
ORDER BY channels_id;

-- 2) Distribuição operacional por status/canal.
SELECT
  ls.lead_status_id,
  ls.lead_status_name,
  COALESCE(c.channels_name, 'SEM CANAL') AS canal,
  COUNT(*) AS total
FROM public.leads l
JOIN public.lead_status ls ON ls.lead_status_id=l.lead_status_id
LEFT JOIN public.channels c ON c.channels_id=l.channels_id
GROUP BY ls.lead_status_id,ls.lead_status_name,COALESCE(c.channels_name,'SEM CANAL')
ORDER BY ls.lead_status_id,canal;

-- 3) Importado precisa estar em WhatsApp, Instagram ou Sem destino.
SELECT COUNT(*) AS importados_com_destino_invalido
FROM public.leads l
LEFT JOIN public.channels c ON c.channels_id=l.channels_id
WHERE l.lead_status_id=1
  AND regexp_replace(lower(public.unaccent(trim(coalesce(c.channels_name,'')))), '[^a-z0-9]+', '', 'g')
      NOT IN ('whatsapp','instagram','semdestino');

-- 4) Revisão aberta precisa corresponder ao lead em Revisão + mesmo canal.
SELECT COUNT(*) AS revisoes_abertas_inconsistentes
FROM public.queue_review_items i
JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
JOIN public.leads l ON l.leads_id=i.leads_id
WHERE i.review_status='open'
  AND (l.lead_status_id<>2 OR l.channels_id IS DISTINCT FROM b.channels_id);

-- 5) Lead Na fila precisa ter queue_item real.
SELECT COUNT(*) AS na_fila_sem_queue_item
FROM public.leads l
WHERE l.lead_status_id=4
  AND NOT EXISTS(
    SELECT 1 FROM public.queue_items qi WHERE qi.leads_id=l.leads_id
  );

-- 6) Status finais que formam a Base Permanente.
SELECT
  COUNT(*) FILTER (WHERE lead_status_id=3) AS sem_contato,
  COUNT(*) FILTER (WHERE lead_status_id=5) AS enviados,
  COUNT(*) FILTER (WHERE lead_status_id=6) AS invalidos,
  COUNT(*) FILTER (WHERE lead_status_id=7) AS duplicados
FROM public.leads;

-- 7) O runtime novo não exige que enviados legados tenham canal.
-- Apenas informa quantos históricos permanecem sem evidência de canal.
SELECT COUNT(*) AS enviados_legados_sem_canal
FROM public.leads
WHERE lead_status_id=5 AND channels_id IS NULL;
