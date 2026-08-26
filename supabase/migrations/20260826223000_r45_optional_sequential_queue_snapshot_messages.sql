-- CRM - Vinsansi Studio v2.4.0-R45
-- Corrige o contrato do snapshot de queue_items: somente message_1 e obrigatoria.
-- message_2..4 sao opcionais, desde que nao existam lacunas na sequencia.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_queue_item_payload_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_message_1 text;
  v_message_2 text;
  v_message_3 text;
  v_message_4 text;
  v_allow_refresh boolean:=coalesce(current_setting('vinsansi.allow_queue_snapshot_refresh',true),'')='on';
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.leads_id IS DISTINCT FROM OLD.leads_id
       OR NEW.templates_id IS DISTINCT FROM OLD.templates_id
       OR NEW.queues_id IS DISTINCT FROM OLD.queues_id THEN
      RAISE EXCEPTION 'Lead, template e fila de um item preparado são imutáveis. Crie um novo item.' USING ERRCODE='23514';
    END IF;

    IF (
      NEW.queue_items_payload_snapshot IS DISTINCT FROM OLD.queue_items_payload_snapshot
      OR NEW.queue_items_payload_hash IS DISTINCT FROM OLD.queue_items_payload_hash
      OR NEW.queue_items_payload_created_at IS DISTINCT FROM OLD.queue_items_payload_created_at
    ) AND NOT v_allow_refresh THEN
      RAISE EXCEPTION 'O conteúdo congelado do item não pode ser alterado.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.templates_id IS NULL THEN
    RAISE EXCEPTION 'Todo item de fila precisa de um template para congelar o conteúdo.' USING ERRCODE='23514';
  END IF;

  NEW.queue_items_payload_created_at:=coalesce(NEW.queue_items_created_at,now());
  NEW.queue_items_payload_snapshot:=public.build_queue_item_payload_snapshot(
    NEW.users_id,
    NEW.queues_id,
    NEW.leads_id,
    NEW.templates_id,
    NEW.queue_items_payload_created_at
  );

  v_message_1:=trim(coalesce(NEW.queue_items_payload_snapshot#>>'{messages,message_1}',''));
  v_message_2:=trim(coalesce(NEW.queue_items_payload_snapshot#>>'{messages,message_2}',''));
  v_message_3:=trim(coalesce(NEW.queue_items_payload_snapshot#>>'{messages,message_3}',''));
  v_message_4:=trim(coalesce(NEW.queue_items_payload_snapshot#>>'{messages,message_4}',''));

  -- Contrato canonico: a primeira mensagem existe sempre. As demais podem ser
  -- omitidas, mas uma mensagem posterior nunca pode existir depois de uma lacuna.
  IF v_message_1='' THEN
    RAISE EXCEPTION 'O snapshot precisa conter a primeira mensagem.' USING ERRCODE='23514';
  END IF;
  IF v_message_2='' AND (v_message_3<>'' OR v_message_4<>'') THEN
    RAISE EXCEPTION 'As mensagens do snapshot precisam ser sequenciais: message_2 está vazia.' USING ERRCODE='23514';
  END IF;
  IF v_message_3='' AND v_message_4<>'' THEN
    RAISE EXCEPTION 'As mensagens do snapshot precisam ser sequenciais: message_3 está vazia.' USING ERRCODE='23514';
  END IF;

  NEW.queue_items_payload_hash:=encode(
    extensions.digest(convert_to(NEW.queue_items_payload_snapshot::text,'UTF8'),'sha256'),
    'hex'
  );
  RETURN NEW;
END;
$function$;

-- Verificacao defensiva: a funcao instalada nao pode voltar a exigir 4/4.
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.apply_queue_item_payload_snapshot()'::regprocedure) INTO v_def;
  IF v_def !~ 'v_message_1' OR v_def !~ 'message_2.*v_message_3' THEN
    RAISE EXCEPTION 'r45_optional_sequential_snapshot_contract_not_installed';
  END IF;
  IF v_def ~ 'FOR[[:space:]]+v_message_number[[:space:]]+IN[[:space:]]+1\.\.4' THEN
    RAISE EXCEPTION 'r45_legacy_four_messages_requirement_still_present';
  END IF;
END
$verify$;

COMMIT;
