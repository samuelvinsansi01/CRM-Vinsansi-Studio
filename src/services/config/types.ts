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
  /** Conteudo fisico de public.branches.branches_categories. */
  categories: unknown;
  slug: string;
  name: string;
  category: string;
  subcategories: string[];
  associatedCategories: string[];
  order: number;
  minRating: number;
  minReviews: number;
  stockTargetWhatsapp: number;
  stockTargetInstagram: number;
  imageName: string;
  /** Define se o Worker deve bloquear o disparo quando a imagem do ramo nao estiver disponivel. */
  imageRequired: boolean;
};

export type TemplateConfigRecord = ConfigBaseRecord & {
  kind: 'templates';
  name: string;
  branchId: string;
  branchName: string;
  templateChannelId: string;
  templateChannelName: string;
  templateTypeId: string;
  templateTypeName: string;
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
  instanceId: string;
  levelId: string;
  level: string;
  url: string;
  instance: string;
  apiKey: string;
  connectionStatus: string;
  administrativelyActive: boolean;
  operationalState: 'online' | 'reconnecting' | 'session_saved' | 'disconnected' | 'unavailable' | 'unknown';
  sessionSaved: boolean;
  socketConnected: boolean;
  jid: string;
  runtimeCheckedAt: string;
  runtimeError: string;
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
  levelId: string;
  levelName: string;
  dailyLimit: number;
};

export type ConfigRecord = BranchConfigRecord | TemplateConfigRecord | ChipConfigRecord | InstagramConfigRecord;

export type CreateConfigRecordInput = Record<string, unknown>;
export type UpdateConfigRecordInput = Record<string, unknown>;

export type ConfigListFilters = {
  search?: string;
  status?: string;
};
