import { importService } from '../import/import.service';
import type { ImportLead } from '../import/types';
import { isStatusGroup } from '../status/status.mapper';
import { whatsappValidationService } from '../whatsapp-validation/whatsappValidation.service';

const CRM_SOURCE = 'crm-vinsansi-google-maps';
const EXTENSION_SOURCE = 'google-maps-extension';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BATCH_SIZE = 25;

export type GoogleMapsExecutionConfig = {
  executionId: string;
  branchesId: number;
  branchName: string;
  subcategories: string[];
  locations: string[];
  targets: { whatsappCandidates: number; instagramCandidates: number };
  mode: 'quick' | 'complete';
};

type BridgeResponse = { ok?: boolean; error?: string; state?: unknown };
type SyncItem = Record<string, unknown> & {
  crmContext?: { executionId?: unknown; branchesId?: unknown; branchName?: unknown; subcategory?: unknown; location?: unknown };
};
type SyncPayload = { executionId?: unknown; batchId?: unknown; items?: unknown };
type ExecutionEvent = { eventId?: unknown; executionId?: unknown; type?: unknown; occurredAt?: unknown; state?: unknown };
type BridgeSyncRequest = { kind?: unknown; batch?: SyncPayload; event?: ExecutionEvent };

function bridgeRequest(payload: Record<string, unknown>) {
  return new Promise<BridgeResponse>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Extensão Google Maps não encontrada ou não respondeu. Recarregue a extensão e o CRM.'));
    }, REQUEST_TIMEOUT_MS);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data as { source?: unknown; type?: unknown; requestId?: unknown; payload?: BridgeResponse };
      if (message?.source !== EXTENSION_SOURCE || message.type !== 'response' || message.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(message.payload ?? { ok: false, error: 'extension_empty_response' });
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ source: CRM_SOURCE, type: 'request', requestId, payload }, location.origin);
  });
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function validateSyncPayload(payload: SyncPayload) {
  const executionId = text(payload.executionId);
  const batchId = text(payload.batchId);
  const items = Array.isArray(payload.items) ? payload.items as SyncItem[] : [];
  if (!executionId || !batchId || !items.length || items.length > MAX_BATCH_SIZE) throw new Error('invalid_google_maps_sync_batch');
  for (const item of items) {
    const context = item?.crmContext;
    if (text(context?.executionId) !== executionId) throw new Error('google_maps_execution_scope_mismatch');
    if (!Number.isSafeInteger(Number(context?.branchesId)) || Number(context?.branchesId) <= 0) throw new Error('google_maps_branch_scope_invalid');
    if (!text(context?.branchName) || !text(context?.subcategory) || !text(context?.location)) throw new Error('google_maps_coverage_scope_invalid');
  }
  return { executionId, batchId, items };
}

function whatsappLeadIds(leads: ImportLead[]) {
  return leads
    .filter((lead) => !lead.send_instagram && (lead.destination ?? lead.destino) !== 'Instagram')
    .map((lead) => lead.id)
    .filter((id) => /^\d+$/.test(id));
}

async function processSyncBatch(rawPayload: SyncPayload) {
  const payload = validateSyncPayload(rawPayload);
  const preview = await importService.importFromJson(JSON.stringify({ items: payload.items }), { simulate: true, origin: 'api' });
  const eligible = preview.leads.filter((lead) =>
    isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'pending') || isStatusGroup(lead.status, 'review'));
  const persistence = await importService.persistLeads(eligible, { origin: 'api' });
  if (persistence.simulation) {
    return {
      ok: true,
      confirmed: false,
      simulation: true,
      error: 'crm_simulation_mode',
      processed: payload.items.length,
      accepted: 0,
      rejected: preview.report.rejected,
      duplicates: preview.report.duplicates,
    };
  }

  let validationWarning: string | null = null;
  const ids = whatsappLeadIds(persistence.created);
  if (ids.length) {
    try {
      const validation = await whatsappValidationService.validateInitial(ids);
      if (validation.failed || validation.errors || validation.conflicts) {
        validationWarning = validation.failures[0]?.reason ?? 'whatsapp_validation_pending';
      }
    } catch (error) {
      validationWarning = error instanceof Error ? error.message : 'whatsapp_validation_pending';
    }
  }

  return {
    ok: true,
    confirmed: true,
    simulation: false,
    executionId: payload.executionId,
    batchId: payload.batchId,
    processed: payload.items.length,
    accepted: persistence.created.length,
    rejected: preview.report.rejected,
    duplicates: preview.report.duplicates + persistence.duplicateClientIds.length,
    validationPending: validationWarning ? ids.length : 0,
    validationWarning,
  };
}

function processExecutionEvent(rawEvent: ExecutionEvent) {
  const eventId = text(rawEvent.eventId);
  const executionId = text(rawEvent.executionId);
  const type = text(rawEvent.type);
  const allowed = new Set([
    'execution_started',
    'execution_paused',
    'execution_resumed',
    'execution_stopped',
    'execution_paused_after_browser_restart',
    'coverage_updated',
    'coverage_stopped',
    'execution_completed',
    'execution_error',
  ]);
  if (!eventId || !executionId || !allowed.has(type) || !rawEvent.state || typeof rawEvent.state !== 'object') {
    throw new Error('invalid_google_maps_execution_event');
  }
  const event = { eventId, executionId, type, occurredAt: text(rawEvent.occurredAt), state: rawEvent.state };
  window.sessionStorage.setItem(`painel:gmaps-execution:${executionId}`, JSON.stringify(event));
  window.dispatchEvent(new CustomEvent('google-maps-execution:changed', { detail: event }));
  return { ok: true, confirmed: true, eventId, executionId, type };
}

export const googleMapsExtensionService = {
  async configure(execution: GoogleMapsExecutionConfig) {
    const response = await bridgeRequest({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution });
    if (!response.ok) throw new Error(response.error || 'Não foi possível configurar a extensão Google Maps.');
    return response.state;
  },

  installSyncListener() {
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data as { source?: unknown; type?: unknown; requestId?: unknown; payload?: BridgeSyncRequest };
      if (message?.source !== EXTENSION_SOURCE || message.type !== 'sync_request' || !text(message.requestId)) return;
      const request = message.payload ?? {};
      const operation = request.kind === 'execution_event'
        ? Promise.resolve().then(() => processExecutionEvent(request.event ?? {}))
        : processSyncBatch(request.batch ?? {});
      void operation.then(
        (payload) => window.postMessage({ source: CRM_SOURCE, type: 'sync_response', requestId: message.requestId, payload }, location.origin),
        (error) => window.postMessage({
          source: CRM_SOURCE,
          type: 'sync_response',
          requestId: message.requestId,
          payload: { ok: false, confirmed: false, error: error instanceof Error ? error.message : 'google_maps_sync_failed' },
        }, location.origin),
      );
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  },
};
