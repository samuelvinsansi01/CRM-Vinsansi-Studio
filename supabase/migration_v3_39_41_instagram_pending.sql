begin;

-- Todo lead destinado ao Instagram que ainda esteja aprovado volta para
-- Em aguarde. Não altera enviados, arquivados ou invalidados.
update public.leads
set
  status = 'pending',
  destino = 'Instagram',
  destination = 'Instagram',
  destination_override = 'Instagram',
  send_instagram = true,
  updated_at = now(),
  data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'status', 'pending',
    'destino', 'Instagram',
    'destination', 'Instagram',
    'destination_override', 'Instagram',
    'send_instagram', true
  )
where lower(trim(coalesce(status, ''))) in ('approved', 'aprovado')
  and (
    coalesce(send_instagram, false) = true
    or lower(trim(coalesce(destination, ''))) = 'instagram'
    or lower(trim(coalesce(destino, ''))) = 'instagram'
    or lower(trim(coalesce(destination_override, ''))) = 'instagram'
    or lower(trim(coalesce(data->>'destination', ''))) = 'instagram'
    or lower(trim(coalesce(data->>'destino', ''))) = 'instagram'
    or lower(trim(coalesce(data->>'destination_override', ''))) = 'instagram'
    or coalesce((data->>'send_instagram')::boolean, false) = true
  );

-- Retornos de WhatsApp inválido permanecem em revisão no Pré-Envio Instagram,
-- sem aprovação ou entrada automática na fila.
update public.pre_send_leads
set
  status = 'review',
  channel = 'Instagram',
  destination = 'Instagram',
  destination_override = 'Instagram',
  send_instagram = true,
  updated_at = now(),
  data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'status', 'review',
    'channel', 'Instagram',
    'destination', 'Instagram',
    'destination_override', 'Instagram',
    'send_instagram', true,
    'queueWaitReason', 'Em aguarde para aprovação manual.'
  )
where lower(trim(coalesce(validation_status, data->>'validationStatus', ''))) = 'invalid'
  and lower(trim(coalesce(instagram_override_reason, data->>'instagram_override_reason', ''))) = 'whatsapp_invalid';

commit;
