export type QueueReviewChannel = 'WhatsApp' | 'Instagram';
export type QueueReviewPresenceFilter = 'any' | 'with' | 'without';

export type QueueReviewPullFilters = {
  site: QueueReviewPresenceFilter;
  instagram: QueueReviewPresenceFilter;
  branchIds: string[];
};

export type QueueReviewBranch = {
  id: string;
  name: string;
};

export type QueueReviewResource = {
  id: string;
  label: string;
  channel: QueueReviewChannel;
  dailyLimit: number;
  finalUsed: number;
  reviewOpen: number;
  used: number;
  available: number;
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
  mapsUrl: string;
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
  scheduledDate: string;
  resource: QueueReviewResource;
  resourceSelectionKey: string;
  capacityToFill: number;
  reserved: number;
  ready: number;
  invalidatedByProvider: number;
  redirectedToInstagram: number;
  errors: number;
  exhausted: boolean;
  technicalStop: boolean;
  technicalReasons: string[];
  movedLeadIds: string[];
  redirectedLeadIds: string[];
};

export type QueueReviewPullPreview = {
  scheduledDate: string;
  resource: QueueReviewResource;
  eligible: number;
  willPull: number;
};


export type QueueReviewPage = {
  batches: QueueReviewBatch[];
  total: number;
  page: number;
  pageSize: number;
};
