import { importService } from '../import/import.service';
import type { ImportLead } from '../import/types';
import { isStatusGroup } from '../status/status.mapper';
import { whatsappValidationService } from '../whatsapp-validation/whatsappValidation.service';

const CRM_SOURCE = 'crm-vinsansi-google-maps';
const EXTENSION_SOURCE = 'google-maps-extension';
const REQUEST_TIMEOUT_MS = 8_000;
const PING_TIMEOUT_MS = 3_000;
const MIN_EXTENSION_VERSION = '0.12.1';
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

type BridgeResponse = {
  ok?: boolean;
  type?: string;
  code?: string;
  message?: string;
  error?: string;
  bridgeVersion?: number;
  extensionVersion?: string;
  operationalAvailable?: boolean;
  configured?: boolean;
  executionId?: string;
  state?: unknown;
};
export type GoogleMapsExtensionDiagnostic = {
  checked: boolean;
  bridgeActive: boolean;
  extensionDetected: boolean;
  extensionVersion: string | null;
  operationalAvailable: boolean;
  configured: boolean;
  lastPingAt: string | null;
  lastError: { code: string; message: string } | null;
};
type SyncItem = Record<string, unknown> & {
  crmContext?: { executionId?: unknown; branchesId?: unknown; branchName?: unknown; subcategory?: unknown; location?: unknown };
};
type SyncPayload = { executionId?: unknown; batchId?: unknown; items?: unknown };
type ExecutionEvent = { eventId?: unknown; executionId?: unknown; type?: unknown; occurredAt?: unknown; state?: unknown };
type BridgeSyncRequest = { kind?: unknown; batch?: SyncPayload; event?: ExecutionEvent };

export class GoogleMapsExtensionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GoogleMapsExtensionError';
    this.code = code;
  }
}

let diagnostic: GoogleMapsExtensionDiagnostic = {
  checked: false,
  bridgeActive: false,
  extensionDetected: false,
  extensionVersion: null,
  operationalAvailable: false,
  configured: false,
  lastPingAt: null,
  lastError: null,
};
const diagnosticListeners = new Set<(value: GoogleMapsExtensionDiagnostic) => void>();

function updateDiagnostic(patch: Partial<GoogleMapsExtensionDiagnostic>) {
  diagnostic = { ...diagnostic, ...patch };
  for (const listener of diagnosticListeners) listener({ ...diagnostic });
}

function responseError(response: BridgeResponse, fallbackCode: string, fallbackMessage: string) {
  return new GoogleMapsExtensionError(
    text(response.code) || fallbackCode,
    text(response.message || response.error) || fallbackMessage,
  );
}

function versionParts(value: string) {
  return value.split('.').map((part) => Number(part));
}

function compatibleVersion(value: string) {
  const actual = versionParts(value);
  const minimum = versionParts(MIN_EXTENSION_VERSION);
  for (let index = 0; index < 3; index += 1) {
    const difference = (actual[index] || 0) - (minimum[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function bridgeRequest(payload: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise<BridgeResponse>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      const error = new GoogleMapsExtensionError(
        'bridge_unavailable',
        'A bridge da extensão não foi detectada nesta página. A extensão pode estar ausente/desabilitada ou o CRM precisa ser recarregado após carregar a extensão.',
      );
      updateDiagnostic({ checked: true, bridgeActive: false, extensionDetected: false, lastError: { code: error.code, message: error.message } });
      reject(error);
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data as { source?: unknown; type?: unknown; requestId?: unknown; payload?: BridgeResponse };
      if (message?.source !== EXTENSION_SOURCE || message.type !== 'response' || message.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      updateDiagnostic({ bridgeActive: true });
      resolve(message.payload ?? { ok: false, code: 'extension_empty_response', message: 'A bridge respondeu sem payload.' });
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ source: CRM_SOURCE, type: 'request', requestId, payload }, location.origin);
  });
}

async function pingExtension() {
  const response = await bridgeRequest({ type: 'GMAPS_EXTENSION_PING' }, PING_TIMEOUT_MS);
  if (!response.ok) {
    const error = responseError(response, 'extension_no_response', 'A bridge está ativa, mas a extensão não respondeu ao handshake.');
    updateDiagnostic({ checked: true, bridgeActive: true, extensionDetected: false, lastPingAt: new Date().toISOString(), lastError: { code: error.code, message: error.message } });
    throw error;
  }
  if (response.type !== 'GMAPS_EXTENSION_PONG') {
    const error = new GoogleMapsExtensionError('invalid_handshake_response', 'A extensão respondeu com um protocolo de handshake inválido.');
    updateDiagnostic({ checked: true, bridgeActive: true, extensionDetected: true, lastPingAt: new Date().toISOString(), lastError: { code: error.code, message: error.message } });
    throw error;
  }
  const extensionVersion = text(response.extensionVersion);
  if (!extensionVersion || !compatibleVersion(extensionVersion)) {
    const error = new GoogleMapsExtensionError('extension_version_incompatible', `Versão incompatível da extensão (${extensionVersion || 'não informada'}). Requerida: ${MIN_EXTENSION_VERSION} ou superior.`);
    updateDiagnostic({ checked: true, bridgeActive: true, extensionDetected: true, extensionVersion: extensionVersion || null, lastPingAt: new Date().toISOString(), lastError: { code: error.code, message: error.message } });
    throw error;
  }
  if (response.operationalAvailable !== true) {
    const error = new GoogleMapsExtensionError('operational_protocol_unavailable', 'A extensão foi detectada, mas o protocolo operacional não está disponível.');
    updateDiagnostic({ checked: true, bridgeActive: true, extensionDetected: true, extensionVersion, operationalAvailable: false, lastPingAt: new Date().toISOString(), lastError: { code: error.code, message: error.message } });
    throw error;
  }
  updateDiagnostic({
    checked: true,
    bridgeActive: true,
    extensionDetected: true,
    extensionVersion,
    operationalAvailable: true,
    configured: response.configured === true,
    lastPingAt: new Date().toISOString(),
    lastError: null,
  });
  return response;
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
  ping: pingExtension,

  getDiagnostic() {
    return { ...diagnostic };
  },

  subscribeDiagnostic(listener: (value: GoogleMapsExtensionDiagnostic) => void) {
    diagnosticListeners.add(listener);
    listener({ ...diagnostic });
    return () => {
      diagnosticListeners.delete(listener);
    };
  },

  describeError(error: unknown) {
    const code = error instanceof GoogleMapsExtensionError ? error.code : 'extension_internal_error';
    const message = error instanceof Error ? error.message : 'Falha interna ao comunicar com a extensão Google Maps.';
    const titles: Record<string, string> = {
      bridge_unavailable: 'Extensão não detectada',
      extension_runtime_unavailable: 'Bridge ativa, extensão sem resposta',
      extension_no_response: 'Extensão sem resposta',
      extension_empty_response: 'Resposta vazia da extensão',
      invalid_handshake_response: 'Handshake inválido',
      extension_version_incompatible: 'Extensão incompatível',
      operational_protocol_unavailable: 'Modo operacional indisponível',
      invalid_execution_identity: 'Execução inválida',
      subcategories_and_locations_required: 'Cobertura inválida',
      candidate_target_required: 'Meta inválida',
      operational_execution_in_progress_or_unsynced: 'Execução anterior pendente',
      invalid_configure_ack: 'Confirmação inválida',
    };
    return { code, title: titles[code] || 'Erro da extensão Google Maps', message };
  },

  async configure(execution: GoogleMapsExecutionConfig) {
    await pingExtension();
    const response = await bridgeRequest({ type: 'GMAPS_OPERATIONAL_CONFIGURE', execution });
    if (!response.ok) {
      const error = responseError(response, 'extension_configure_failed', 'Não foi possível configurar a extensão Google Maps.');
      updateDiagnostic({ lastError: { code: error.code, message: error.message } });
      throw error;
    }
    if (response.type !== 'GMAPS_OPERATIONAL_CONFIGURE_ACK' || response.configured !== true || response.executionId !== execution.executionId) {
      const error = new GoogleMapsExtensionError('invalid_configure_ack', 'A extensão não confirmou de forma válida a execução solicitada.');
      updateDiagnostic({ lastError: { code: error.code, message: error.message } });
      throw error;
    }
    updateDiagnostic({ configured: true, lastError: null });
    return response.state;
  },

  installSyncListener() {
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data as { source?: unknown; type?: unknown; requestId?: unknown; payload?: BridgeSyncRequest };
      if (message?.source === EXTENSION_SOURCE && message.type === 'bridge_ready') {
        updateDiagnostic({ bridgeActive: true });
        return;
      }
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
