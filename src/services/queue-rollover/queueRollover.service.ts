import { getSupabaseClient } from '../../lib/supabase';
import { toLocalDateInputValue } from '../../utils/date';

export type QueueRolloverResult = {
  targetDate: string;
  finalQueueMoved: number;
  reviewMoved: number;
};

let inFlight: Promise<QueueRolloverResult> | null = null;
let inFlightDate = '';
let lastCompletedDate = '';

function normalizeResult(value: unknown, targetDate: string): QueueRolloverResult {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    targetDate: String(row.targetDate ?? row.target_date ?? targetDate),
    finalQueueMoved: Math.max(0, Number(row.finalQueueMoved ?? row.final_queue_moved ?? 0)),
    reviewMoved: Math.max(0, Number(row.reviewMoved ?? row.review_moved ?? 0)),
  };
}

async function execute(targetDate: string) {
  const { data, error } = await getSupabaseClient().rpc('rollover_pending_queue_work', {
    p_target_date: targetDate,
  });
  if (error) throw new Error(`Não foi possível virar as pendências para o dia atual: ${error.message}`);
  return normalizeResult(data, targetDate);
}

export const queueRolloverService = {
  async run(targetDate = toLocalDateInputValue(), options: { force?: boolean } = {}) {
    if (!options.force && lastCompletedDate === targetDate) {
      return { targetDate, finalQueueMoved: 0, reviewMoved: 0 } satisfies QueueRolloverResult;
    }
    if (inFlight && inFlightDate === targetDate) return inFlight;
    inFlightDate = targetDate;
    inFlight = execute(targetDate)
      .then((result) => {
        lastCompletedDate = targetDate;
        return result;
      })
      .finally(() => {
        inFlight = null;
        inFlightDate = '';
      });
    return inFlight;
  },
};
