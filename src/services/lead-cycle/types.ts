import type { LeadStatusId, LeadStatusName } from '../../types/lead.types';

export type LeadCycleChannel = 'WhatsApp' | 'Instagram';

export type LeadCycleLead = {
  id: string;
  company: string;
  branch: string;
  state: string;
  city: string;
  phone: string;
  instagram: string;
  website: string;
  mapsUrl: string;
  channelId: 1 | 2;
  channel: LeadCycleChannel;
  contactSourceId: number;
  contactSource: string;
  statusId: LeadStatusId;
  status: LeadStatusName;
  createdAt: string;
  updatedAt: string;
};

/**
 * Atualização genérica mantida temporariamente para fluxos ainda não migrados.
 * O F04 não utiliza esta API; todas as ações da triagem passam por comandos explícitos.
 */
export type LeadCycleUpdate = Partial<{
  leads_name: string;
  leads_phone: string | null;
  leads_instagram: string | null;
  leads_website: string | null;
  leads_maps: string | null;
  channels_id: 1 | 2;
  lead_status_id: LeadStatusId;
}>;

export type LeadRoutingCommand =
  | 'route-imported-to-whatsapp'
  | 'route-imported-to-instagram'
  | 'invalidate-imported'
  | 'archive-imported'
  | 'set-valid-channel-whatsapp'
  | 'set-valid-channel-instagram'
  | 'archive-valid'
  | 'invalidate-pre-send'
  | 'archive-pre-send';

export type LeadRoutingFailure = {
  id: string;
  company?: string;
  reason: string;
};

export type LeadRoutingResult = {
  command: LeadRoutingCommand;
  requested: number;
  succeeded: number;
  unchanged: number;
  failed: number;
  succeededIds: string[];
  unchangedIds: string[];
  failures: LeadRoutingFailure[];
  auditWarnings: string[];
};
