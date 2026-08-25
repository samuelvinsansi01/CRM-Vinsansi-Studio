import type { QueuePreparationChannel, QueuePreparationResource } from '../queue-preparation';

export type QueueReviewChannel = QueuePreparationChannel;

export type QueueReviewOpenBatch = {
  batchId: string;
  channel: 'whatsapp' | 'instagram';
  resourceId: string;
  scheduledDate: string;
  dailyLimit: number;
  used: number;
  targetCount: number;
  openCount: number;
  missingCount: number;
};

export type QueueReviewItem = {
  batchId: string;
  reviewItemId: string;
  channel: 'whatsapp' | 'instagram';
  resourceId: string;
  scheduledDate: string;
  targetCount: number;
  leadId: string;
  position: number;
  company: string;
  branchId: string;
  branch: string;
  city: string;
  state: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  website: string;
  rating: number;
  reviews: number;
};

export type QueueReviewBatch = {
  batchId: string;
  channel: QueueReviewChannel;
  resourceId: string;
  resourceLabel: string;
  scheduledDate: string;
  targetCount: number;
  items: QueueReviewItem[];
};

export type QueueReviewPullResult = {
  batch: QueueReviewOpenBatch;
  resource: QueuePreparationResource;
  added: number;
  invalidatedByProvider: number;
  redirectedToInstagram: number;
  errors: number;
  exhausted: boolean;
};
