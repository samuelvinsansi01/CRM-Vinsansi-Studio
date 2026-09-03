import { getSupabaseClient } from '../../lib/supabase';
import { normalizeStatusGroup } from '../../services/status/status.mapper';
import type {
  ReconciliationChannel,
  ReconciliationIssue,
  ReconciliationLeadSnapshot,
  ReconciliationQueueSnapshot,
  ReconciliationRepairResult,
} from '../../services/reconciliation/types';
import { currentUserIdNumber, queueStatusId } from '../schemaCatalog';
import { loadCanonicalQueue } from '../queueSchema';
import { nowIso } from '../supabase.helpers';
import type { ReconciliationRepository } from './reconciliation.repository';

const ACTIVE_QUEUE_GROUPS = new Set(['queued', 'sending', 'paused', 'error', 'following', 'dm_opened']);

type Row = Record<string, unknown>;

function numericId(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} invalido.`);
  return parsed;
}

async function pagedLeads(userId: number) {
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getSupabaseClient()
      .from('leads')
      .select('leads_id,leads_name,lead_status_id,channels_id,leads_updated_at,leads_created_at')
      .eq('users_id', userId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Falha ao ler leads: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function currentQueueItem(itemId: string, userId: number) {
  const { data, error } = await getSupabaseClient()
    .from('queue_items')
    .select('queue_items_id,users_id,queues_id,leads_id,status_id,queue_items_updated_at,queue_items_created_at')
    .eq('queue_items_id', numericId(itemId, 'queue_items_id'))
    .eq('users_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao reler item ${itemId}: ${error.message}`);
  return data ? data as Row : null;
}

async function compareAndSetLeadStatus(leadId: string, userId: number, expectedStatus: number, targetStatus: number) {
  if (expectedStatus === targetStatus) return { changed: false, current: targetStatus };
  const id = numericId(leadId, 'leads_id');
  const { data, error } = await getSupabaseClient()
    .from('leads')
    .update({ lead_status_id: targetStatus, leads_updated_at: nowIso() })
    .eq('leads_id', id)
    .eq('users_id', userId)
    .eq('lead_status_id', expectedStatus)
    .select('leads_id,lead_status_id')
    .maybeSingle();
  if (error) throw new Error(`Falha ao sincronizar lead ${leadId}: ${error.message}`);
  if ((data as Row | null)?.leads_id) return { changed: true, current: Number((data as Row).lead_status_id) };

  const { data: current, error: currentError } = await getSupabaseClient()
    .from('leads')
    .select('lead_status_id')
    .eq('leads_id', id)
    .eq('users_id', userId)
    .maybeSingle();
  if (currentError) throw new Error(`Falha ao confirmar estado do lead ${leadId}: ${currentError.message}`);
  if (!current) throw new Error(`Lead ${leadId} nao foi encontrado ou nao pertence ao usuario atual.`);
  return { changed: false, current: Number((current as Row).lead_status_id) };
}

async function allQueueRowsForLead(leadId: string, userId: number) {
  const { data, error } = await getSupabaseClient()
    .from('queue_items')
    .select('queue_items_id,status_id,queues_id,queue_items_updated_at')
    .eq('users_id', userId)
    .eq('leads_id', numericId(leadId, 'leads_id'));
  if (error) throw new Error(`Falha ao conferir filas do lead ${leadId}: ${error.message}`);
  return (data ?? []) as Row[];
}

async function queueItemGroup(itemId: string, userId: number) {
  const row = await currentQueueItem(itemId, userId);
  if (!row) throw new Error('O item da fila nao existe mais ou nao pertence ao usuario atual.');
  const statusId = Number(row.status_id);
  const { data: statusRow, error } = await getSupabaseClient()
    .from('status')
    .select('status_name')
    .eq('status_id', statusId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar status do item ${itemId}: ${error.message}`);
  return { row, group: normalizeStatusGroup((statusRow as Row | null)?.status_name ?? statusId) };
}

async function assertTerminalQueueState(issue: ReconciliationIssue, expectedGroup: 'sent' | 'invalid', userId: number) {
  if (!issue.queueItemId) throw new Error('A inconsistencia nao possui item de fila identificavel.');
  const { group } = await queueItemGroup(issue.queueItemId, userId);
  if (group !== expectedGroup) {
    throw new Error(`O item da fila mudou para “${group}”. Execute uma nova auditoria antes de reparar.`);
  }
}

async function activeQueueItemsForLead(leadId: string, userId: number) {
  const rows = await allQueueRowsForLead(leadId, userId);
  if (!rows.length) return [] as Array<{ id: string; group: string }>;
  const { data: statuses, error } = await getSupabaseClient().from('status').select('status_id,status_name');
  if (error) throw new Error(`Falha ao carregar catalogo de status: ${error.message}`);
  const map = new Map(((statuses ?? []) as Row[]).map((row) => [String(row.status_id), String(row.status_name)]));
  return rows.map((row) => {
    const group = normalizeStatusGroup(map.get(String(row.status_id)) ?? row.status_id);
    return { id: String(row.queue_items_id), group };
  }).filter((item) => ACTIVE_QUEUE_GROUPS.has(item.group));
}

async function markQueueError(issue: ReconciliationIssue, userId: number): Promise<ReconciliationRepairResult> {
  if (!issue.queueItemId) throw new Error('A inconsistencia nao possui item de fila identificavel.');
  const { row, group } = await queueItemGroup(issue.queueItemId, userId);
  if (group === 'error') return { issueId: issue.id, repaired: false, unchanged: true, message: 'O item ja esta marcado com erro.' };
  if (!ACTIVE_QUEUE_GROUPS.has(group)) throw new Error(`O item mudou para “${group}” e nao pode mais ser bloqueado por este reparo.`);

  let query = getSupabaseClient()
    .from('queue_items')
    .update({
      status_id: await queueStatusId('error'),
      queue_items_error_message: `Bloqueado pela reconciliacao F10: ${issue.title}`,
      queue_items_finished_at: nowIso(),
      queue_items_updated_at: nowIso(),
    })
    .eq('queue_items_id', numericId(issue.queueItemId, 'queue_items_id'))
    .eq('users_id', userId)
    .eq('status_id', Number(row.status_id));
  if (issue.queueUpdatedAt) query = query.eq('queue_items_updated_at', issue.queueUpdatedAt);
  const { data, error } = await query.select('queue_items_id').maybeSingle();
  if (error) throw new Error(`Falha ao bloquear item ${issue.queueItemId}: ${error.message}`);
  if (!(data as Row | null)?.queue_items_id) throw new Error('O item foi alterado por outra execucao. Faca uma nova auditoria.');
  return { issueId: issue.id, repaired: true, unchanged: false, message: 'Item da fila bloqueado com status de erro.' };
}

function queueSnapshots(channel: ReconciliationChannel, rows: Awaited<ReturnType<typeof loadCanonicalQueue>>): ReconciliationQueueSnapshot[] {
  return rows.map((row) => ({
    id: String(row.item.queue_items_id ?? ''),
    channel,
    leadId: String(row.item.leads_id ?? ''),
    status: normalizeStatusGroup(row.statusName),
    statusRaw: row.statusName,
    updatedAt: String(row.item.queue_items_updated_at ?? row.item.queue_items_created_at ?? ''),
    createdAt: String(row.item.queue_items_created_at ?? row.item.queue_items_updated_at ?? ''),
  })).filter((item) => Boolean(item.id));
}

export const canonicalReconciliationRepository: ReconciliationRepository = {
  async loadLeads() {
    const userId = await currentUserIdNumber();
    const rows = await pagedLeads(userId);
    return rows.map((row): ReconciliationLeadSnapshot => ({
      id: String(row.leads_id ?? ''),
      name: String(row.leads_name ?? ''),
      statusId: Number(row.lead_status_id ?? 0),
      channelId: row.channels_id === null || row.channels_id === undefined ? null : Number(row.channels_id),
      updatedAt: String(row.leads_updated_at ?? row.leads_created_at ?? ''),
    })).filter((lead) => Boolean(lead.id));
  },

  async loadQueueItems() {
    const [whatsapp, instagram] = await Promise.all([
      loadCanonicalQueue('WhatsApp'),
      loadCanonicalQueue('Instagram'),
    ]);
    return [...queueSnapshots('whatsapp', whatsapp), ...queueSnapshots('instagram', instagram)];
  },

  async repair(issue) {
    if (!issue.repairAction) throw new Error('Esta inconsistencia exige revisao manual e nao possui reparo automatico.');
    const userId = await currentUserIdNumber();

    if (issue.repairAction === 'mark-queue-error') return markQueueError(issue, userId);
    if (!issue.leadId || !issue.leadStatusId) throw new Error('A inconsistencia nao possui lead e status esperados.');

    if (issue.repairAction === 'return-lead-to-valid') {
      const rows = await allQueueRowsForLead(issue.leadId, userId);
      if (rows.length) throw new Error('Uma fila foi criada depois da auditoria. Execute uma nova varredura.');
      const result = await compareAndSetLeadStatus(issue.leadId, userId, 4, 2);
      if (!result.changed) {
        if (result.current === 2) return { issueId: issue.id, repaired: false, unchanged: true, message: 'O lead ja retornou ao status Validado.' };
        throw new Error(`O lead mudou para o status ${result.current}. Execute uma nova auditoria.`);
      }
      return { issueId: issue.id, repaired: true, unchanged: false, message: 'Lead retornado ao status 2 — Validado.' };
    }

    if (issue.repairAction === 'sync-lead-queued') {
      const active = await activeQueueItemsForLead(issue.leadId, userId);
      if (active.length !== 1 || active[0]?.id !== issue.queueItemId) throw new Error('A quantidade de itens ativos mudou. Execute uma nova auditoria.');
      const result = await compareAndSetLeadStatus(issue.leadId, userId, 2, 4);
      if (!result.changed) {
        if (result.current === 4) return { issueId: issue.id, repaired: false, unchanged: true, message: 'O lead ja esta no status Na fila.' };
        throw new Error(`O lead mudou para o status ${result.current}. Execute uma nova auditoria.`);
      }
      return { issueId: issue.id, repaired: true, unchanged: false, message: 'Lead sincronizado para o status 4 — Na fila.' };
    }

    if (issue.repairAction === 'sync-lead-sent') {
      await assertTerminalQueueState(issue, 'sent', userId);
      const result = await compareAndSetLeadStatus(issue.leadId, userId, issue.leadStatusId, 5);
      if (!result.changed) {
        if (result.current === 5) return { issueId: issue.id, repaired: false, unchanged: true, message: 'O lead ja esta no status Enviado.' };
        throw new Error(`O lead mudou para o status ${result.current}. Execute uma nova auditoria.`);
      }
      return { issueId: issue.id, repaired: true, unchanged: false, message: 'Lead sincronizado para o status 5 — Enviado.' };
    }

    await assertTerminalQueueState(issue, 'invalid', userId);
    const result = await compareAndSetLeadStatus(issue.leadId, userId, issue.leadStatusId, 6);
    if (!result.changed) {
      if (result.current === 6) return { issueId: issue.id, repaired: false, unchanged: true, message: 'O lead ja esta no status Invalido.' };
      throw new Error(`O lead mudou para o status ${result.current}. Execute uma nova auditoria.`);
    }
    return { issueId: issue.id, repaired: true, unchanged: false, message: 'Lead sincronizado para o status 6 — Invalido.' };
  },
};
