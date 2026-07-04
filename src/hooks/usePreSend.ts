import { useCallback, useEffect, useMemo, useState } from 'react';
import { eventBus } from '../lib/events';
import { preSendService } from '../services/pre-send/preSend.service';
import type { PreSendChannel, PreSendDayCard, PreSendLead, PreSendQueueFilter, PreSendSummary } from '../services/pre-send/types';

const emptySummary: PreSendSummary = {
  whatsapp: 0,
  instagram: 0,
  total: 0,
  queued: 0,
};

export function usePreSend() {
  const [dayCards, setDayCards] = useState<PreSendDayCard[]>([]);
  const [summary, setSummary] = useState<PreSendSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    const offPreSend = eventBus.on('pre-send:changed', refresh);
    const offDispatch = eventBus.on('dispatch-settings:changed', refresh);

    return () => {
      offPreSend();
      offDispatch();
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [nextDays, nextSummary] = await Promise.all([preSendService.listDayCards(), preSendService.summary()]);
        if (!active) return;
        setDayCards(nextDays);
        setSummary(nextSummary);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar pre-envio.');
        setDayCards([]);
        setSummary(emptySummary);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const defaultDayId = useMemo(() => dayCards.find((day) => day.queued > 0)?.id ?? dayCards[0]?.id ?? '', [dayCards]);

  const moveToQueue = useCallback(
    async (ids: string[], options?: Parameters<typeof preSendService.moveToQueue>[1]) => {
      const moved = await preSendService.moveToQueue(ids, options);
      refresh();
      return moved;
    },
    [refresh],
  );

  const moveDayToQueue = useCallback(
    async (input: Parameters<typeof preSendService.moveDayToQueue>[0]) => {
      await preSendService.moveDayToQueue(input);
      refresh();
    },
    [refresh],
  );

  const moveInstagramDayToQueue = useCallback(
    async (input: Parameters<typeof preSendService.moveInstagramDayToQueue>[0]) => {
      await preSendService.moveInstagramDayToQueue(input);
      refresh();
    },
    [refresh],
  );

  const moveApprovedImportsToQueue = useCallback(
    async (input: Parameters<typeof preSendService.moveApprovedImportsToQueue>[0]) => {
      const moved = await preSendService.moveApprovedImportsToQueue(input);
      refresh();
      return moved;
    },
    [refresh],
  );

  const returnDayToImport = useCallback(
    async (input: Parameters<typeof preSendService.returnDayToImport>[0]) => {
      await preSendService.returnDayToImport(input);
      refresh();
    },
    [refresh],
  );

  const validateLead = useCallback(
    async (id: string) => {
      await preSendService.validateLead(id);
      refresh();
    },
    [refresh],
  );

  const archiveLead = useCallback(
    async (id: string) => {
      await preSendService.archiveLead(id);
      refresh();
    },
    [refresh],
  );

  const markAlreadySent = useCallback(
    async (ids: string[], reason?: string) => {
      const marked = await preSendService.markAlreadySent(ids, reason);
      refresh();
      return marked;
    },
    [refresh],
  );

  const updateLead = useCallback(
    async (id: string, input: Partial<PreSendLead>) => {
      await preSendService.updateLead(id, input);
      refresh();
    },
    [refresh],
  );

  return {
    dayCards,
    summary,
    loading,
    error,
    defaultDayId,
    refresh,
    moveToQueue,
    moveDayToQueue,
    moveInstagramDayToQueue,
    moveApprovedImportsToQueue,
    returnDayToImport,
    validateLead,
    archiveLead,
    markAlreadySent,
    updateLead,
  };
}

export function usePreSendQueue(channel: PreSendChannel, dayId: string, profile: string, queueFilter: PreSendQueueFilter, refreshToken = 0) {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [leads, setLeads] = useState<PreSendLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const nextProfiles = await preSendService.listProfiles(channel);
        const safeProfile = profile || nextProfiles[0] || '';
        const nextLeads = channel === 'WhatsApp' && !safeProfile
          ? []
          : await preSendService.listLeads({ channel, dayId, profile: safeProfile, queueFilter });

        if (!active) return;
        setProfiles(nextProfiles);
        setLeads(nextLeads);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar fila de pre-envio.');
        setProfiles([]);
        setLeads([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [channel, dayId, profile, queueFilter, refreshToken]);

  return { profiles, leads, loading, error };
}
