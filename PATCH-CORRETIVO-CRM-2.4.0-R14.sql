-- R14 — contrato global de templates: 1..4 mensagens em sequência.
-- Sem alteração de schema. Atualiza apenas a matriz oficial de artefatos.
UPDATE public.platform_tools
SET latest_version='2.0.2', updated_at=now()
WHERE tool_id='vinsansi_instagram';

UPDATE public.platform_release_channels
SET latest_version=CASE component_key
  WHEN 'manager' THEN '1.3.1'
  WHEN 'worker' THEN '3.13.1'
  WHEN 'instagram' THEN '2.0.2'
  ELSE latest_version END,
  updated_at=now()
WHERE component_key IN ('manager','worker','instagram');
