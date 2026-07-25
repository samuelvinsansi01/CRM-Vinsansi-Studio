export type LeadCertoEventMap = {
  'config:changed': { kind: 'chips' | 'instagram' | 'branches' | 'templates' };
  'import-settings:changed': { source: 'settings' | 'reset' | 'branches' };
  'dispatch-settings:changed': { source: 'settings' | 'reset' };
  'import:changed': { source: 'manual' | 'json' | 'move' | 'remove' | 'update' | 'pre-send' | 'mark-sent' };
  'pre-send:changed': { action: 'move-to-queue' | 'validate' | 'archive' | 'update' | 'sent' | 'rollover' | 'fill' | 'whatsapp-invalid-return' | 'whatsapp-validation-review' | 'whatsapp-revalidate' | 'whatsapp-revalidation-review' };
  'whatsapp-queue:changed': { action: 'send' | 'pause' | 'resume' | 'reprocess' | 'invalidate' | 'update' | 'sending' | 'worker-sent' | 'error' };
  'instagram-queue:changed': { action: 'send' | 'pause' | 'resume' | 'reprocess' | 'invalidate' | 'update' | 'sending' | 'worker-sent' | 'error' };
  'base:changed': { action: 'update' | 'archive' | 'restore' | 'remove' | 'status' };
  'toast:push': { type: 'success' | 'error' | 'warning' | 'info'; message: string };
};

type EventName = keyof LeadCertoEventMap;
type EventHandler<T extends EventName> = (payload: LeadCertoEventMap[T]) => void;

const listeners = new Map<EventName, Set<(payload: LeadCertoEventMap[EventName]) => void>>();

export const eventBus = {
  on<T extends EventName>(eventName: T, handler: EventHandler<T>) {
    const handlers = listeners.get(eventName) ?? new Set();
    handlers.add(handler as (payload: LeadCertoEventMap[EventName]) => void);
    listeners.set(eventName, handlers);

    return () => {
      handlers.delete(handler as (payload: LeadCertoEventMap[EventName]) => void);
      if (!handlers.size) listeners.delete(eventName);
    };
  },

  emit<T extends EventName>(eventName: T, payload: LeadCertoEventMap[T]) {
    listeners.get(eventName)?.forEach((handler) => handler(payload));
  },

  clear() {
    listeners.clear();
  },
};
