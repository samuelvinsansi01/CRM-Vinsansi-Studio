import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';

type ConfigContextValue = {
  source: 'supabase' | 'unavailable';
  ready: boolean;
};

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ConfigContextValue>(() => {
    const ready = isSupabaseConfigured();
    return { source: ready ? 'supabase' : 'unavailable', ready };
  }, []);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfigContext() {
  const context = useContext(ConfigContext);
  if (!context) throw new Error('useConfigContext deve ser usado dentro de ConfigProvider.');
  return context;
}
