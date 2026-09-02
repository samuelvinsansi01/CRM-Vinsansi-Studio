import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { leadsRepository } from '../repositories/leads';
import { canTransitionCommercialStage, type CommercialStage, type CrmLead, type CrmLeadFilters, type CrmLeadSummary } from '../services/leads/crmLead.types';

const EMPTY_SUMMARY: CrmLeadSummary = {
  total: 0,
  imported: 0,
  review: 0,
  noContact: 0,
  queued: 0,
  sent: 0,
  invalid: 0,
  duplicates: 0,
  commercial: { aguardandoResposta: 0, aguardandoDesign: 0, designEnviado: 0, fechado: 0, recusado: 0 },
};

function commercialKey(stage: CommercialStage): keyof CrmLeadSummary['commercial'] {
  return ({
    aguardando_resposta: 'aguardandoResposta',
    aguardando_design: 'aguardandoDesign',
    design_enviado: 'designEnviado',
    fechado: 'fechado',
    recusado: 'recusado',
  } as const)[stage];
}

export function useCrmLeads(filters: CrmLeadFilters, page: number, pageSize: number) {
  const [items, setItems] = useState<CrmLead[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CrmLeadSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const stableFilters = useMemo(() => filters, [filters.search, filters.statusId, filters.channel, filters.commercialStage, filters.branchId, filters.state]);

  const load = useCallback(async (mode: 'load' | 'refresh' = 'load') => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (mode === 'load') setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const result = await leadsRepository.page(stableFilters, { page, pageSize });
      if (requestRef.current !== requestId) return;
      setItems(result.items);
      setTotal(result.total);
      setSummary(result.summary);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os leads.');
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [page, pageSize, stableFilters]);

  useEffect(() => { void load('load'); }, [load]);

  const setCommercialStage = useCallback(async (leadId: string, nextStage: CommercialStage) => {
    const before = items.find((item) => item.id === leadId);
    if (!before || before.statusId !== 5) throw new Error('Somente leads enviados podem receber estágio comercial.');
    const previousStage = before.commercialStage ?? 'aguardando_resposta';
    if (previousStage === nextStage) return;
    if (!canTransitionCommercialStage(previousStage, nextStage)) {
      throw new Error('Esse estágio não pode voltar nem pular etapas. Avance pela sequência comercial ou marque como Recusado.');
    }
    const now = new Date().toISOString();

    setItems((current) => current.map((item) => item.id === leadId ? { ...item, commercialStage: nextStage, commercialUpdatedAt: now } : item));
    setSummary((current) => {
      const next = { ...current, commercial: { ...current.commercial } };
      const previousKey = commercialKey(previousStage);
      const nextKey = commercialKey(nextStage);
      next.commercial[previousKey] = Math.max(0, next.commercial[previousKey] - 1);
      next.commercial[nextKey] += 1;
      return next;
    });

    try {
      const result = await leadsRepository.setCommercialStage(leadId, nextStage);
      const updatedAt = String(result.updatedAt ?? now);
      setItems((current) => current.map((item) => item.id === leadId ? { ...item, commercialStage: nextStage, commercialUpdatedAt: updatedAt } : item));
    } catch (err) {
      setItems((current) => current.map((item) => item.id === leadId ? before : item));
      setSummary((current) => {
        const next = { ...current, commercial: { ...current.commercial } };
        const previousKey = commercialKey(previousStage);
        const nextKey = commercialKey(nextStage);
        next.commercial[nextKey] = Math.max(0, next.commercial[nextKey] - 1);
        next.commercial[previousKey] += 1;
        return next;
      });
      throw err;
    }
  }, [items]);

  const setDesignDueDate = useCallback(async (leadId: string, designDueDate: string | null) => {
    const before = items.find((item) => item.id === leadId);
    const previous = before?.designDueDate ?? '';
    setItems((current) => current.map((item) => item.id === leadId ? { ...item, designDueDate: designDueDate ?? '' } : item));
    try {
      const result = await leadsRepository.setDesignDueDate(leadId, designDueDate);
      const saved = String(result.designDueDate ?? designDueDate ?? '');
      setItems((current) => current.map((item) => item.id === leadId ? { ...item, designDueDate: saved } : item));
    } catch (err) {
      setItems((current) => current.map((item) => item.id === leadId ? { ...item, designDueDate: previous } : item));
      throw err;
    }
  }, [items]);

  return {
    items,
    total,
    summary,
    loading,
    refreshing,
    error,
    refresh: () => load('refresh'),
    setCommercialStage,
    setDesignDueDate,
  };
}
