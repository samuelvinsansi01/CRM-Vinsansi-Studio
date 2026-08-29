-- CHECK - CRM R55 - Limpeza e contrato da puxada
-- Somente leitura. Rode depois de aplicar a migration R55.

WITH checks AS (
  SELECT
    to_regprocedure('public.pull_queue_review_to_capacity(text,text,date)') IS NOT NULL
      AS rpc_unica_puxar_ok,
    to_regprocedure('public.list_queue_review_resources(text,date)') IS NOT NULL
      AS rpc_recursos_ok,
    to_regprocedure('public.reconcile_queue_review_whatsapp_validation(bigint,bigint[],bigint[])') IS NOT NULL
      AS rpc_reconciliacao_ok,
    to_regprocedure('public.list_queue_review_for_resource(text,text,date)') IS NOT NULL
      AS rpc_revisao_ok,
    to_regprocedure('public.queue_review_resource_capacity(text,bigint,date)') IS NOT NULL
      AS helper_capacidade_ok,

    to_regprocedure('public.open_queue_review_batch_by_key(text,text,date)') IS NULL
      AS antiga_open_by_key_removida,
    to_regprocedure('public.reserve_next_queue_review_items(bigint,integer)') IS NULL
      AS antiga_reserva_r54_removida,
    to_regprocedure('public.reserve_next_queue_review_items(bigint)') IS NULL
      AS overload_reserva_removido,
    to_regprocedure('public.queue_review_candidate_ids(bigint,integer)') IS NULL
      AS antiga_candidatos_removida,
    to_regprocedure('public.reserve_queue_review_items(bigint,bigint[])') IS NULL
      AS antiga_reserva_removida,
    to_regprocedure('public.open_queue_review_batch(text,bigint,date)') IS NULL
      AS antiga_open_removida,
    to_regprocedure('public.release_queue_review_items(bigint,bigint[])') IS NULL
      AS antiga_release_removida,
    to_regprocedure('public.restore_queue_review_whatsapp_valid(bigint,bigint[])') IS NULL
      AS antiga_restore_removida,
    to_regprocedure('public.prune_queue_review_items(bigint)') IS NULL
      AS antiga_prune_removida,
    to_regprocedure('public.list_open_queue_review(text)') IS NULL
      AS antiga_list_removida,
    to_regprocedure('public.lock_queue_review_batch(bigint,jsonb)') IS NULL
      AS antiga_lock_removida,

    NOT has_function_privilege(
      'authenticated',
      'public.queue_review_resource_capacity(text,bigint,date)',
      'EXECUTE'
    ) AS helper_nao_exposto_ao_frontend,
    has_function_privilege(
      'authenticated',
      'public.pull_queue_review_to_capacity(text,text,date)',
      'EXECUTE'
    ) AS pull_exposto_ao_frontend,

    to_regclass('public.leads_queue_pull_whatsapp_priority_idx') IS NOT NULL
      AS indice_prioridade_whatsapp_ok,
    to_regclass('public.leads_queue_pull_instagram_priority_idx') IS NOT NULL
      AS indice_prioridade_instagram_ok,
    to_regclass('public.queue_items_whatsapp_scheduled_capacity_idx') IS NOT NULL
      AS indice_capacidade_whatsapp_moderno_ok,
    to_regclass('public.queue_items_instagram_scheduled_capacity_idx') IS NOT NULL
      AS indice_capacidade_instagram_moderno_ok,
    to_regclass('public.queue_items_whatsapp_legacy_capacity_idx') IS NOT NULL
      AS indice_capacidade_whatsapp_legado_ok,
    to_regclass('public.queue_items_instagram_legacy_capacity_idx') IS NOT NULL
      AS indice_capacidade_instagram_legado_ok,
    to_regclass('public.queue_items_legacy_schedule_capacity_idx') IS NULL
      AS indice_generico_legado_removido
)
SELECT *,
  (
    rpc_unica_puxar_ok
    AND rpc_recursos_ok
    AND rpc_reconciliacao_ok
    AND rpc_revisao_ok
    AND helper_capacidade_ok
    AND antiga_open_by_key_removida
    AND antiga_reserva_r54_removida
    AND overload_reserva_removido
    AND antiga_candidatos_removida
    AND antiga_reserva_removida
    AND antiga_open_removida
    AND antiga_release_removida
    AND antiga_restore_removida
    AND antiga_prune_removida
    AND antiga_list_removida
    AND antiga_lock_removida
    AND helper_nao_exposto_ao_frontend
    AND pull_exposto_ao_frontend
    AND indice_prioridade_whatsapp_ok
    AND indice_prioridade_instagram_ok
    AND indice_capacidade_whatsapp_moderno_ok
    AND indice_capacidade_instagram_moderno_ok
    AND indice_capacidade_whatsapp_legado_ok
    AND indice_capacidade_instagram_legado_ok
    AND indice_generico_legado_removido
  ) AS r55_limpa_e_ativa
FROM checks;
