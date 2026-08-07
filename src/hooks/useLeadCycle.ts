import { useCallback, useEffect, useState } from 'react';
import { leadCycleService } from '../services/lead-cycle/leadCycle.service';
import type {
  LeadCycleLead,
  LeadRoutingCommand,
  LeadRoutingResult,
} from '../services/lead-cycle/types';
import { whatsappValidationService } from '../services/whatsapp-validation/whatsappValidation.service';
import type { WhatsAppValidationBatchResult } from '../services/whatsapp-validation/types';

export type LeadCycleView = 'imported' | 'valid' | 'pre-send';

const loaders = {
  imported: leadCycleService.listImported,
  valid: leadCycleService.listValid,
  'pre-send': leadCycleService.listPreSend,
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


  return { records, loading, saving, error, refresh, executeRoutingCommand, validateWhatsApp, revalidateWhatsApp };
}
