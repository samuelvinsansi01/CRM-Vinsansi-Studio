import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type UIContextValue = {
  isBusy: boolean;
  setBusy: (value: boolean) => void;
  activeOverlay: string | null;
  setActiveOverlay: (value: string | null) => void;
};

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [isBusy, setBusy] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);

  const value = useMemo(() => ({ isBusy, setBusy, activeOverlay, setActiveOverlay }), [activeOverlay, isBusy]);
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUIContext() {
  const context = useContext(UIContext);
  if (!context) throw new Error('useUIContext deve ser usado dentro de UIProvider.');
  return context;
}
