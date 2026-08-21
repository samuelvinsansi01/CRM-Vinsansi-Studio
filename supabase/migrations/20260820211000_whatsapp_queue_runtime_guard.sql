BEGIN;

-- A instância administrativa pode permanecer ativa durante quedas transitórias
-- do socket. Para preparar novos itens WhatsApp, porém, exigimos uma sessão
-- persistida conhecida. Isso evita alocar leads para uma instância nunca pareada
-- sem voltar ao comportamento antigo de desativar o recurso quando o socket cai.
DO $queue_runtime_guard$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.prepare_queue_items_without_whatsapp_validation_proof(text,bigint,date,jsonb)'
  );
  v_definition text;
  v_admin_guard constant text := 'AND i.status_id = v_active_status_id';
  v_runtime_guard constant text := $guard$AND i.status_id = v_active_status_id
      AND EXISTS (
        SELECT 1
        FROM public.instance_runtime_states AS runtime
        WHERE runtime.instances_id = i.instances_id
          AND runtime.users_id = c.users_id
          AND runtime.session_saved = true
      )$guard$;
  v_occurrences integer;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'instance_runtime_queue_guard_missing_function:prepare_queue_items_without_whatsapp_validation_proof';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_function);

  IF pg_catalog.strpos(v_definition, 'FROM public.instance_runtime_states AS runtime') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_admin_guard, ''))
  ) / pg_catalog.length(v_admin_guard);

  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'instance_runtime_queue_guard_divergent_function:prepare_queue_items_without_whatsapp_validation_proof:%', v_occurrences;
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_admin_guard, v_runtime_guard);
  EXECUTE v_definition;
END;
$queue_runtime_guard$;

REVOKE ALL ON FUNCTION public.prepare_queue_items_without_whatsapp_validation_proof(text, bigint, date, jsonb)
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.prepare_queue_items(text, bigint, date, jsonb)
IS 'Reserva fila atomicamente; WhatsApp exige prova atual de validacao do lead e uma sessao persistida conhecida na instancia do chip. Queda transitória do socket nao desativa o recurso.';

COMMIT;
