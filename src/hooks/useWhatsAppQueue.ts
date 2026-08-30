import { useCallback, useEffect, useRef, useState } from 'react';
import { useMidnightRefresh } from './useMidnightRefresh';
import { whatsappQueueService } from '../services/whatsapp-queue/whatsappQueue.service';
import type { WhatsAppBatchState } from '../services/whatsapp-queue/whatsapp.batch.gateway';
import type { UpdateWhatsAppQueueLeadInput, WhatsAppQueueBatch, WhatsAppQueueLead, WhatsAppQueueSummary } from '../services/whatsapp-queue/types';

const emptySummary: WhatsAppQueueSummary = {
  total: 0,
  queued: 0,
  sent: 0,
  finished: 0,
  errors: 0,
};

const emptyBatches: WhatsAppQueueBatch[] = [];

const idleBatchState: WhatsAppBatchState = {
  status: 'idle',
  enabled: false,
  chip: '',
  total: 0,
  remaining: 0,
};

function aggregateBatchStates(states: WhatsAppBatchState[], chips: string[]): WhatsAppBatchState {
  const activeStates = states.filter((state) => state.status !== 'idle' || state.enabled || state.total || state.remaining);
  if (!activeStates.length) return { ...idleBatchState, chip: '' };

  const status = activeStates.some((state) => state.status === 'running')
    ? 'running'
    : activeStates.some((state) => state.status === 'paused')
      ? 'paused'
      : activeStates.some((state) => state.status === 'error')
        ? 'error'
        : activeStates.every((state) => state.status === 'completed')
          ? 'completed'
          : activeStates[0]?.status ?? 'idle';

  const nextRunAt = activeStates
    .map((state) => state.next_run_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  return {
    status,
    enabled: status === 'running' || status === 'paused',
    chip: '',
    total: activeStates.reduce((sum, state) => sum + Number(state.total || 0), 0),
    remaining: activeStates.reduce((sum, state) => sum + Number(state.remaining || 0), 0),
    processed: activeStates.reduce((sum, state) => sum + Number(state.processed || 0), 0),
    sent: activeStates.reduce((sum, state) => sum + Number(state.sent || 0), 0),
    failed: activeStates.reduce((sum, state) => sum + Number(state.failed || 0), 0),
    next_run_at: nextRunAt ?? '',
    last_error: activeStates.find((state) => state.last_error)?.last_error ?? '',
    already_running: activeStates.some((state) => state.already_running),
    block_number: undefined,
    sent_in_block: undefined,
    started_at: activeStates.map((state) => state.started_at).filter(Boolean).sort()[0] ?? '',
  };
}

async function batchStatusForScope(chip: string, chips: string[]): Promise<WhatsAppBatchState> {
  if (chip) return whatsappQueueService.getBatchStatus(chip);
  if (!chips.length) return idleBatchState;

  const settled = await Promise.allSettled(chips.map((item) => whatsappQueueService.getBatchStatus(item)));
  const states = settled
    .filter((result): result is PromiseFulfilledResult<WhatsAppBatchState> => result.status === 'fulfilled')
    .map((result) => result.value);

  return aggregateBatchStates(states, chips);
}

export function useWhatsAppQueue(chip: string, scheduledDate: string) {
  const [chips, setChips] = useState<string[]>([]);
  const [batches, setBatches] = useState<WhatsAppQueueBatch[]>([]);
  const [summary, setSummary] = useState<WhatsAppQueueSummary>(emptySummary);
  const [batchState, setBatchState] = useState<WhatsAppBatchState>(idleBatchState);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);
  useMidnightRefresh(refresh);

  // A tela só consulta automaticamente enquanto existe um lote realmente em execução.
  // Quando o Worker conclui todos os itens, o status muda para completed e o timer
  // é removido; assim a interface não continua exibindo atualização sem necessidade.
  const shouldPoll = batchState.enabled && batchState.status === 'running';

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(refresh, 8_000);
    return () => window.clearInterval(timer);
  }, [refresh, shouldPoll]);

  useEffect(() => {
    let active = true;

    async function load() {
      const isInitialLoad = !hasLoadedRef.current;
      if (isInitialLoad) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const nextChips = await whatsappQueueService.listChips();
        const [nextBatches, nextSummary, nextBatchState] = chip
          ? await Promise.all([
              whatsappQueueService.listBatches({ chip, scheduledDate }),
              whatsappQueueService.summary({ chip, scheduledDate }),
              batchStatusForScope(chip, nextChips),
            ])
          : [[], emptySummary, idleBatchState];

        if (!active) return;
        setChips(nextChips);
        setBatches(nextBatches);
        setSummary(nextSummary);
        setBatchState(nextBatchState);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar fila WhatsApp.');
        if (isInitialLoad) {
          setChips([]);
          setBatches([]);
          setSummary(emptySummary);
          setBatchState(idleBatchState);
        }
      } finally {
        if (active) {
          hasLoadedRef.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => { active = false; };
  }, [chip, scheduledDate, refreshKey]);

  const updateLead = useCallback(async (id: string, input: UpdateWhatsAppQueueLeadInput) => {
    await whatsappQueueService.updateLead(id, input);
    refresh();
  }, [refresh]);

  const send = useCallback(async (ids: string[]) => {
    await whatsappQueueService.send(ids);
    refresh();
  }, [refresh]);

  const startBatch = useCallback(async (ids: string[]) => {
    const state = await whatsappQueueService.startBatch(ids);
    setBatchState(state);
    refresh();
    return state;
  }, [refresh]);

  const pauseBatch = useCallback(async (targetChip?: string) => {
    const state = await whatsappQueueService.pauseBatch(targetChip);
    setBatchState(state);
    refresh();
    return state;
  }, [refresh]);

  const resumeBatch = useCallback(async (targetChip?: string) => {
    const state = await whatsappQueueService.resumeBatch(targetChip);
    setBatchState(state);
    refresh();
    return state;
  }, [refresh]);

  const stopBatch = useCallback(async (targetChip?: string) => {
    const state = await whatsappQueueService.stopBatch(targetChip);
    setBatchState(state);
    refresh();
    return state;
  }, [refresh]);

  const pause = useCallback(async (ids: string[]) => {
    await whatsappQueueService.pause(ids);
    refresh();
  }, [refresh]);

  const resume = useCallback(async (ids: string[]) => {
    await whatsappQueueService.resume(ids);
    refresh();
  }, [refresh]);

  const reprocess = useCallback(async (ids: string[]) => {
    await whatsappQueueService.reprocess(ids);
    refresh();
  }, [refresh]);

  const patchLeadLocally = useCallback((id: string, patch: Partial<WhatsAppQueueLead>) => {
    setBatches((current) => current.map((batch) => ({
      ...batch,
      leads: batch.leads.map((lead) => lead.id === id ? { ...lead, ...patch } : lead),
    })));
  }, []);

  const invalidate = useCallback(async (lead: WhatsAppQueueLead) => {
    await whatsappQueueService.invalidate(lead.id);
    setBatches((current) => current
      .map((batch) => ({ ...batch, leads: batch.leads.filter((candidate) => candidate.id !== lead.id) }))
      .filter((batch) => batch.leads.length > 0));
    setSummary((current) => ({
      ...current,
      total: Math.max(0, current.total - 1),
      queued: Math.max(0, current.queued - (['queued', 'paused', 'sending'].includes(lead.status) ? 1 : 0)),
      sent: current.sent,
      finished: current.finished,
      errors: Math.max(0, current.errors - (lead.status === 'error' ? 1 : 0)),
    }));
  }, []);

  return {
    chips,
    batches,
    summary,
    batchState,
    loading,
    refreshing,
    error,
    refresh,
    updateLead,
    send,
    startBatch,
    pauseBatch,
    resumeBatch,
    stopBatch,
    pause,
    resume,
    reprocess,
    patchLeadLocally,
    invalidate,
  };
}
