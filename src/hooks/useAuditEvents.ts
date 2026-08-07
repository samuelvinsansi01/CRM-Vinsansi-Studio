import { useCallback, useEffect, useState } from 'react';
import { repositories } from '../repositories';
import type { EventLogRecord } from '../repositories/events';

export function useAuditEvents(limit = 200) {
  const [events, setEvents] = useState<EventLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await repositories.events.list(limit));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar o histórico de auditoria.');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { events, loading, error, refresh };
}
