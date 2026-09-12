export type QueuePreparationChannel = 'WhatsApp' | 'Instagram';

export type QueuePreparationFailure = {
  id: string;
  company?: string;
  reason: string;
};
