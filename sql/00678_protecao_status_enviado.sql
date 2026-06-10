-- 6.78 - Marcar como enviados os leads que estão em Proteção / Já Enviados
-- Rode no Supabase SQL Editor se quiser corrigir também o status salvo no banco.

update public.leads l
set
  current_status = 'sent',
  current_stage = coalesce(nullif(current_stage, ''), 'protection'),
  updated_at = now()
where exists (
  select 1
  from public.lead_blocks lb
  where lb.lead_id = l.id
    and lb.active = true
    and lb.block_type = 'already_sent'
);

-- Ajuste opcional para a RPC manual: novos registros de proteção já entram como enviados.
create or replace function public.rpc_lead_block_upsert(
  p_user_id uuid,
  p_entry jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_lead_id uuid;
  v_phone text;
  v_company text;
  v_block_type text;
begin
  v_phone := regexp_replace(
    coalesce(
      p_entry->>'normalized_phone',
      p_entry->>'phone_normalized',
      p_entry->>'phone',
      ''
    ),
    '\D',
    '',
    'g'
  );

  v_company := nullif(coalesce(
    p_entry->>'company_name',
    p_entry->>'company',
    p_entry->>'contact_name',
    'Contato protegido'
  ), '');

  v_block_type := coalesce(
    p_entry->>'block_type',
    p_entry->>'list_type',
    'already_sent'
  );

  insert into public.leads (
    user_id,
    company_name,
    phone,
    normalized_phone,
    current_stage,
    current_status,
    archived_at,
    removed_at,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    v_company,
    nullif(v_phone, ''),
    nullif(v_phone, ''),
    'protection',
    case when v_block_type = 'already_sent' then 'sent' else 'blocked' end,
    now(),
    now(),
    now(),
    now()
  )
  returning id into v_lead_id;

  insert into public.lead_blocks (
    user_id,
    lead_id,
    block_type,
    reason,
    active,
    created_at
  )
  values (
    p_user_id,
    v_lead_id,
    v_block_type,
    coalesce(nullif(p_entry->>'reason', ''), 'manual'),
    true,
    now()
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'lead_id', v_lead_id,
    'phone', v_phone,
    'block_type', v_block_type
  );
end;
$$;

grant execute on function public.rpc_lead_block_upsert(uuid, jsonb) to authenticated;
grant execute on function public.rpc_lead_block_upsert(uuid, jsonb) to anon;
