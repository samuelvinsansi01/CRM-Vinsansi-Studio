BEGIN;

-- R13 — Etapa 9: template Instagram com 1..4 mensagens.
-- Não há alteração de schema. Este patch apenas promove a versão oficial do executor.
UPDATE public.platform_tools
SET latest_version = '2.0.2',
    minimum_supported_version = '2.0.0',
    updated_at = now()
WHERE tool_id = 'vinsansi_instagram';

UPDATE public.platform_release_channels
SET latest_version = '2.0.2',
    minimum_supported_version = '2.0.0',
    update_required = true,
    updated_at = now()
WHERE component_key = 'instagram';

COMMIT;
