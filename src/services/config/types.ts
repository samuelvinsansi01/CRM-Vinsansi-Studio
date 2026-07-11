export type ConfigKind = 'chips' | 'instagram' | 'branches' | 'templates';

export type ConfigStatus = 'Ativo' | 'Inativo' | 'Arquivado' | 'deleted';

export type TemplateType = 'sem-site' | 'com-site';
export type TemplateChannel = 'WhatsApp' | 'Instagram' | 'Geral';

type ConfigBaseRecord = {
  id: string;
  kind: ConfigKind;
  status: ConfigStatus;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type BranchConfigRecord = ConfigBaseRecord & {
  kind: 'branches';
  slug: string;
  name: string;
  category: string;
  subcategories: string[];
  associatedCategories: string[];
  order: number;
  minRating: number;
  minReviews: number;
  imageName: string;
  /** Define se o Worker deve bloquear o disparo quando a imagem do ramo nao estiver disponivel. */
  imageRequired: boolean;
};

export type TemplateConfigRecord = ConfigBaseRecord & {
  kind: 'templates';
  branchId: string;
  branchName: string;
  channel: TemplateChannel;
  type: TemplateType;
  message1: string;
  message2: string;
  message3: string;
  message4: string;
  preview: string;
};

export type ChipConfigRecord = ConfigBaseRecord & {
  kind: 'chips';
  name: string;
  number: string;
  level: string;
  url: string;
  instance: string;
  apiKey: string;
  connectionStatus: string;
  priority: number;
  startTime: string;
  endTime: string;
  dailyLimit: number;
  intervalSeconds: number;
  blockSize: number;
  batches: string[];
  paused: boolean;
};

export type InstagramConfigRecord = ConfigBaseRecord & {
  kind: 'instagram';
  name: string;
  username: string;
};

export type ConfigRecord = BranchConfigRecord | TemplateConfigRecord | ChipConfigRecord | InstagramConfigRecord;

export type CreateConfigRecordInput = Record<string, unknown>;
export type UpdateConfigRecordInput = Record<string, unknown>;

export type ConfigListFilters = {
  search?: string;
  status?: string;
};
