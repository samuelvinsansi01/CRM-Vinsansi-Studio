import { Check, RefreshCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Pagination, RowsPerPageControl, Tag, type ToastItem } from '../design-system/components';
import { useClientPagination } from '../hooks/useClientPagination';
import { queueReviewService, type QueueReviewBatch, type QueueReviewChannel, type QueueReviewItem } from '../services/queue-review';
import { externalHttpHref, instagramHref, mapsHref, whatsappHref } from '../utils/externalLinks';

function availabilityTag(available: boolean, href?: string, title?: string) {
  const tag = <Tag tone={available ? 'success' : 'neutral'}>{available ? 'Sim' : 'Não'}</Tag>;
  if (!available || !href) return tag;
  return <a className="availability-link" href={href} target="_blank" rel="noreferrer" title={title}>{tag}</a>;
}

function companyLink(item: QueueReviewItem) {
  const href = mapsHref(item.mapsUrl);
  if (!href) return <strong>{item.company}</strong>;
  return <a className="company-map-link" href={href} target="_blank" rel="noreferrer" title="Abrir perfil da empresa no Google Maps"><strong>{item.company}</strong></a>;
}

function channelAvailability(item: QueueReviewItem, channel: QueueReviewChannel) {
  if (channel === 'Instagram') {
    return availabilityTag(Boolean(item.instagram.trim()), instagramHref(item.instagram), 'Abrir Instagram');
  }
  const phone = item.whatsapp || item.phone;
  return availabilityTag(Boolean(String(phone).replace(/\D/g, '')), whatsappHref(phone), 'Abrir WhatsApp');
}

export function QueueReviewPanel({
  channel,
  scheduledDate,
  preferredResourceId = '',
  canPrepare,
  canInvalidate,
  onQueueChanged,
  onToast,
}: {
  channel: QueueReviewChannel;
  scheduledDate: string;
  preferredResourceId?: string;
  canPrepare: boolean;
  canInvalidate: boolean;
  onQueueChanged: () => void;
  onToast: (title: string, description: string, tone?: ToastItem['tone']) => void;
}) {
  const [batches, setBatches] = useState<QueueReviewBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [workingItem, setWorkingItem] = useState('');

  const refresh = useCallback(async () => {
    if (!preferredResourceId) {
      setBatches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setBatches(await queueReviewService.list(channel, preferredResourceId, scheduledDate));
    } catch (error) {
      onToast('Não foi possível carregar a revisão', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    } finally {
      setLoading(false);
    }
  }, [channel, onToast, preferredResourceId, scheduledDate]);

  useEffect(() => { void refresh(); }, [refresh, scheduledDate]);

  const currentBatch = batches[0];
  const reviewItems = useMemo(() => currentBatch?.items ?? [], [currentBatch]);
  const {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    totalPages,
    pageItems,
    resetPage,
  } = useClientPagination(reviewItems, 20);

  useEffect(() => { resetPage(); }, [preferredResourceId, scheduledDate, resetPage]);

  const pull = async () => {
    if (!canPrepare || !preferredResourceId) return;
    setPulling(true);
    try {
      const result = await queueReviewService.pullToCapacity(channel, scheduledDate, preferredResourceId);
      await refresh();
      const details = [
        `${result.batch.openCount}/${result.batch.targetCount} em revisão`,
        result.invalidatedByProvider ? `${result.invalidatedByProvider} sem WhatsApp` : '',
        result.redirectedToInstagram ? `${result.redirectedToInstagram} liberado(s) para Instagram` : '',
        result.exhausted ? 'base elegível esgotada' : '',
      ].filter(Boolean).join(' · ');
      onToast(`Revisão ${channel} atualizada`, details || 'A revisão já está na capacidade correta.', result.errors ? 'warning' : 'success');
    } catch (error) {
      onToast(`Não foi possível puxar ${channel}`, error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    } finally {
      setPulling(false);
    }
  };

  const approve = async (item: QueueReviewItem) => {
    if (!canPrepare) return;
    setWorkingItem(item.reviewItemId);
    try {
      await queueReviewService.approve(item, channel);
      await refresh();
      onQueueChanged();
      onToast('Lead aprovado', 'O lead entrou na Fila final e o pipeline canônico de snapshot foi preservado.', 'success');
    } catch (error) {
      onToast('Não foi possível aprovar', error instanceof Error ? error.message : 'Revise o lead e tente novamente.', 'danger');
    } finally {
      setWorkingItem('');
    }
  };

  const invalidate = async (item: QueueReviewItem) => {
    if (!canInvalidate) return;
    setWorkingItem(item.reviewItemId);
    try {
      await queueReviewService.invalidate(item, channel);
      await refresh();
      onQueueChanged();
      onToast(
        'Lead invalidado',
        channel === 'WhatsApp'
          ? 'A vaga foi liberada. Um novo lead só será puxado quando você clicar em Puxar WhatsApp.'
          : 'A vaga foi liberada e o próximo melhor lead voltou para a etapa de revisão.',
        'warning',
      );
    } catch (error) {
      onToast('Não foi possível invalidar', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    } finally {
      setWorkingItem('');
    }
  };

  return (
    <section className="queue-review-card">
      <div className="queue-review-card__header">
        <div>
          <h2>Revisão antes do disparo</h2>
          <p>Aprove cada lead individualmente. Só depois da aprovação ele entra na Fila final.</p>
        </div>
        <div className="queue-review-card__actions">
          <Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || pulling || !preferredResourceId} onClick={() => void refresh()}>Atualizar</Button>
          {canPrepare ? <Button loading={pulling} disabled={loading || pulling || !preferredResourceId} onClick={() => void pull()}>{preferredResourceId ? `Puxar ${channel}` : `Selecione ${channel === 'WhatsApp' ? 'um chip' : 'um perfil'}`}</Button> : null}
        </div>
      </div>

      {!preferredResourceId ? <div className="table-message">Selecione {channel === 'WhatsApp' ? 'um chip' : 'um perfil'} para revisar a fila.</div> : null}
      {preferredResourceId && loading && !batches.length ? <div className="table-message">Carregando revisão...</div> : null}
      {preferredResourceId && !loading && !batches.length ? <div className="table-message">Nenhum lead aguardando revisão para este recurso.</div> : null}

      {currentBatch ? (
        <div className="queue-review-batch">
          <div className="queue-review-batch__meta">
            <div>
              <strong>{currentBatch.resourceLabel}</strong>
              <span>{currentBatch.items.length}/{currentBatch.targetCount} lead(s) aguardando aprovação · {currentBatch.scheduledDate}</span>
            </div>
          </div>
          <div className="queue-review-table-wrap">
            <table className="queue-review-table">
              <colgroup>
                <col className="queue-review-col--position" />
                <col className="queue-review-col--company" />
                <col className="queue-review-col--branch" />
                <col className="queue-review-col--state" />
                <col className="queue-review-col--city" />
                <col className="queue-review-col--rating" />
                <col className="queue-review-col--reviews" />
                <col className="queue-review-col--channel" />
                <col className="queue-review-col--site" />
                <col className="queue-review-col--actions" />
              </colgroup>
              <thead><tr><th>#</th><th>Empresa</th><th>Ramo</th><th>Estado</th><th>Cidade</th><th>Nota</th><th>Avaliações</th><th>{channel}</th><th>Site</th><th>Ações</th></tr></thead>
              <tbody>
                {pageItems.map((item, index) => (
                  <tr key={item.reviewItemId}>
                    <td>{(page - 1) * rowsPerPage + index + 1}</td>
                    <td className="queue-review-table__company">{companyLink(item)}</td>
                    <td className="queue-review-table__wrap">{item.branch || '-'}</td>
                    <td>{item.state || '-'}</td>
                    <td className="queue-review-table__wrap">{item.city || '-'}</td>
                    <td>{item.rating.toFixed(1)}</td>
                    <td>{item.reviews.toLocaleString('pt-BR')}</td>
                    <td>{channelAvailability(item, channel)}</td>
                    <td>{availabilityTag(Boolean(item.website.trim()), externalHttpHref(item.website), 'Abrir site')}</td>
                    <td className="queue-review-table__action">
                      <div className="queue-review-actions">
                        {canPrepare ? (
                          <button className="queue-review-approve" type="button" title="Aprovar e enviar para a Fila final" disabled={workingItem === item.reviewItemId} onClick={() => void approve(item)}>
                            <Check size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                        {canInvalidate ? (
                          <button className="queue-review-invalidate" type="button" title="Invalidar lead" disabled={workingItem === item.reviewItemId} onClick={() => void invalidate(item)}>
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="queue-list-card__footer queue-review-card__footer">
            <div className="queue-list-card__footer-left">
              <RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />
              <small>Mostrando {pageItems.length} de {reviewItems.length} lead(s)</small>
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
