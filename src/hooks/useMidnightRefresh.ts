import { useEffect } from 'react';

/**
 * Dispara um refresh logo após a virada do dia local e rearma o timer.
 * O rollover em si continua idempotente nos services; este hook só garante
 * que uma tela que permaneceu aberta durante a meia-noite processe a virada.
 */
export function useMidnightRefresh(refresh: () => void) {
  useEffect(() => {
    let timer = 0;
    let disposed = false;

    const arm = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 1, 0);
      const delay = Math.max(1_000, next.getTime() - now.getTime());
      timer = window.setTimeout(() => {
        if (disposed) return;
        refresh();
        arm();
      }, delay);
    };

    arm();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [refresh]);
}
