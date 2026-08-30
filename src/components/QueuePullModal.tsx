import { Calendar } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Field, Modal, SegmentedControl, SelectField } from '../design-system/components';
import { queueReviewService, type QueueReviewChannel, type QueueReviewPresenceFilter, type QueueReviewPullFilters, type QueueReviewPullPreview, type QueueReviewPullResult, type QueueReviewResource } from '../services/queue-review';
import { toLocalDateInputValue } from '../utils/date';

type Props = {
  open: boolean;
  initialChannel?: QueueReviewChannel;
  lockChannel?: boolean;
  initialDate: string;
  initialResourceId?: string;
  onClose: () => void;
  onPulled: (channel: QueueReviewChannel, result: QueueReviewPullResult) => void;
  onError: (title: string, description: string) => void;
};

const siteLabels: Record<QueueReviewPresenceFilter, string> = { any: 'Qualquer', without: 'Sem site', with: 'Com site' };
const instagramLabels: Record<QueueReviewPresenceFilter, string> = { any: 'Qualquer', without: 'Sem Instagram', with: 'Com Instagram' };
const filterFromLabel = (label: string, labels: Record<QueueReviewPresenceFilter, string>): QueueReviewPresenceFilter =>
  (Object.entries(labels).find(([, value]) => value === label)?.[0] as QueueReviewPresenceFilter | undefined) ?? 'any';

export function QueuePullModal({ open, initialChannel = 'WhatsApp', lockChannel = false, initialDate, initialResourceId = '', onClose, onPulled, onError }: Props) {
  const [channel, setChannel] = useState<QueueReviewChannel>(initialChannel);
  const [scheduledDate, setScheduledDate] = useState(initialDate);
  const [resourceId, setResourceId] = useState(initialResourceId);
  const [siteFilter, setSiteFilter] = useState<QueueReviewPresenceFilter>('any');
  const [instagramFilter, setInstagramFilter] = useState<QueueReviewPresenceFilter>('any');
  const [resources, setResources] = useState<QueueReviewResource[]>([]);
  const [preview, setPreview] = useState<QueueReviewPullPreview | null>(null);
  const [loadingResources, setLoadingResources] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pulling, setPulling] = useState(false);
  const errorRef = useRef(onError);

  useEffect(() => { errorRef.current = onError; }, [onError]);

  useEffect(() => {
    if (!open) return;
    setChannel(initialChannel);
    setScheduledDate(initialDate);
    setResourceId(initialResourceId);
    setSiteFilter('any');
    setInstagramFilter('any');
    setPreview(null);
  }, [open, initialChannel, initialDate, initialResourceId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingResources(true);
    setPreview(null);
    void queueReviewService.resources(channel, scheduledDate)
      .then((next) => {
        if (cancelled) return;
        setResources(next);
        setResourceId((current) => {
          if (!current) return '';
          const match = next.find((item) => item.id === current || item.label === current);
          return match?.id ?? '';
        });
      })
      .catch((error) => { if (!cancelled) errorRef.current('Não foi possível carregar os recursos', error instanceof Error ? error.message : 'Tente novamente.'); })
      .finally(() => { if (!cancelled) setLoadingResources(false); });
    return () => { cancelled = true; };
  }, [channel, scheduledDate, open]);

  const filters: QueueReviewPullFilters = useMemo(() => ({
    site: siteFilter,
    instagram: channel === 'Instagram' ? 'any' : instagramFilter,
  }), [channel, instagramFilter, siteFilter]);

  useEffect(() => {
    if (!open || !resourceId) { setPreview(null); return; }
    let cancelled = false;
    setLoadingPreview(true);
    void queueReviewService.preview(channel, scheduledDate, resourceId, filters)
      .then((next) => { if (!cancelled) setPreview(next); })
      .catch((error) => {
        if (!cancelled) {
          setPreview(null);
          errorRef.current('Não foi possível calcular a puxada', error instanceof Error ? error.message : 'Tente novamente.');
        }
      })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [channel, filters, open, resourceId, scheduledDate]);

  const resourceOptions = resources.length
    ? resources.map((resource) => ({ label: resource.label, value: resource.id }))
    : [{ label: channel === 'WhatsApp' ? 'Nenhum chip operacional' : 'Nenhum perfil operacional', value: '' }];

  const confirm = async () => {
    if (!resourceId || !preview || preview.willPull <= 0 || pulling) return;
    setPulling(true);
    try {
      const result = await queueReviewService.pull(channel, scheduledDate, resourceId, filters);
      onPulled(channel, result);
      onClose();
    } catch (error) {
      errorRef.current(`Não foi possível puxar ${channel}`, error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setPulling(false);
    }
  };

  const ctaLabel = pulling
    ? 'Puxando leads...'
    : !resourceId
      ? 'Selecione um recurso'
      : loadingPreview
        ? 'Calculando...'
        : (preview?.resource.available ?? 0) <= 0
          ? 'Fila sem vagas disponíveis'
          : (preview?.eligible ?? 0) <= 0
            ? 'Nenhum lead compatível'
            : `Puxar ${preview?.willPull ?? 0} lead${preview?.willPull === 1 ? '' : 's'}`;

  return <Modal
    open={open}
    title="Puxar leads"
    description="Escolha o destino e o perfil das empresas. A quantidade é calculada automaticamente pela capacidade disponível."
    onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={pulling} disabled={!resourceId || loadingPreview || !preview || preview.willPull <= 0} onClick={() => void confirm()}>{ctaLabel}</Button></>}
  >
    <div className="queue-pull-modal__form">
      {!lockChannel ? <div className="queue-pull-modal__field"><span className="queue-pull-modal__label">Canal</span><SegmentedControl items={['WhatsApp','Instagram']} active={channel} onChange={(item) => { setChannel(item as QueueReviewChannel); setResourceId(''); setPreview(null); }} /></div> : null}
      <div className="queue-pull-modal__field"><Field label="Data da fila" type="date" iconLeft={Calendar} min={toLocalDateInputValue()} value={scheduledDate} onChange={setScheduledDate} /></div>
      <div className="queue-pull-modal__field"><span className="queue-pull-modal__label">{channel === 'WhatsApp' ? 'Chip' : 'Perfil'}</span><SelectField options={resourceOptions} value={resourceId} placeholder={loadingResources ? 'Carregando...' : channel === 'WhatsApp' ? 'Selecione o chip' : 'Selecione o perfil'} onChange={setResourceId} /></div>
      <div className="queue-pull-modal__field"><span className="queue-pull-modal__label">Site</span><SegmentedControl items={Object.values(siteLabels)} active={siteLabels[siteFilter]} onChange={(label) => setSiteFilter(filterFromLabel(label, siteLabels))} /></div>
      {channel === 'WhatsApp' ? <div className="queue-pull-modal__field"><span className="queue-pull-modal__label">Instagram</span><SegmentedControl items={Object.values(instagramLabels)} active={instagramLabels[instagramFilter]} onChange={(label) => setInstagramFilter(filterFromLabel(label, instagramLabels))} /></div> : null}
      <div className="queue-pull-modal__summary" aria-live="polite">
        <div className="queue-pull-modal__summary-row"><span>Capacidade do {channel === 'WhatsApp' ? 'chip' : 'perfil'}</span><strong>{preview?.resource.dailyLimit ?? '—'}</strong></div>
        <div className="queue-pull-modal__summary-row"><span>Já ocupadas nesta data</span><strong>{preview?.resource.used ?? '—'}</strong></div>
        <div className="queue-pull-modal__summary-row"><span>Vagas disponíveis</span><strong>{preview?.resource.available ?? '—'}</strong></div>
        <div className="queue-pull-modal__summary-row"><span>Leads compatíveis com os filtros</span><strong>{preview?.eligible ?? '—'}</strong></div>
        <div className="queue-pull-modal__summary-row queue-pull-modal__summary-row--total"><span>Serão puxados</span><strong>{preview?.willPull ?? '—'}</strong></div>
      </div>
      {preview && preview.resource.available > preview.eligible ? <p className="queue-pull-modal__hint">Existem apenas {preview.eligible} lead(s) compatível(is). As vagas restantes continuarão livres; nenhum lead fora do filtro será usado para completar.</p> : null}
    </div>
  </Modal>;
}
