import { useCallback, useEffect, useState } from 'react';
import { whatsappQueueService } from '../services/whatsapp-queue/whatsappQueue.service';
import type { UpdateWhatsAppQueueLeadInput, WhatsAppQueueBatch, WhatsAppQueueLead, WhatsAppQueueSummary } from '../services/whatsapp-queue/types';

const emptySummary: WhatsAppQueueSummary = {
  total: 0,
  queued: 0,
  sent: 0,
  finished: 0,
  errors: 0,
};

export function useWhatsAppQueue(chip: string, scheduledDate: string) {
  const [chips, setChips] = useState<string[]>([]);
  const [batches, setBatches] = useState<WhatsAppQueueBatch[]>([]);
  const [summary, setSummary] = useState<WhatsAppQueueSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const nextChips = await whatsappQueueService.listChips();
        const safeChip = chip || nextChips[0] || '';
        const [nextBatches, nextSummary] = safeChip
          ? await Promise.all([
              whatsappQueueService.listBatches({ chip: safeChip, scheduledDate }),
              whatsappQueueService.summary({ chip: safeChip, scheduledDate }),
            ])
          : [[], emptySummary];

        if (!active) return;
        setChips(nextChips);
        setBatches(nextBatches);
        setSummary(nextSummary);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar fila WhatsApp.');
        setChips([]);
        setBatches([]);
        setSummary(emptySummary);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [chip, scheduledDate, refreshKey]);

  const updateLead = useCallback(
    async (id: string, input: UpdateWhatsAppQueueLeadInput) => {
      await whatsappQueueService.updateLead(id, input);
      refresh();
    },
    [refresh],
  );

  const send = useCallback(
    async (ids: string[]) => {
      await whatsappQueueService.send(ids);
      refresh();
    },
    [refresh],
  );

  const pause = useCallback(
    async (ids: string[]) => {
      await whatsappQueueService.pause(ids);
      refresh();
    },
    [refresh],
  );

  const resume = useCallback(
    async (ids: string[]) => {
      await whatsappQueueService.resume(ids);
      refresh();
    },
    [refresh],
  );

  const reprocess = useCallback(
    async (ids: string[]) => {
      await whatsappQueueService.reprocess(ids);
      refresh();
    },
    [refresh],
  );

  const invalidate = useCallback(
    async (lead: WhatsAppQueueLead) => {
      await whatsappQueueService.invalidate(lead.id);
      refresh();
    },
    [refresh],
  );

  return {
    chips,
    batches,
    summary,
    loading,
    error,
    refresh,
    updateLead,
    send,
    pause,
    resume,
    reprocess,
    invalidate,
  };
}
