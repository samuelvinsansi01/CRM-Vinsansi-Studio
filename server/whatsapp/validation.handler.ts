// Shared server-side implementation for the validate and revalidate entrypoints.
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { organizationScopedAuthHeaders, resolveOrganizationContext } from '../organization/context.js';

export type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

declare const process: {
  env: Record<string, string | undefined>;
};

export type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
};

export type ValidationMode = 'initial' | 'revalidation';
export type ValidationOperation = 'validate' | 'revalidate';

export type ValidationLead = {
  id?: string;
  lead_id?: string;
  company?: string;
  phone?: string;
  normalized_phone?: string;
  chip_instance?: string;
};

export type ValidationResult = {
  leadId: string;
  lead_id?: string;
  status: 'valid' | 'invalid' | 'error';
  valid: boolean;
  errorMessage?: string;
  outcome?: 'approved' | 'revalidated' | 'instagram_review_required' | 'error';
  persisted?: boolean;
  proofValid?: boolean;
};

type AuthContext = {
  client: SupabaseClient;
  authUserId: string;
  publicUserId: string;
  organizationId: number;
};

type ValidationLeadRow = {
  leads_id: number | string;
  users_id?: number | string | null;
  leads_name?: string | null;
  leads_phone?: string | null;
  leads_whatsapp?: string | null;
  lead_status_id?: number | string | null;
  channels_id?: number | string | null;
};

function env(name: string) {
  return String(process.env[name] ?? '').trim();
}

function supabaseConfig() {
  return {
    url: env('SUPABASE_URL') || env('VITE_SUPABASE_URL'),
    anonKey:
      env('SUPABASE_ANON_KEY') ||
      env('SUPABASE_PUBLISHABLE_KEY') ||
      env('VITE_SUPABASE_PUBLISHABLE_KEY'),
  };
}

function serviceClient() {
  const config = supabaseConfig();
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para persistir a validação.');
  }
  return createClient(config.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function header(req: ApiRequest, name: string) {
  const target = name.toLowerCase();
  const headers = req.headers ?? {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function bearerToken(req: ApiRequest) {
  const authorization = header(req, 'authorization');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function phoneDigits(value: unknown) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function requestBodyRecord(body: unknown): { leads?: unknown; mode?: unknown; operation?: unknown } {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as { leads?: unknown; mode?: unknown; operation?: unknown };
    } catch {
      return {};
    }
  }
  return body && typeof body === 'object' ? body as { leads?: unknown; mode?: unknown; operation?: unknown } : {};
}

function operationForMode(mode: ValidationMode): ValidationOperation {
  return mode === 'revalidation' ? 'revalidate' : 'validate';
}

async function authenticate(req: ApiRequest): Promise<AuthContext> {
  const token = bearerToken(req);
  if (!token) throw new Error('Sessão ausente. Entre novamente no painel.');

  const config = supabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error('SUPABASE_URL e SUPABASE_ANON_KEY/PUBLISHABLE_KEY são obrigatórios no backend.');
  }

  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: organizationScopedAuthHeaders(token, req.headers) },
  });
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) throw new Error('Sessão inválida ou expirada.');

  const organization = await resolveOrganizationContext(client);
  const allowed = await client.rpc('has_organization_permission', { p_permission_key: 'leads.validate' });
  if (allowed.error || allowed.data !== true) throw new Error('Usuário interno não encontrado ou sem permissão.');

  return {
    client,
    authUserId: authData.user.id,
    publicUserId: String(organization.scopeUsersId),
    organizationId: organization.organizationId,
  };
}

function numericLeadIds(leads: ValidationLead[]) {
  const ids = leads.map((lead) => String(lead.id || lead.lead_id || '').trim());
  if (ids.some((id) => !/^\d+$/.test(id) || Number(id) <= 0)) throw new Error('Um ou mais IDs de lead são inválidos.');
  if (new Set(ids).size !== ids.length) throw new Error('A requisição contém IDs de lead duplicados.');
  return ids;
}

async function resolveOwnedLeads(
  auth: AuthContext,
  requested: ValidationLead[],
  mode: ValidationMode,
): Promise<ValidationLead[]> {
  const ids = numericLeadIds(requested);
  const expectedStatus = mode === 'initial' ? 3 : 2;
  const { data, error } = await auth.client
    .from('leads')
    .select('leads_id,users_id,leads_name,leads_phone,leads_whatsapp,lead_status_id,channels_id')
    .eq('users_id', auth.publicUserId)
    .in('leads_id', ids.map(Number));
  if (error) throw new Error(`Falha ao conferir os leads no banco: ${error.message}`);

  const channelResponse = await auth.client
    .from('channels')
    .select('channels_id,channels_name');
  if (channelResponse.error) throw new Error(`Falha ao carregar canais: ${channelResponse.error.message}`);
  const normalizeName = (value: unknown) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const whatsappChannel = ((channelResponse.data ?? []) as Array<{ channels_id?: unknown; channels_name?: unknown }>)
    .find((row) => normalizeName(row.channels_name).includes('whatsapp'));
  if (!whatsappChannel?.channels_id) throw new Error('Canal WhatsApp não encontrado na tabela channels.');
  const whatsappChannelId = Number(whatsappChannel.channels_id);

  const rows = new Map<string, ValidationLeadRow>(((data ?? []) as ValidationLeadRow[]).map((row) => [String(row.leads_id), row]));
  if (rows.size !== ids.length) throw new Error('Um ou mais leads não existem ou não pertencem ao usuário autenticado.');

  return requested.map((lead) => {
    const id = String(lead.id || lead.lead_id);
    const row = rows.get(id);
    if (!row) throw new Error(`Lead não encontrado: ${id}.`);
    if (Number(row.lead_status_id) !== expectedStatus || Number(row.channels_id) !== whatsappChannelId) {
      throw new Error(`Lead ${id} não está no status/canal permitido para esta operação.`);
    }
    const phone = phoneDigits(row.leads_whatsapp || row.leads_phone);
    const chipInstance = String(lead.chip_instance ?? '').trim();
    if (!phone) throw new Error(`Lead ${id} está sem telefone válido no banco.`);
    if (!chipInstance) throw new Error(`Lead ${id} está sem instância de chip.`);
    return {
      id,
      lead_id: id,
      company: String(row.leads_name ?? ''),
      phone,
      normalized_phone: phone,
      chip_instance: chipInstance,
    };
  });
}

const CONTROL_PLANE_TIMEOUT_MS = 50_000;
const CONTROL_PLANE_POLL_MS = 400;
const CONTROL_PLANE_STALE_CLAIM_MS = 20_000;

type ValidationRequestRow = {
  whatsapp_validation_requests_id: string;
  request_status: 'pending' | 'processing' | 'completed' | 'failed' | 'canceled';
  result_payload?: unknown;
  error_message?: string | null;
  consumed_at?: string | null;
  expires_at?: string | null;
  worker_id?: string | null;
  attempts?: number | null;
  claimed_at?: string | null;
  updated_at?: string | null;
};

function validationRequestKey(
  organizationId: number,
  leads: ValidationLead[],
  operation: ValidationOperation,
  mode: ValidationMode,
) {
  const canonical = leads
    .map((lead) => ({
      id: String(lead.id || lead.lead_id || ''),
      phone: phoneDigits(lead.normalized_phone || lead.phone),
      chip: String(lead.chip_instance || '').trim(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256')
    .update(JSON.stringify({ organizationId, operation, mode, leads: canonical }))
    .digest('hex');
}

async function getValidationRequest(client: SupabaseClient, organizationId: number, requestKey: string) {
  const response = await client
    .from('whatsapp_validation_requests')
    .select('whatsapp_validation_requests_id,request_status,result_payload,error_message,consumed_at,expires_at,worker_id,attempts,claimed_at,updated_at')
    .eq('organizations_id', organizationId)
    .eq('request_key', requestKey)
    .maybeSingle();
  if (response.error) throw new Error(`Falha ao consultar a validação persistente: ${response.error.message}`);
  return response.data as ValidationRequestRow | null;
}

async function enqueueValidationRequest(
  client: SupabaseClient,
  organizationId: number,
  publicUserId: string,
  leads: ValidationLead[],
  operation: ValidationOperation,
  mode: ValidationMode,
) {
  const requestKey = validationRequestKey(organizationId, leads, operation, mode);
  const existing = await getValidationRequest(client, organizationId, requestKey);
  const reusable = existing
    && ['pending', 'processing'].includes(existing.request_status)
    && (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now());
  if (reusable || (existing?.request_status === 'completed' && !existing.consumed_at)) {
    return { requestKey, requestId: existing!.whatsapp_validation_requests_id };
  }

  const values = {
    organizations_id: organizationId,
    users_id: Number(publicUserId),
    request_key: requestKey,
    operation,
    mode,
    leads_payload: leads,
    request_status: 'pending',
    worker_id: null,
    claim_token: null,
    attempts: 0,
    result_payload: null,
    error_message: null,
    requested_at: new Date().toISOString(),
    claimed_at: null,
    finished_at: null,
    consumed_at: null,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const response = await client
      .from('whatsapp_validation_requests')
      .update(values)
      .eq('organizations_id', organizationId)
      .eq('whatsapp_validation_requests_id', existing.whatsapp_validation_requests_id)
      .select('whatsapp_validation_requests_id')
      .single();
    if (response.error) throw new Error(`Falha ao reabrir a validação persistente: ${response.error.message}`);
    return { requestKey, requestId: String(response.data.whatsapp_validation_requests_id) };
  }

  const inserted = await client
    .from('whatsapp_validation_requests')
    .insert(values)
    .select('whatsapp_validation_requests_id')
    .single();
  if (inserted.error) {
    // Corrida rara entre duas chamadas idênticas: reutiliza a solicitação vencedora.
    const raced = await getValidationRequest(client, organizationId, requestKey);
    if (!raced) throw new Error(`Falha ao criar a validação persistente: ${inserted.error.message}`);
    return { requestKey, requestId: raced.whatsapp_validation_requests_id };
  }
  return { requestKey, requestId: String(inserted.data.whatsapp_validation_requests_id) };
}

async function recoverStaleValidationClaim(
  client: SupabaseClient,
  organizationId: number,
  requestId: string,
  row: ValidationRequestRow,
) {
  if (row.request_status !== 'processing' || !row.claimed_at) return false;
  const claimedAtMs = new Date(row.claimed_at).getTime();
  if (!Number.isFinite(claimedAtMs) || Date.now() - claimedAtMs < CONTROL_PLANE_STALE_CLAIM_MS) return false;

  const staleBefore = new Date(Date.now() - CONTROL_PLANE_STALE_CLAIM_MS).toISOString();
  const response = await client
    .from('whatsapp_validation_requests')
    .update({
      request_status: 'pending',
      worker_id: null,
      claim_token: null,
      claimed_at: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('organizations_id', organizationId)
    .eq('whatsapp_validation_requests_id', requestId)
    .eq('request_status', 'processing')
    .lte('claimed_at', staleBefore)
    .select('whatsapp_validation_requests_id')
    .maybeSingle();
  if (response.error) throw new Error(`Falha ao recuperar validação WhatsApp travada: ${response.error.message}`);
  return Boolean(response.data?.whatsapp_validation_requests_id);
}

function validationTimeoutMessage(row: ValidationRequestRow | null) {
  if (!row) return 'Solicitação de validação WhatsApp não encontrada ao encerrar a espera.';
  if (row.request_status === 'pending') {
    return `O Motor WhatsApp local não respondeu: não reclamou a solicitação dentro do prazo (status=pending, tentativas=${Number(row.attempts ?? 0)}). Reinicie/Repare o Worker se isso persistir.`;
  }
  if (row.request_status === 'processing') {
    const worker = String(row.worker_id || 'desconhecido');
    const claimed = row.claimed_at ? new Date(row.claimed_at).toISOString() : 'sem_horario';
    return `O Motor WhatsApp local não respondeu por completo: reclamou a solicitação, mas não concluiu dentro do prazo (worker=${worker}, tentativas=${Number(row.attempts ?? 0)}, claimed_at=${claimed}).`;
  }
  return `O Motor WhatsApp local não respondeu dentro do prazo (status=${row.request_status}, tentativas=${Number(row.attempts ?? 0)}).`;
}

async function waitForValidationRequest(
  client: SupabaseClient,
  organizationId: number,
  requestId: string,
): Promise<ValidationResult[]> {
  const deadline = Date.now() + CONTROL_PLANE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await client
      .from('whatsapp_validation_requests')
      .select('request_status,result_payload,error_message,worker_id,attempts,claimed_at,updated_at')
      .eq('organizations_id', organizationId)
      .eq('whatsapp_validation_requests_id', requestId)
      .maybeSingle();
    if (response.error) throw new Error(`Falha ao acompanhar o Motor WhatsApp: ${response.error.message}`);
    if (!response.data) throw new Error('Solicitação de validação WhatsApp não encontrada no control plane.');
    const row = response.data as ValidationRequestRow;
    if (await recoverStaleValidationClaim(client, organizationId, requestId, row)) {
      await new Promise((resolve) => setTimeout(resolve, CONTROL_PLANE_POLL_MS));
      continue;
    }
    if (row.request_status === 'failed') {
      throw new Error(String(row.error_message || 'O Motor WhatsApp não conseguiu validar os números.'));
    }
    if (row.request_status === 'canceled') throw new Error('A validação WhatsApp foi cancelada.');
    if (row.request_status === 'completed') {
      if (!Array.isArray(row.result_payload)) throw new Error('O Motor WhatsApp concluiu sem um resultado válido.');
      return row.result_payload as ValidationResult[];
    }
    await new Promise((resolve) => setTimeout(resolve, CONTROL_PLANE_POLL_MS));
  }
  const finalState = await client
    .from('whatsapp_validation_requests')
    .select('request_status,result_payload,error_message,worker_id,attempts,claimed_at,updated_at')
    .eq('organizations_id', organizationId)
    .eq('whatsapp_validation_requests_id', requestId)
    .maybeSingle();
  if (finalState.error) throw new Error(`Falha ao consultar o estado final da validação WhatsApp: ${finalState.error.message}`);
  throw new Error(validationTimeoutMessage(finalState.data as ValidationRequestRow | null));
}

export async function runStrictValidation(
  leads: ValidationLead[],
  operation: ValidationOperation,
  mode: ValidationMode,
  publicUserId: string,
  organizationId: number,
  controlPlaneClient: SupabaseClient,
): Promise<{ results: ValidationResult[]; requestId: string }> {
  const queued = await enqueueValidationRequest(controlPlaneClient, organizationId, publicUserId, leads, operation, mode);
  const results = await waitForValidationRequest(controlPlaneClient, organizationId, queued.requestId);
  const expectedIds = new Set(leads.map((lead) => String(lead.id || lead.lead_id)));
  const returnedIds = results.map((result) => String(result.leadId || result.lead_id || ''));
  if (
    results.length !== leads.length
    || new Set(returnedIds).size !== leads.length
    || returnedIds.some((id) => !expectedIds.has(id))
  ) {
    throw new Error('Motor WhatsApp retornou resultados sem correspondência exata dos leads solicitados.');
  }
  return { results, requestId: queued.requestId };
}

function persistedOutcome(result: ValidationResult) {
  if (result.status === 'valid' && result.valid === true) return 'valid';
  if (result.status === 'invalid' && result.valid === false) return 'invalid';
  return 'technical_error';
}

async function persistValidationResults(
  client: SupabaseClient,
  leads: ValidationLead[],
  results: ValidationResult[],
  mode: ValidationMode,
  publicUserId: string,
): Promise<ValidationResult[]> {
  const leadById = new Map(leads.map((lead) => [String(lead.id || lead.lead_id), lead]));
  const persisted: ValidationResult[] = [];

  for (const result of results) {
    const leadId = String(result.leadId || result.lead_id || '');
    const lead = leadById.get(leadId);
    if (!lead) throw new Error(`Resultado sem lead confiável correspondente: ${leadId}.`);
    const providerOutcome = persistedOutcome(result);
    let proofValid = false;

    // R36: a prova do telefone atual precisa existir ANTES de uma validação positiva
    // poder alterar o estado do lead. Assim não existe mais o estado impossível
    // “aprovado no provider, mas sem prova na fila”. Erro técnico não revoga uma
    // prova anterior; resultado inválido revoga explicitamente a prova atual.
    if (providerOutcome !== 'technical_error') {
      const proof = await client.rpc('record_current_whatsapp_validation_proof', {
        p_lead_id: Number(leadId),
        p_validated_phone: String(lead.normalized_phone || lead.phone || ''),
        p_provider: 'evolution',
        p_provider_reference: String(lead.chip_instance || ''),
        p_is_valid: providerOutcome === 'valid',
        p_metadata: {
          source: 'whatsapp_validation_api',
          worker_status: result.status,
          worker_valid: result.valid,
          mode,
        },
      });
      if (proof.error) throw new Error(`Falha ao registrar a prova WhatsApp do lead ${leadId}: ${proof.error.message}`);
      proofValid = proof.data === true;
      if (providerOutcome === 'valid' && !proofValid) {
        throw new Error(`A validação WhatsApp do lead ${leadId} foi confirmada pelo provider, mas a prova não corresponde ao telefone atual.`);
      }
    }

    const { data, error } = await client.rpc('record_whatsapp_validation_result', {
      p_users_id: Number(publicUserId),
      p_lead_id: Number(leadId),
      p_validated_phone: String(lead.normalized_phone || lead.phone || ''),
      p_mode: mode,
      p_outcome: providerOutcome,
      p_provider: 'evolution',
      p_provider_reference: String(lead.chip_instance || ''),
      p_http_status: 200,
      p_error_code: result.status === 'error' ? 'provider_result_error' : null,
      p_error_message: result.errorMessage ?? null,
      p_response_metadata: {
        source: 'whatsapp_validation_api',
        worker_status: result.status,
        worker_valid: result.valid,
      },
    });
    if (error) throw new Error(`Falha ao persistir a validação do lead ${leadId}: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.outcome) throw new Error(`A persistência do lead ${leadId} não retornou confirmação.`);
    persisted.push({
      ...result,
      leadId,
      outcome: row.outcome,
      persisted: true,
      proofValid: providerOutcome === 'valid' ? proofValid : false,
    });
  }
  return persisted;
}

export async function handleValidationRequest(req: ApiRequest, res: ApiResponse, expectedMode: ValidationMode) {
  const expectedOperation = operationForMode(expectedMode);
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const record = requestBodyRecord(req.body);
  const requested = Array.isArray(record.leads) ? record.leads as ValidationLead[] : [];
  const requestedMode = record.mode === 'revalidation' ? 'revalidation' : 'initial';
  const requestedOperation = String(record.operation ?? '').trim().toLowerCase();
  if (!requested.length) {
    res.status(400).json({ error: 'Nenhum lead recebido para validação.' });
    return;
  }
  if (requestedMode !== expectedMode || requestedOperation !== expectedOperation) {
    res.status(409).json({
      error: `Operação incompatível. Esta rota aceita somente ${expectedOperation}/${expectedMode}.`,
      expected: { operation: expectedOperation, mode: expectedMode },
    });
    return;
  }

  try {
    const auth = await authenticate(req);
    const leads = await resolveOwnedLeads(auth, requested, expectedMode);
    const controlPlaneClient = serviceClient();
    let providerResults: ValidationResult[];
    try {
      const controlPlane = await runStrictValidation(leads, expectedOperation, expectedMode, auth.publicUserId, auth.organizationId, controlPlaneClient);
      providerResults = controlPlane.results;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha técnica na validação WhatsApp.';
      const technicalResults = leads.map((lead) => ({
        leadId: String(lead.id || lead.lead_id),
        status: 'error' as const,
        valid: false,
        errorMessage: message,
      }));
      await persistValidationResults(auth.client, leads, technicalResults, expectedMode, auth.publicUserId);
      throw error;
    }
    const results = await persistValidationResults(auth.client, leads, providerResults, expectedMode, auth.publicUserId);
    const requestKey = validationRequestKey(auth.organizationId, leads, expectedOperation, expectedMode);
    await controlPlaneClient
      .from('whatsapp_validation_requests')
      .update({ consumed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('organizations_id', auth.organizationId)
      .eq('request_key', requestKey)
      .eq('request_status', 'completed');
    const summary = results.reduce((acc, result) => {
      acc[result.status] += 1;
      return acc;
    }, { valid: 0, invalid: 0, error: 0 });
    res.status(200).json({
      results,
      meta: {
        provider: 'control_plane_worker_evolution',
        simulated: false,
        operation: expectedOperation,
        mode: expectedMode,
        ...summary,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validação indisponível.';
    const unauthorized = /sessão|usuário interno/i.test(message);
    res.status(unauthorized ? 401 : 503).json({
      code: unauthorized ? 'unauthorized' : 'validation_unavailable',
      error: message,
      message,
      unchanged: true,
    });
  }
}
