import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { normalizeStatusGroup } from '../../services/status/status.mapper';
import type {
  ReconciliationChannel,
  ReconciliationIssue,
  ReconciliationLeadSnapshot,
  ReconciliationQueueSnapshot,
  ReconciliationRepairResult,
} from '../../services/reconciliation/types';
import { getCurrentUserId, nowIso } from '../supabase.helpers';
import type { ReconciliationRepository } from './reconciliation.repository';

const ACTIVE_QUEUE_GROUPS = new Set(['queued', 'sending', 'paused', 'error', 'following', 'dm_opened']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function databaseLeadId(value: string) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : value;
}

async function pagedRows(table: string, userColumn: 'users_id' | 'user_id', userId: string) {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getSupabaseClient()
      .from(table)
      .select('*')
      .eq(userColumn, userId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Falha ao ler ${table}: ${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function queueSnapshot(row: Record<string, unknown>, channel: ReconciliationChannel): ReconciliationQueueSnapshot {
  const data = record(row.data ?? row.raw_payload);
  const statusRaw = String(row.status ?? data.status ?? '');
  return {
    id: String(row.id ?? ''),
    channel,
    leadId: String(row.lead_id ?? data.lead_id ?? data.sourcePreSendId ?? data.source_pre_send_id ?? ''),
    status: normalizeStatusGroup(statusRaw),
    statusRaw,
    updatedAt: String(row.updated_at ?? data.updated_at ?? row.created_at ?? data.created_at ?? ''),
    createdAt: String(row.created_at ?? data.created_at ?? row.updated_at ?? data.updated_at ?? ''),
  };
}

async function loadQueueRow(channel: ReconciliationChannel, itemId: string, userId: string) {
  const config = getSupabaseConfig();
  const table = channel === 'whatsapp' ? config.tables.whatsappQueueItems : config.tables.instagramQueueItems;
  const { data, error } = await getSupabaseClient()
    .from(table)
    .select('*')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao reler item ${itemId}: ${error.message}`);
  return { table, row: data ? data as Record<string, unknown> : null };
}

async function compareAndSetLeadStatus(leadId: string, userId: string, expectedStatus: number, targetStatus: number) {
  if (expectedStatus === targetStatus) return { changed: false, current: targetStatus };
  const { data, error } = await getSupabaseClient()
    .from(getSupabaseConfig().tables.importLeads)
    .update({ lead_status_id: targetStatus, leads_updated_at: nowIso() })
    .eq('leads_id', databaseLeadId(leadId))
    .eq('users_id', userId)
    .eq('lead_status_id', expectedStatus)
    .select('leads_id,lead_status_id')
    .maybeSingle();
  if (error) throw new Error(`Falha ao sincronizar lead ${leadId}: ${error.message}`);
  if (data?.leads_id) return { changed: true, current: Number(data.lead_status_id) };

  const { data: current, error: currentError } = await getSupabaseClient()
    .from(getSupabaseConfig().tables.importLeads)
    .select('lead_status_id')
    .eq('leads_id', databaseLeadId(leadId))
    .eq('users_id', userId)
    .maybeSingle();
  if (currentError) throw new Error(`Falha ao confirmar estado do lead ${leadId}: ${currentError.message}`);
  if (!current) throw new Error(`Lead ${leadId} não foi encontrado ou não pertence ao usuário atual.`);
  return { changed: false, current: Number(current.lead_status_id) };
}

async function activeQueueItemsForLead(leadId: string, userId: string) {
  const config = getSupabaseConfig();
  const dbLeadId = databaseLeadId(leadId);
  const responses = await Promise.all([
    getSupabaseClient().from(config.tables.whatsappQueueItems).select('id,status,data,lead_id').eq('user_id', userId).eq('lead_id', dbLeadId),
    getSupabaseClient().from(config.tables.instagramQueueItems).select('id,status,data,lead_id').eq('user_id', userId).eq('lead_id', dbLeadId),
  ]);
  for (const response of responses) {
    if (response.error) throw new Error(`Falha ao conferir filas do lead ${leadId}: ${response.error.message}`);
  }
  return responses.flatMap((response, index) => (response.data ?? []).map((row) => {
    const raw = row as Record<string, unknown>;
    const data = record(raw.data);
    const status = String(raw.status ?? data.status ?? '');
    return {
      id: String(raw.id ?? ''),
      channel: index === 0 ? 'whatsapp' as const : 'instagram' as const,
      status,
      group: normalizeStatusGroup(status),
    };
  })).filter((item) => ACTIVE_QUEUE_GROUPS.has(item.group));
}

async function allQueueItemsForLead(leadId: string, userId: string) {
  const config = getSupabaseConfig();
  const dbLeadId = databaseLeadId(leadId);
  const [whatsapp, instagram] = await Promise.all([
    getSupabaseClient().from(config.tables.whatsappQueueItems).select('id').eq('user_id', userId).eq('lead_id', dbLeadId).limit(1),
    getSupabaseClient().from(config.tables.instagramQueueItems).select('id').eq('user_id', userId).eq('lead_id', dbLeadId).limit(1),
  ]);
  if (whatsapp.error) throw new Error(`Falha ao conferir fila WhatsApp: ${whatsapp.error.message}`);
  if (instagram.error) throw new Error(`Falha ao conferir fila Instagram: ${instagram.error.message}`);
  return [...(whatsapp.data ?? []), ...(instagram.data ?? [])];
}

async function assertTerminalQueueState(issue: ReconciliationIssue, expectedGroup: 'sent' | 'invalid', userId: string) {
  if (!issue.channel || !issue.queueItemId) throw new Error('A inconsistência não possui item de fila identificável.');
  const { row } = await loadQueueRow(issue.channel, issue.queueItemId, userId);
  if (!row) throw new Error('O item da fila não existe mais ou não pertence ao usuário atual.');
  const data = record(row.data ?? row.raw_payload);
  const current = normalizeStatusGroup(row.status ?? data.status);
  if (current !== expectedGroup) {
    throw new Error(`O item da fila mudou para “${current}”. Execute uma nova auditoria antes de reparar.`);
  }
}

async function markQueueError(issue: ReconciliationIssue, userId: string): Promise<ReconciliationRepairResult> {
  if (!issue.channel || !issue.queueItemId) throw new Error('A inconsistência não possui item de fila identificável.');
  const { table, row } = await loadQueueRow(issue.channel, issue.queueItemId, userId);
  if (!row) throw new Error('O item da fila não existe mais ou não pertence ao usuário atual.');

  const data = record(row.data ?? row.raw_payload);
  const currentRaw = String(row.status ?? data.status ?? '');
  const currentGroup = normalizeStatusGroup(currentRaw);
  if (currentGroup === 'error') {
    return { issueId: issue.id, repaired: false, unchanged: true, message: 'O item já está marcado com erro.' };
  }
  if (!ACTIVE_QUEUE_GROUPS.has(currentGroup)) {
    throw new Error(`O item mudou para “${currentGroup}” e não pode mais ser bloqueado por este reparo.`);
  }

  const timestamp = nowIso();
  const nextData = {
    ...data,
    status: 'error',
    error_message: `Bloqueado pela reconciliação F10: ${issue.title}`,
    reconciliation_issue_id: issue.id,
    updated_at: timestamp,
  };
  let query = getSupabaseClient()
    .from(table)
    .update({
      status: 'error',
      error_message: `Bloqueado pela reconciliação F10: ${issue.title}`,
      data: nextData,
      updated_at: timestamp,
    })
    .eq('id', issue.queueItemId)
    .eq('user_id', userId)
    .eq('status', currentRaw);
  if (issue.queueUpdatedAt) query = query.eq('updated_at', issue.queueUpdatedAt);
  const { data: updated, error } = await query.select('id').maybeSingle();
  if (error) throw new Error(`Falha ao bloquear item ${issue.queueItemId}: ${error.message}`);
  if (!updated?.id) throw new Error('O item foi alterado por outra execução. Faça uma nova auditoria.');
  return { issueId: issue.id, repaired: true, unchanged: false, message: 'Item da fila bloqueado com status de erro.' };
}

export const supabaseReconciliationRepository: ReconciliationRepository = {
  async loadLeads() {
    const userId = await getCurrentUserId();
    const rows = await pagedRows(getSupabaseConfig().tables.importLeads, 'users_id', userId);
    return rows.map((row): ReconciliationLeadSnapshot => ({
      id: String(row.leads_id ?? ''),
      name: String(row.leads_name ?? ''),
      statusId: Number(row.lead_status_id ?? 0),
      channelId: row.channels_id === null || row.channels_id === undefined ? null : Number(row.channels_id),
      updatedAt: String(row.leads_updated_at ?? row.leads_created_at ?? ''),
    })).filter((lead) => Boolean(lead.id));
  },

  async loadQueueItems() {
    const userId = await getCurrentUserId();
    const config = getSupabaseConfig();
    const [whatsappRows, instagramRows] = await Promise.all([
      pagedRows(config.tables.whatsappQueueItems, 'user_id', userId),
      pagedRows(config.tables.instagramQueueItems, 'user_id', userId),
    ]);
    return [
      ...whatsappRows.map((row) => queueSnapshot(row, 'whatsapp')),
      ...instagramRows.map((row) => queueSnapshot(row, 'instagram')),
    ].filter((item) => Boolean(item.id));
  },

  async repair(issue) {
    if (!issue.repairAction) throw new Error('Esta inconsistência exige revisão manual e não possui reparo automático.');
    const userId = await getCurrentUserId();

    if (issue.repairAction === 'mark-queue-error') {
      return markQueueError(issue, userId);
    }
    if (!issue.leadId || !issue.leadStatusId) throw new Error('A inconsistência não possui lead e status esperados.');

    if (issue.repairAction === 'return-lead-to-valid') {
      const queueRows = await allQueueItemsForLead(issue.leadId, userId);
      if (queueRows.length) throw new Error('Uma fila foi criada depois da auditoria. Execute uma nova varredura.');
      const result = await compareAndSetLeadStatus(issue.leadId, userId, 4, 2);
      if (!result.changed) {
        if (result.current === 2) return { issueId: issue.id, repaired: false, unchanged: true, message: 'O lead já retornou ao status Validado.' };
        throw new Error(`O lead mudou para o status ${result.current}. Execute uma nova auditoria.`);
      }
      return { issueId: issue.id, repaired: true, unchanged: false, message: 'Lead retornado ao status 2 — Validado.' };
    }

    if (issue.repairAction === 'sync-lead-queued') {
      const active = await activeQueueItemsForLead(issue.leadId, userId);
      if (active.length !== 1 || active[0]?.id !== issue.queueItemId) {
        throw new Error('A quantidade de itens ativos mudou. Execute uma nova auditoria.');
      }
      const result = await compareAndSetLeadStatus(issue.leadId, userId, 2, 4);
      if (!result.changed) {
        if (result.current === 4) return { issueId: issue.id, repaired: false, unchanged: true, message: 'O lead já está no status Na fila.' };
        throw new Error(`O lead mudou para o status ${result.current}. Execute uma nova auditoria.`);
      }
      return { issueId: issue.id, repaired: true, unchanged: false, message: 'Lead sincronizado para o status 4 — Na fila.' };
    }

    if (issue.repairAction === 'sync-lead-sent') {
      await assertTerminalQueueState(issue, 'sent', userId);
      const result = await compareAndSetLeadStatus(issue.leadId, userId, issue.leadStatusId, 5);
      if (!result.changed) {
        if (result.current === 5) return { issueId: issue.id, repaired: false, unchanged: true, message: 'O lead já está no status Enviado.' };
        throw new Error(`O lead mudou para o status ${result.current}. Execute uma nova auditoria.`);
      }
      return { issueId: issue.id, repaired: true, unchanged: false, message: 'Lead sincronizado para o status 5 — Enviado.' };
    }

    await assertTerminalQueueState(issue, 'invalid', userId);
    const result = await compareAndSetLeadStatus(issue.leadId, userId, issue.leadStatusId, 6);
    if (!result.changed) {
      if (result.current === 6) return { issueId: issue.id, repaired: false, unchanged: true, message: 'O lead já está no status Inválido.' };
      throw new Error(`O lead mudou para o status ${result.current}. Execute uma nova auditoria.`);
    }
    return { issueId: issue.id, repaired: true, unchanged: false, message: 'Lead sincronizado para o status 6 — Inválido.' };
  },
};
