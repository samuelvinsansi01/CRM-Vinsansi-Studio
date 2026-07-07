import { useCallback, useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    const timer = window.setInterval(refresh, 8_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let active = true;

    async function load() {
      const isInitialLoad = !hasLoadedRef.current;
      if (isInitialLoad) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const nextChips = await whatsappQueueService.listChips();
        const safeChip = chip || nextChips[0] || '';
        const [nextBatches, nextSummary, nextBatchState] = safeChip
          ? await Promise.all([
              whatsappQueueService.listBatches({ chip: safeChip, scheduledDate }),
              whatsappQueueService.summary({ chip: safeChip, scheduledDate }),
              whatsappQueueService.getBatchStatus(safeChip),
            ])
          : [emptyBatches, emptySummary, idleBatchState];

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

  const invalidate = useCallback(async (lead: WhatsAppQueueLead) => {
    await whatsappQueueService.invalidate(lead.id);
    refresh();
  }, [refresh]);

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
    invalidate,
  };
}
