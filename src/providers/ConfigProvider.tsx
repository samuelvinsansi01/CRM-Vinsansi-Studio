import { createContext, useContext, useMemo, type ReactNode } from 'react';

type ConfigContextValue = {
  source: 'mock' | 'supabase';
  setSource: (source: 'mock' | 'supabase') => void;
};

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ConfigContextValue>(() => ({
    source: 'mock',
    setSource: () => undefined,
  }), []);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfigContext() {
  const context = useContext(ConfigContext);
  if (!context) throw new Error('useConfigContext deve ser usado dentro de ConfigProvider.');
  return context;
}
