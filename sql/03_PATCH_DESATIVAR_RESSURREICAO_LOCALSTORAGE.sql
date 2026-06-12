-- V30: remove do operational_data os blocos que continham leads/filas antigas.
-- Isso impede que o navegador ou a nuvem restaurem leads apagados da tabela public.leads.
update public.operational_data
set payload = jsonb_set(
  payload,
  '{data}',
  coalesce(payload->'data', '{}'::jsonb)
    - 'leadCrm'
    - 'permanentLeads'
    - 'weeklyLeads'
    - 'weeklyHistory'
    - 'monthlyTracking'
    - 'validationQueue'
    - 'assignmentQueue'
    - 'instagramQueue'
    - 'instagramWeek'
    - 'instagramSchedule'
    - 'whatsappBacklog'
    - 'whatsappDispatchQueues'
    - 'whatsappQueue'
    - 'dispatchLogs'
    - 'dispatchRuntime'
    - 'evolutionResponses'
    - 'whatsappOutbox'
    - 'chipUsage'
    - 'queueControl',
  true
),
updated_at = now()
where scope = 'crm_operational_v36';

notify pgrst, 'reload schema';
