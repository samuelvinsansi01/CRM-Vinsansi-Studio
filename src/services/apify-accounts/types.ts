export type ApifyAccount = {
  id: number;
  name: string;
  active: boolean;
  tokenMask: string;
  connectionStatus: 'not_verified' | 'connected' | 'error';
  externalUsername: string;
  lastCheckedAt: string | null;
  lastUsedAt: string | null;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveApifyAccountInput = {
  id?: number;
  name: string;
  token?: string;
  active: boolean;
};
