import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getSupabaseConfig, isSupabaseConfigured } from '../lib/supabase';

type ConfigContextValue = {
  source: 'supabase' | 'unavailable';
  ready: boolean;
};

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ConfigContextValue>(() => {
    const config = getSupabaseConfig();
    const ready = isSupabaseConfigured() && config.useSupabaseConfig && config.useSupabaseSettings;
    return { source: ready ? 'supabase' : 'unavailable', ready };
  }, []);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfigContext() {
  const context = useContext(ConfigContext);
  if (!context) throw new Error('useConfigContext deve ser usado dentro de ConfigProvider.');
  return context;
}
