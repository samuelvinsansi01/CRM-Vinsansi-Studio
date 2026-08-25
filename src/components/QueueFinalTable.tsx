import { Eye, Flag } from 'lucide-react';
import { Pagination, RowsPerPageControl, Tag } from '../design-system/components';
import { useClientPagination } from '../hooks/useClientPagination';
import { permissionsFor } from '../services/permissions';
import { statusLabel, statusTone } from '../services/status/status.mapper';
import { hasWhatsAppOperationalIssue } from '../services/whatsapp-queue/whatsappQueue.guards';
import type { WhatsAppQueueLead } from '../services/whatsapp-queue/types';
import type { InstagramQueueLead } from '../services/instagram-queue/types';
import { externalHttpHref, instagramHref, mapsHref, whatsappHref } from '../utils/externalLinks';

type FinalLead = WhatsAppQueueLead | InstagramQueueLead;

function availability(available: boolean, href?: string, title?: string) {
  const tag = <Tag tone={available ? 'success' : 'neutral'}>{available ? 'Sim' : 'Não'}</Tag>;
  if (!available || !href) return tag;
  return <a className="availability-link" href={href} target="_blank" rel="noreferrer" title={title}>{tag}</a>;
}

function company(lead: FinalLead) {
  const href = mapsHref(lead.mapsUrl);
  if (!href) return <strong>{lead.company}</strong>;
  return <a className="company-map-link" href={href} target="_blank" rel="noreferrer" title="Abrir perfil da empresa no Google Maps"><strong>{lead.company}</strong></a>;
}

function channelCell(lead: FinalLead) {
  if (lead.channel === 'instagram') {
    const value = lead.instagram_username || lead.instagram || lead.instagram_url || '';
    return availability(Boolean(String(value).trim()), instagramHref(value), 'Abrir Instagram');
  }
  return availability(Boolean(String(lead.phone).replace(/\D/g, '')), whatsappHref(lead.phone), 'Abrir WhatsApp');
}

function queueStatus(lead: FinalLead) {
  const issue = lead.channel === 'whatsapp' && hasWhatsAppOperationalIssue(lead);
  return <Tag tone={issue ? 'danger' : statusTone(lead.status)}>{issue ? 'Dados incompletos' : statusLabel(lead.status)}</Tag>;
}

export function QueueFinalTable({
  channel,
  leads,
  canInvalidate,
  onView,
  onInvalidate,
}: {
  channel: 'WhatsApp' | 'Instagram';
  leads: FinalLead[];
  canInvalidate: boolean;
  onView: (lead: FinalLead) => void;
  onInvalidate: (lead: FinalLead) => void;
}) {
  const {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    totalPages,
    pageItems,
  } = useClientPagination(leads, 20);

  if (!leads.length) return <div className="table-message">Nenhum item aprovado para este recurso.</div>;

  return (
    <>
      <div className="queue-final-table-wrap">
        <table className="queue-final-table">
          <colgroup>
            <col className="queue-final-col--position" />
            <col className="queue-final-col--company" />
            <col className="queue-final-col--branch" />
            <col className="queue-final-col--state" />
            <col className="queue-final-col--city" />
            <col className="queue-final-col--rating" />
            <col className="queue-final-col--reviews" />
            <col className="queue-final-col--channel" />
            <col className="queue-final-col--site" />
            <col className="queue-final-col--status" />
            <col className="queue-final-col--actions" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th><th>Empresa</th><th>Ramo</th><th>Estado</th><th>Cidade</th><th>Nota</th><th>Avaliações</th><th>{channel}</th><th>Site</th><th>Status</th><th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((lead) => {
              const canInvalidateLead = lead.channel === 'whatsapp'
                ? permissionsFor('whatsapp-queue', lead.status).canInvalidate()
                : permissionsFor('instagram-queue', lead.status).canInvalidate();
              return (
                <tr key={lead.id}>
                  <td>{lead.position}</td>
                  <td className="queue-final-table__company">{company(lead)}</td>
                  <td className="queue-final-table__wrap">{lead.branch || '-'}</td>
                  <td>{lead.state || '-'}</td>
                  <td className="queue-final-table__wrap">{lead.city || '-'}</td>
                  <td>{Number(lead.rating || 0).toFixed(1)}</td>
                  <td>{Number(lead.reviews || 0).toLocaleString('pt-BR')}</td>
                  <td>{channelCell(lead)}</td>
                  <td>{availability(Boolean(String(lead.site || '').trim()), externalHttpHref(lead.site), 'Abrir site')}</td>
                  <td>{queueStatus(lead)}</td>
                  <td className="queue-final-table__actions">
                    <button type="button" className="queue-table-action queue-table-action--view" onClick={() => onView(lead)} aria-label="Visualizar lead" title="Visualizar lead"><Eye size={16} /></button>
                    <button type="button" className="queue-table-action queue-table-action--danger" disabled={!canInvalidate || !canInvalidateLead} onClick={() => onInvalidate(lead)} aria-label="Invalidar lead" title="Invalidar lead"><Flag size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="queue-list-card__footer">
        <div className="queue-list-card__footer-left">
          <RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />
          <small>Mostrando {pageItems.length} de {leads.length} lead(s)</small>
        </div>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </>
  );
}
