import { LockKeyhole, RefreshCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Tag, type ToastItem } from '../design-system/components';
import { queueReviewService, type QueueReviewBatch, type QueueReviewChannel, type QueueReviewItem } from '../services/queue-review';

function contactFor(item: QueueReviewItem, channel: QueueReviewChannel) {
  if (channel === 'Instagram') return item.instagram ? `@${item.instagram.replace(/^@/, '')}` : '-';
  return item.whatsapp || item.phone || '-';
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
  const [lockingBatch, setLockingBatch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setBatches(await queueReviewService.list(channel));
    } catch (error) {
      onToast('Não foi possível carregar a revisão', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    } finally {
      setLoading(false);
    }
  }, [channel, onToast]);

  useEffect(() => { void refresh(); }, [refresh, scheduledDate]);

  const pull = async () => {
    if (!canPrepare) return;
    setPulling(true);
    try {
      const result = await queueReviewService.pullToCapacity(channel, scheduledDate, preferredResourceId);
      await refresh();
      const details = [
        `${result.batch.openCount}/${result.batch.targetCount} na revisão`,
        result.invalidatedByProvider ? `${result.invalidatedByProvider} sem WhatsApp` : '',
        result.redirectedToInstagram ? `${result.redirectedToInstagram} liberado(s) para Instagram` : '',
        result.exhausted ? 'base elegível esgotada' : '',
      ].filter(Boolean).join(' · ');
      onToast(`Revisão ${channel} atualizada`, details || 'Os melhores leads disponíveis foram puxados.', result.errors ? 'warning' : 'success');
    } catch (error) {
      onToast(`Não foi possível puxar ${channel}`, error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    } finally {
      setPulling(false);
    }
  };

  const invalidate = async (item: QueueReviewItem) => {
    if (!canInvalidate) return;
    setWorkingItem(item.reviewItemId);
    try {
      await queueReviewService.invalidate(item, channel);
      await refresh();
      onToast('Lead invalidado', 'A vaga foi liberada e o CRM buscou automaticamente o próximo melhor lead.', 'warning');
    } catch (error) {
      onToast('Não foi possível invalidar', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    } finally {
      setWorkingItem('');
    }
  };

  const lock = async (batch: QueueReviewBatch) => {
    if (!canPrepare || !batch.items.length) return;
    setLockingBatch(batch.batchId);
    try {
      await queueReviewService.lock(batch);
      await refresh();
      onQueueChanged();
      onToast('Fila trancada', `${batch.items.length} lead(s) foram congelados no snapshot e liberados para execução.`, 'success');
    } catch (error) {
      onToast('Não foi possível trancar a fila', error instanceof Error ? error.message : 'Revise os leads e tente novamente.', 'danger');
    } finally {
      setLockingBatch('');
    }
  };

  return (
    <section className="queue-review-card">
      <div className="queue-review-card__header">
        <div>
          <h2>Revisão antes do disparo</h2>
          <p>Os leads abaixo ainda não possuem snapshot. Invalide o que não fizer sentido e trave a fila quando terminar.</p>
        </div>
        <div className="queue-review-card__actions">
          <Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || pulling} onClick={() => void refresh()}>Atualizar</Button>
          {canPrepare ? <Button loading={pulling} disabled={loading || pulling} onClick={() => void pull()}>Puxar {channel}</Button> : null}
        </div>
      </div>

      {loading && !batches.length ? <div className="table-message">Carregando revisão...</div> : null}
      {!loading && !batches.length ? <div className="table-message">Nenhuma fila aberta para revisão.</div> : null}

      {batches.map((batch) => (
        <div key={batch.batchId} className="queue-review-batch">
          <div className="queue-review-batch__meta">
            <div>
              <strong>{batch.resourceLabel}</strong>
              <span>{batch.items.length}/{batch.targetCount} lead(s) · {batch.scheduledDate}</span>
            </div>
            <Button iconLeft={LockKeyhole} loading={lockingBatch === batch.batchId} disabled={!batch.items.length || Boolean(lockingBatch)} onClick={() => void lock(batch)}>
              Trancar fila
            </Button>
          </div>
          <div className="queue-review-table-wrap">
            <table className="queue-review-table">
              <thead><tr><th>#</th><th>Empresa</th><th>Ramo</th><th>Localização</th><th>Nota</th><th>Avaliações</th><th>Contato</th><th></th></tr></thead>
              <tbody>
                {batch.items.map((item) => (
                  <tr key={item.reviewItemId}>
                    <td>{item.position}</td>
                    <td><strong>{item.company}</strong></td>
                    <td>{item.branch || '-'}</td>
                    <td>{[item.city, item.state].filter(Boolean).join(' / ') || '-'}</td>
                    <td>{item.rating.toFixed(1)}</td>
                    <td>{item.reviews.toLocaleString('pt-BR')}</td>
                    <td>{contactFor(item, channel)}</td>
                    <td className="queue-review-table__action">
                      {canInvalidate ? (
                        <button className="queue-review-invalidate" type="button" title="Invalidar lead" disabled={workingItem === item.reviewItemId || Boolean(lockingBatch)} onClick={() => void invalidate(item)}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      ) : <Tag tone="neutral">Revisão</Tag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
