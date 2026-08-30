import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DataTable, RowsPerPageControl, TableCard, Tag, type TableAction, type TableColumn, type ToastItem } from '../design-system/components';
import { useClientPagination } from '../hooks/useClientPagination';
import { queueReviewService, type QueueReviewBatch, type QueueReviewChannel, type QueueReviewItem } from '../services/queue-review';
import { externalHttpHref, instagramHref, mapsHref, whatsappHref } from '../utils/externalLinks';

type ReviewRow = Record<string, ReactNode> & { id: string };

function availabilityTag(available: boolean, href?: string, title?: string) {
  const tag = <Tag tone={available ? 'success' : 'neutral'}>{available ? 'Sim' : 'Não'}</Tag>;
  if (!available || !href) return tag;
  return <a className="availability-link" href={href} target="_blank" rel="noreferrer" title={title}>{tag}</a>;
}

function companyLink(item: QueueReviewItem) {
  const href = mapsHref(item.mapsUrl);
  if (!href) return <strong title={item.company}>{item.company}</strong>;
  return <a className="company-map-link" href={href} target="_blank" rel="noreferrer" title={`Abrir ${item.company} no Google Maps`}><strong>{item.company}</strong></a>;
}

function channelAvailability(item: QueueReviewItem, channel: QueueReviewChannel) {
  if (channel === 'Instagram') return availabilityTag(Boolean(item.instagram.trim()), instagramHref(item.instagram), 'Abrir Instagram');
  const phone = item.whatsapp || item.phone;
  return availabilityTag(Boolean(String(phone).replace(/\D/g, '')), whatsappHref(phone), 'Abrir WhatsApp');
}

export function QueueReviewPanel({ channel, scheduledDate, preferredResourceId = '', canPrepare, canInvalidate, refreshKey = 0, onQueueChanged, onToast }: {
  channel: QueueReviewChannel;
  scheduledDate: string;
  preferredResourceId?: string;
  canPrepare: boolean;
  canInvalidate: boolean;
  refreshKey?: number;
  onQueueChanged: () => void;
  onToast: (title: string, description: string, tone?: ToastItem['tone']) => void;
}) {
  const [batches, setBatches] = useState<QueueReviewBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const pendingItemsRef = useRef(new Set<string>());
  const toastRef = useRef(onToast);
  const scopeRef = useRef('');
  const requestRef = useRef(0);

  useEffect(() => { toastRef.current = onToast; }, [onToast]);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!preferredResourceId) { scopeRef.current = ''; setBatches([]); setLoading(false); return; }
    const scopeKey = `${channel}:${preferredResourceId}:${scheduledDate}`;
    const scopeChanged = scopeRef.current !== scopeKey;
    if (scopeChanged) {
      scopeRef.current = scopeKey;
      setBatches([]);
      setLoading(true);
    }
    try {
      const nextBatches = await queueReviewService.list(channel, preferredResourceId, scheduledDate);
      if (requestRef.current === requestId && scopeRef.current === scopeKey) setBatches(nextBatches);
    }
    catch (error) {
      if (requestRef.current === requestId && scopeRef.current === scopeKey) {
        toastRef.current('Não foi possível carregar a revisão', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
      }
    }
    finally { if (requestRef.current === requestId && scopeRef.current === scopeKey) setLoading(false); }
  }, [channel, preferredResourceId, scheduledDate]);

  // R40: atualizações do componente pai (cards, toasts e Fila final) não podem
  // transformar uma ação local em novo carregamento visual da tabela de revisão.
  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  const currentBatch = batches[0];
  const reviewItems = useMemo(() => currentBatch?.items ?? [], [currentBatch]);
  const rows = useMemo<ReviewRow[]>(() => reviewItems.map((item, index) => ({
    id: item.reviewItemId, position: index + 1, company: companyLink(item), branch: item.branch || '—', state: item.state || '—', city: item.city || '—',
    rating: item.rating.toFixed(1), reviews: item.reviews.toLocaleString('pt-BR'), channel: channelAvailability(item, channel),
    site: availabilityTag(Boolean(item.website.trim()), externalHttpHref(item.website), 'Abrir site'),
  })), [channel, reviewItems]);
  const columns = useMemo<TableColumn<ReviewRow>[]>(() => [
    { key: 'position', label: '#', width: '5%' }, { key: 'company', label: 'Empresa', width: '25%' }, { key: 'branch', label: 'Ramo', width: '14%' },
    { key: 'state', label: 'Estado', width: '7%' }, { key: 'city', label: 'Cidade', width: '12%' }, { key: 'rating', label: 'Nota', width: '7%' },
    { key: 'reviews', label: 'Avaliações', width: '9%' }, { key: 'channel', label: channel, width: '9%' }, { key: 'site', label: 'Site', width: '7%' },
  ], [channel]);
  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);
  useEffect(() => { resetPage(); }, [preferredResourceId, scheduledDate, resetPage]);

  const removeItemLocally = useCallback((reviewItemId: string) => {
    setBatches((current) => current
      .map((batch) => ({ ...batch, items: batch.items.filter((candidate) => candidate.reviewItemId !== reviewItemId) })));
  }, []);

  const restoreItemLocally = useCallback((item: QueueReviewItem, sourceBatch: QueueReviewBatch) => {
    setBatches((current) => {
      if (current.some((batch) => batch.items.some((candidate) => candidate.reviewItemId === item.reviewItemId))) return current;
      const existingIndex = current.findIndex((batch) => batch.batchId === sourceBatch.batchId);
      if (existingIndex < 0) return [...current, { ...sourceBatch, items: [item] }];
      return current.map((batch, index) => index !== existingIndex ? batch : {
        ...batch,
        items: [...batch.items, item].sort((a, b) => a.position - b.position),
      });
    });
  }, []);

  const approve = async (item: QueueReviewItem) => {
    if (!canPrepare || pendingItemsRef.current.has(item.reviewItemId)) return;
    const sourceBatch = batches.find((batch) => batch.items.some((candidate) => candidate.reviewItemId === item.reviewItemId));
    if (!sourceBatch) return;
    pendingItemsRef.current.add(item.reviewItemId);
    // Aprovação mantém resposta visual imediata removendo a linha localmente;
    // apenas falhas geram aviso, para não deslocar a estrutura da tabela.
    removeItemLocally(item.reviewItemId);
    try {
      await queueReviewService.approve(item, channel);
      onQueueChanged();
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Revise o lead e tente novamente.';
      restoreItemLocally(item, sourceBatch);
      onToast('Não foi possível aprovar', message, 'danger');
    }
    finally { pendingItemsRef.current.delete(item.reviewItemId); }
  };
  const invalidate = async (item: QueueReviewItem) => {
    if (!canInvalidate || pendingItemsRef.current.has(item.reviewItemId)) return;
    const sourceBatch = batches.find((batch) => batch.items.some((candidate) => candidate.reviewItemId === item.reviewItemId));
    if (!sourceBatch) return;
    pendingItemsRef.current.add(item.reviewItemId);
    removeItemLocally(item.reviewItemId);
    try {
      await queueReviewService.invalidate(item, channel);
      onQueueChanged();
    }
    catch (error) {
      restoreItemLocally(item, sourceBatch);
      onToast('Não foi possível invalidar', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    }
    finally { pendingItemsRef.current.delete(item.reviewItemId); }
  };
  const handleAction = (action: TableAction, row: ReviewRow) => {
    const item = reviewItems.find((candidate) => candidate.reviewItemId === row.id); if (!item) return;
    if (action === 'approve') void approve(item); if (action === 'invalidate') void invalidate(item);
  };

  return <TableCard
    title={currentBatch ? `Revisão antes do disparo · ${currentBatch.resourceLabel}` : 'Revisão antes do disparo'}
    footerText={currentBatch ? `Mostrando ${pageItems.length} de ${rows.length} lead(s) · ${currentBatch.items.length} aguardando aprovação · ${currentBatch.scheduledDate}` : undefined}
    footerLeft={rows.length ? <RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} /> : undefined}
    page={page} totalPages={totalPages} onPageChange={setPage}
  >
    {!preferredResourceId ? <div className="table-message">Selecione {channel === 'WhatsApp' ? 'um chip' : 'um perfil'} para revisar a fila.</div> : null}
    {preferredResourceId && loading && !batches.length ? <div className="table-message">Carregando revisão...</div> : null}
    {preferredResourceId && !loading && !reviewItems.length ? <div className="table-message">Nenhum lead aguardando revisão para este recurso.</div> : null}
    {!loading && pageItems.length ? <DataTable columns={columns} rows={pageItems} selectable={false} actions={['approve','invalidate']} actionsLabel="Ações"
      getRowActions={() => [...(canPrepare ? ['approve' as const] : []), ...(canInvalidate ? ['invalidate' as const] : [])]}
      onAction={handleAction} /> : null}
  </TableCard>;
}
