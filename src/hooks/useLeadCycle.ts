import { useCallback, useEffect, useState } from 'react';
import { leadCycleService } from '../services/lead-cycle/leadCycle.service';
import type {
  LeadCycleLead,
  LeadCycleUpdate,
  LeadRoutingCommand,
  LeadRoutingResult,
} from '../services/lead-cycle/types';
import type { LeadStatusId } from '../types/lead.types';
import { whatsappValidationService } from '../services/whatsapp-validation/whatsappValidation.service';
import type { WhatsAppValidationBatchResult } from '../services/whatsapp-validation/types';

export type LeadCycleView = 'imported' | 'valid' | 'pre-send' | 'permanent';

const loaders = {
  imported: leadCycleService.listImported,
  valid: leadCycleService.listValid,
  'pre-send': leadCycleService.listPreSend,
  permanent: leadCycleService.listPermanent,
};

export function useLeadCycle(view: LeadCycleView) {
  const [records, setRecords] = useState<LeadCycleLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await loaders[view]());
    } catch (err) {
      setRecords([]);
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os leads.');
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { void refresh(); }, [refresh]);

  const executeRoutingCommand = useCallback(async (
    command: LeadRoutingCommand,
    ids: string[],
  ): Promise<LeadRoutingResult> => {
    setSaving(true);
    try {
      const result = await leadCycleService.executeRoutingCommand(command, ids);
      await refresh();
      return result;
    } finally {
      setSaving(false);
    }
  }, [refresh]);


  const validateWhatsApp = useCallback(async (ids: string[]): Promise<WhatsAppValidationBatchResult> => {
    setSaving(true);
    try {
      const result = await whatsappValidationService.validateInitial(ids);
      await refresh();
      return result;
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const revalidateWhatsApp = useCallback(async (ids: string[]): Promise<WhatsAppValidationBatchResult> => {
    setSaving(true);
    try {
      const result = await whatsappValidationService.revalidateApproved(ids);
      await refresh();
      return result;
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  /** Temporário: utilizado pelos fluxos ainda não migrados para comandos explícitos. */
  const update = useCallback(async (ids: string[], input: LeadCycleUpdate, expectedStatuses?: LeadStatusId[]) => {
    setSaving(true);
    try {
      await leadCycleService.update(ids, input, expectedStatuses);
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  return { records, loading, saving, error, refresh, executeRoutingCommand, validateWhatsApp, revalidateWhatsApp, update };
}
