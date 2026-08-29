// Shared server-side implementation for WhatsApp validation.
// R59: validation is synchronous and direct: CRM -> Vinsansi WhatsApp Gateway -> Evolution Go.
// No validation request/proof tables are used. Only the canonical lead/review state is persisted.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { organizationScopedAuthHeaders, resolveOrganizationContext } from '../organization/context.js';

export type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

declare const process: { env: Record<string, string | undefined> };

export type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
};


export type ValidationLead = {
  id?: string;
  lead_id?: string;
  review_item_id?: string;
  company?: string;
  phone?: string;
  normalized_phone?: string;
  chip_instance?: string;
  instagram?: string;
};

export type ValidationResult = {
  leadId: string;
  lead_id?: string;
  status: 'valid' | 'invalid' | 'error';
  valid: boolean;
  errorMessage?: string;
  outcome?: 'approved' | 'instagram_review_required' | 'no_contact' | 'error';
  persisted?: boolean;
};

type AuthContext = {
  client: SupabaseClient;
  admin: SupabaseClient;
  publicUserId: number;
  organizationId: number;
};

type ValidationLeadRow = {
  leads_id: number | string;
  users_id?: number | string | null;
  leads_name?: string | null;
  leads_phone?: string | null;
  leads_whatsapp?: string | null;
  leads_instagram?: string | null;
  lead_status_id?: number | string | null;
  channels_id?: number | string | null;
};

type OwnedValidationLead = ValidationLead & {
  id: string;
  lead_id: string;
  review_item_id: string;
  company: string;
  phone: string;
  normalized_phone: string;
  chip_instance: string;
  instagram: string;
};

type ChannelIds = { whatsapp: number; instagram: number; semDestino: number };
type EvolutionInstance = { instances_id?: unknown; instances_name?: unknown; instances_url?: unknown; api_key?: unknown };
type GatewayCheckItem = {
  number?: unknown;
  exists?: unknown;
  isWhatsapp?: unknown;
  valid?: unknown;
  jid?: unknown;
  matched?: unknown;
  confirmed?: unknown;
};

function env(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function supabaseConfig() {
  return {
    url: env('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    anonKey: env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

function serviceClient() {
  const config = supabaseConfig();
  if (!config.url || !config.serviceRoleKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para validar WhatsApp.');
  }
  return createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function header(req: ApiRequest, name: string) {
  const target = name.toLowerCase();
  const headers = req.headers ?? {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function bearerToken(req: ApiRequest) {
  return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
}

function phoneDigits(value: unknown) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function boolLike(value: unknown) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  return undefined;
}

function requestBodyRecord(body: unknown): { leads?: unknown; mode?: unknown; operation?: unknown } {
  if (typeof body === 'string') {
    try { return JSON.parse(body) as { leads?: unknown; mode?: unknown; operation?: unknown }; }
    catch { return {}; }
  }
  return body && typeof body === 'object' ? body as { leads?: unknown; mode?: unknown; operation?: unknown } : {};
}

async function authenticate(req: ApiRequest): Promise<AuthContext> {
  const token = bearerToken(req);
  if (!token) throw new Error('Sessão ausente. Entre novamente no painel.');
  const config = supabaseConfig();
  if (!config.url || !config.anonKey) throw new Error('Configuração Supabase incompleta no backend.');
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: organizationScopedAuthHeaders(token, req.headers) },
  });
  const auth = await client.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error('Sessão inválida ou expirada.');
  const organization = await resolveOrganizationContext(client);
  const allowed = await client.rpc('has_organization_permission', { p_permission_key: 'leads.validate' });
  if (allowed.error || allowed.data !== true) throw new Error('Usuário interno não encontrado ou sem permissão.');
  return {
    client,
    admin: serviceClient(),
    publicUserId: Number(organization.scopeUsersId),
    organizationId: Number(organization.organizationId),
  };
}

function numericLeadIds(leads: ValidationLead[]) {
  const ids = leads.map((lead) => String(lead.id || lead.lead_id || '').trim());
  if (!ids.length || ids.some((id) => !/^\d+$/.test(id) || Number(id) <= 0)) throw new Error('Um ou mais IDs de lead são inválidos.');
  if (new Set(ids).size !== ids.length) throw new Error('A requisição contém IDs de lead duplicados.');
  return ids;
}

function normalizeChannelName(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
}

async function channelIds(admin: SupabaseClient): Promise<ChannelIds> {
  const response = await admin.from('channels').select('channels_id,channels_name');
  if (response.error) throw new Error(`Falha ao carregar canais: ${response.error.message}`);
  const rows = (response.data ?? []) as Array<{ channels_id?: unknown; channels_name?: unknown }>;
  const find = (key: string) => Number(rows.find((row) => normalizeChannelName(row.channels_name) === key)?.channels_id ?? 0);
  const whatsapp = find('whatsapp');
  const instagram = find('instagram');
  const semDestino = find('semdestino');
  if (!whatsapp || !instagram || !semDestino) throw new Error('Catálogo de canais incompleto.');
  return { whatsapp, instagram, semDestino };
}

async function resolveOwnedLeads(auth: AuthContext, requested: ValidationLead[]): Promise<{ leads: OwnedValidationLead[]; channels: ChannelIds }> {
  const ids = numericLeadIds(requested);
  const channels = await channelIds(auth.admin);
  const { data, error } = await auth.admin
    .from('leads')
    .select('leads_id,users_id,leads_name,leads_phone,leads_whatsapp,leads_instagram,lead_status_id,channels_id')
    .eq('organizations_id', auth.organizationId)
    .eq('users_id', auth.publicUserId)
    .in('leads_id', ids.map(Number));
  if (error) throw new Error(`Falha ao conferir os leads no banco: ${error.message}`);
  const rows = new Map<string, ValidationLeadRow>(((data ?? []) as ValidationLeadRow[]).map((row) => [String(row.leads_id), row]));
  if (rows.size !== ids.length) throw new Error('Um ou mais leads não existem ou não pertencem à organização ativa.');

  const leads = requested.map((lead): OwnedValidationLead => {
    const id = String(lead.id || lead.lead_id || '');
    const row = rows.get(id);
    if (!row) throw new Error(`Lead não encontrado: ${id}.`);
    if (Number(row.lead_status_id) !== 2 || Number(row.channels_id) !== channels.whatsapp) {
      throw new Error(`Lead ${id} não está em Revisão + WhatsApp.`);
    }
    const phone = phoneDigits(row.leads_whatsapp || row.leads_phone);
    if (phone.length < 12 || phone.length > 15) throw new Error(`Lead ${id} está sem telefone WhatsApp válido.`);
    const chipInstance = String(lead.chip_instance ?? '').trim();
    if (!chipInstance) throw new Error(`Lead ${id} está sem instância Evolution do chip selecionado.`);
    const reviewItemId = String(lead.review_item_id ?? '').trim();
    if (!/^\d+$/.test(reviewItemId) || Number(reviewItemId) <= 0) {
      throw new Error(`Lead ${id} está sem a reserva de Revisão usada nesta puxada.`);
    }
    return {
      id,
      lead_id: id,
      review_item_id: reviewItemId,
      company: String(row.leads_name ?? ''),
      phone,
      normalized_phone: phone,
      chip_instance: chipInstance,
      instagram: String(row.leads_instagram ?? '').trim(),
    };
  });
  return { leads, channels };
}

async function evolutionInstance(admin: SupabaseClient, publicUserId: number, instanceName: string) {
  const response = await admin.rpc('service_get_evolution_instances', {
    p_users_id: publicUserId,
    p_instances_id: null,
    p_instance_name: instanceName,
  });
  if (response.error) throw new Error(`Falha ao carregar a instância Evolution: ${response.error.message}`);
  const rows = (Array.isArray(response.data) ? response.data : response.data ? [response.data] : []) as EvolutionInstance[];
  const exact = rows.find((row) => String(row.instances_name ?? '').trim() === instanceName) ?? rows[0];
  const baseUrl = String(exact?.instances_url ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(exact?.api_key ?? '').trim();
  const resolvedName = String(exact?.instances_name ?? instanceName).trim();
  if (!baseUrl || !apiKey || !resolvedName) throw new Error(`Credencial/URL da instância ${instanceName} não está disponível.`);
  return { baseUrl, apiKey, instanceName: resolvedName };
}

async function gatewayCheck(instance: { baseUrl: string; apiKey: string; instanceName: string }, numbers: string[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${instance.baseUrl}/v1/whatsapp/instances/${encodeURIComponent(instance.instanceName)}/numbers/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.apiKey },
      body: JSON.stringify({ numbers }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { items?: GatewayCheckItem[]; error?: unknown } | null;
    if (!response.ok) throw new Error(`Gateway WhatsApp ${response.status}: ${String(payload?.error ?? response.statusText ?? 'falha')}`);
    if (!Array.isArray(payload?.items)) throw new Error('Gateway WhatsApp respondeu sem a lista de validação.');
    return payload.items;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Timeout ao validar números no Gateway WhatsApp.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function providerResult(item: GatewayCheckItem | undefined, expectedPhone: string): 'valid' | 'invalid' | 'technical_error' {
  if (!item || phoneDigits(item.number) !== expectedPhone) return 'technical_error';
  // Gateway >=1.2.12 exposes explicit safety flags. For backwards compatibility,
  // older gateways are accepted only when a boolean outcome or exact WhatsApp JID exists.
  if (item.matched === false || item.confirmed === false) return 'technical_error';
  const explicit = boolLike(item.exists ?? item.isWhatsapp ?? item.valid);
  const jid = String(item.jid ?? '').trim();
  const jidExact = jid.endsWith('@s.whatsapp.net') && phoneDigits(jid.split('@')[0]) === expectedPhone;
  if (explicit === true || jidExact) return 'valid';
  if (explicit === false && item.matched !== false) return 'invalid';
  return 'technical_error';
}

async function reviewItemMutation(auth: AuthContext, lead: OwnedValidationLead, mode: 'invalidate' | 'release') {
  let query = auth.admin.from('queue_review_items');
  if (mode === 'release') query = query.delete();
  else query = query.update({ review_status: 'invalidated', updated_at: new Date().toISOString() });
  query = query
    .eq('organizations_id', auth.organizationId)
    .eq('leads_id', Number(lead.id))
    .eq('review_status', 'open');
  if (lead.review_item_id && /^\d+$/.test(lead.review_item_id)) query = query.eq('queue_review_items_id', Number(lead.review_item_id));
  const result = await query.select('queue_review_items_id').maybeSingle();
  if (result.error) throw new Error(`Falha ao liberar a Revisão do lead ${lead.id}: ${result.error.message}`);
  if (!result.data) throw new Error(`A reserva de Revisão do lead ${lead.id} mudou durante a validação.`);
}

type LeadRoute = { lead_status_id: number; channels_id: number | null };

async function rollbackLeadToWhatsappReview(
  auth: AuthContext,
  lead: OwnedValidationLead,
  channels: ChannelIds,
  expected: LeadRoute,
) {
  let query = auth.admin.from('leads').update({
    lead_status_id: 2,
    channels_id: channels.whatsapp,
    leads_updated_at: new Date().toISOString(),
  })
    .eq('organizations_id', auth.organizationId)
    .eq('users_id', auth.publicUserId)
    .eq('leads_id', Number(lead.id))
    .eq('lead_status_id', expected.lead_status_id);

  query = expected.channels_id === null
    ? query.is('channels_id', null)
    : query.eq('channels_id', expected.channels_id);

  const result = await query.select('leads_id').maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('o lead já não estava no estado intermediário esperado');
}

async function mutateReviewWithLeadRollback(
  auth: AuthContext,
  lead: OwnedValidationLead,
  channels: ChannelIds,
  expected: LeadRoute,
  mode: 'invalidate' | 'release',
) {
  try {
    await reviewItemMutation(auth, lead, mode);
  } catch (reviewError) {
    try {
      await rollbackLeadToWhatsappReview(auth, lead, channels, expected);
    } catch (rollbackError) {
      const reviewMessage = reviewError instanceof Error ? reviewError.message : String(reviewError);
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`Falha ao concluir a validação do lead ${lead.id}: ${reviewMessage}. Rollback também falhou: ${rollbackMessage}`);
    }
    throw reviewError;
  }
}

async function persistProviderOutcome(
  auth: AuthContext,
  lead: OwnedValidationLead,
  outcome: 'valid' | 'invalid' | 'technical_error',
  channels: ChannelIds,
  errorMessage = '',
): Promise<ValidationResult> {
  if (outcome === 'valid') {
    return {
      leadId: lead.id,
      lead_id: lead.id,
      status: 'valid',
      valid: true,
      outcome: 'approved',
      persisted: true,
    };
  }

  if (outcome === 'invalid') {
    const hasInstagram = Boolean(lead.instagram.trim());
    const patch = hasInstagram
      ? { lead_status_id: 1, channels_id: channels.instagram, leads_updated_at: new Date().toISOString() }
      : { lead_status_id: 3, channels_id: null, leads_updated_at: new Date().toISOString() };
    const updated = await auth.admin.from('leads').update(patch)
      .eq('organizations_id', auth.organizationId)
      .eq('users_id', auth.publicUserId)
      .eq('leads_id', Number(lead.id))
      .eq('lead_status_id', 2)
      .eq('channels_id', channels.whatsapp)
      .select('leads_id').maybeSingle();
    if (updated.error) throw new Error(`Falha ao persistir a validação do lead ${lead.id}: ${updated.error.message}`);
    if (!updated.data) throw new Error(`O lead ${lead.id} mudou de estado durante a validação.`);
    await mutateReviewWithLeadRollback(auth, lead, channels, {
      lead_status_id: patch.lead_status_id,
      channels_id: patch.channels_id,
    }, 'invalidate');
    return {
      leadId: lead.id,
      lead_id: lead.id,
      status: 'invalid',
      valid: false,
      outcome: hasInstagram ? 'instagram_review_required' : 'no_contact',
      persisted: true,
    };
  }

  // Erro técnico não toma uma decisão comercial. A reserva deste clique é
  // removida e o lead volta ao estado de Importado adequado aos contatos atuais.
  const hasInstagram = Boolean(lead.instagram.trim());
  const hasPhone = lead.phone.length >= 12;
  const target = hasPhone && hasInstagram
    ? { lead_status_id: 1, channels_id: channels.semDestino }
    : hasPhone
      ? { lead_status_id: 1, channels_id: channels.whatsapp }
      : hasInstagram
        ? { lead_status_id: 1, channels_id: channels.instagram }
        : { lead_status_id: 3, channels_id: null as number | null };
  const updated = await auth.admin.from('leads').update({ ...target, leads_updated_at: new Date().toISOString() })
    .eq('organizations_id', auth.organizationId)
    .eq('users_id', auth.publicUserId)
    .eq('leads_id', Number(lead.id))
    .eq('lead_status_id', 2)
    .eq('channels_id', channels.whatsapp)
    .select('leads_id').maybeSingle();
  if (updated.error) throw new Error(`Falha ao devolver o lead ${lead.id} para Importado: ${updated.error.message}`);
  if (!updated.data) throw new Error(`O lead ${lead.id} mudou de estado durante a validação.`);
  await mutateReviewWithLeadRollback(auth, lead, channels, target, 'release');
  return {
    leadId: lead.id,
    lead_id: lead.id,
    status: 'error',
    valid: false,
    outcome: 'error',
    persisted: true,
    errorMessage: errorMessage || 'A Evolution não confirmou o resultado deste número.',
  };
}

async function validateDirect(auth: AuthContext, leads: OwnedValidationLead[], channels: ChannelIds) {
  const grouped = new Map<string, OwnedValidationLead[]>();
  for (const lead of leads) grouped.set(lead.chip_instance, [...(grouped.get(lead.chip_instance) ?? []), lead]);
  const results = new Map<string, ValidationResult>();

  for (const [instanceName, group] of grouped) {
    let items: GatewayCheckItem[];
    try {
      const instance = await evolutionInstance(auth.admin, auth.publicUserId, instanceName);
      items = await gatewayCheck(instance, Array.from(new Set(group.map((lead) => lead.phone))));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha técnica ao consultar o Gateway WhatsApp.';
      for (const lead of group) results.set(lead.id, await persistProviderOutcome(auth, lead, 'technical_error', channels, message));
      continue;
    }

    for (const lead of group) {
      const matches = items.filter((item) => phoneDigits(item.number) === lead.phone);
      const classified = matches.length === 1 ? providerResult(matches[0], lead.phone) : 'technical_error';
      const message = matches.length > 1
        ? 'Gateway retornou mais de um resultado para o mesmo número.'
        : matches.length === 0
          ? 'Gateway não retornou correspondência exata para o número.'
          : classified === 'technical_error'
            ? 'Gateway/Evolution não confirmou explicitamente se o número possui WhatsApp.'
            : '';
      results.set(lead.id, await persistProviderOutcome(auth, lead, classified, channels, message));
    }
  }

  return leads.map((lead) => results.get(lead.id)!).filter(Boolean);
}

export async function handleValidationRequest(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const record = requestBodyRecord(req.body);
  const requested = Array.isArray(record.leads) ? record.leads as ValidationLead[] : [];
  const requestedMode = String(record.mode ?? '').trim().toLowerCase();
  const requestedOperation = String(record.operation ?? '').trim().toLowerCase();
  if (!requested.length) {
    res.status(400).json({ error: 'Nenhum lead recebido para validação.' });
    return;
  }
  if (requestedMode !== 'initial' || requestedOperation !== 'validate') {
    res.status(409).json({
      error: 'Operação incompatível. Esta rota aceita somente validate/initial.',
      expected: { operation: 'validate', mode: 'initial' },
    });
    return;
  }

  try {
    const auth = await authenticate(req);
    const owned = await resolveOwnedLeads(auth, requested);
    const results = await validateDirect(auth, owned.leads, owned.channels);
    const summary = results.reduce((acc, result) => {
      acc[result.status] += 1;
      return acc;
    }, { valid: 0, invalid: 0, error: 0 });
    res.status(200).json({
      results,
      meta: {
        provider: 'vinsansi_gateway_evolution_direct',
        simulated: false,
        operation: 'validate',
        mode: 'initial',
        ...summary,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validação indisponível.';
    const unauthorized = /sessão|usuário interno|sem permissão/i.test(message);
    res.status(unauthorized ? 401 : 503).json({
      code: unauthorized ? 'unauthorized' : 'validation_unavailable',
      error: message,
      message,
    });
  }
}
