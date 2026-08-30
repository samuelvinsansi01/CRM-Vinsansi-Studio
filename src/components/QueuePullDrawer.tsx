import { Calendar, ListPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Field, MultiSelectField, SegmentedControl, SelectField } from '../design-system/components';
import {
  queueReviewService,
  type QueueReviewBranch,
  type QueueReviewChannel,
  type QueueReviewPresenceFilter,
  type QueueReviewPullFilters,
  type QueueReviewPullPreview,
  type QueueReviewPullResult,
  type QueueReviewResource,
} from '../services/queue-review';
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

const siteOptions = [
  { label: 'Qualquer', value: 'any' },
  { label: 'Sem site', value: 'without' },
  { label: 'Com site', value: 'with' },
];

const instagramOptions = [
  { label: 'Qualquer', value: 'any' },
  { label: 'Sem Instagram', value: 'without' },
  { label: 'Com Instagram', value: 'with' },
];

export function QueuePullDrawer({
  open,
  initialChannel = 'WhatsApp',
  lockChannel = false,
  initialDate,
  initialResourceId = '',
  onClose,
  onPulled,
  onError,
}: Props) {
  const [channel, setChannel] = useState<QueueReviewChannel>(initialChannel);
  const [scheduledDate, setScheduledDate] = useState(initialDate);
  const [resourceId, setResourceId] = useState(initialResourceId);
  const [siteFilter, setSiteFilter] = useState<QueueReviewPresenceFilter>('any');
  const [instagramFilter, setInstagramFilter] = useState<QueueReviewPresenceFilter>('any');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [branches, setBranches] = useState<QueueReviewBranch[]>([]);
  const [resources, setResources] = useState<QueueReviewResource[]>([]);
  const [preview, setPreview] = useState<QueueReviewPullPreview | null>(null);
  const [loadingResources, setLoadingResources] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pulling, setPulling] = useState(false);
  const errorRef = useRef(onError);

  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!open) return;
    setChannel(initialChannel);
    setScheduledDate(initialDate);
    setResourceId(initialResourceId);
    setSiteFilter('any');
    setInstagramFilter('any');
    setBranchIds([]);
    setPreview(null);
  }, [open, initialChannel, initialDate, initialResourceId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void queueReviewService.branches()
      .then((next) => { if (!cancelled) setBranches(next); })
      .catch((error) => {
        if (!cancelled) errorRef.current('Não foi possível carregar os ramos', error instanceof Error ? error.message : 'Tente novamente.');
      });
    return () => { cancelled = true; };
  }, [open]);

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
      .catch((error) => {
        if (!cancelled) {
          errorRef.current('Não foi possível carregar os recursos', error instanceof Error ? error.message : 'Tente novamente.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingResources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel, scheduledDate, open]);

  const filters: QueueReviewPullFilters = useMemo(
    () => ({
      site: siteFilter,
      instagram: channel === 'Instagram' ? 'any' : instagramFilter,
      branchIds,
    }),
    [branchIds, channel, instagramFilter, siteFilter],
  );

  useEffect(() => {
    if (!open || !resourceId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    void queueReviewService.preview(channel, scheduledDate, resourceId, filters)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setPreview(null);
          errorRef.current('Não foi possível calcular a puxada', error instanceof Error ? error.message : 'Tente novamente.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel, filters, open, resourceId, scheduledDate]);

  const branchOptions = branches.map((branch) => ({ label: branch.name, value: branch.id }));

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

  return (
    <Drawer
      open={open}
      title="Puxar leads"
      description="Escolha o destino e os critérios dos leads que entrarão na revisão. A quantidade é calculada automaticamente pela capacidade disponível."
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            iconLeft={ListPlus}
            loading={pulling}
            disabled={!resourceId || loadingPreview || !preview || preview.willPull <= 0}
            onClick={() => void confirm()}
          >
            {ctaLabel}
          </Button>
        </>
      )}
    >
      <div className="drawer-form queue-pull-drawer__form">
        {!lockChannel ? (
          <label className="drawer-field">
            <span>Canal</span>
            <SegmentedControl
              items={['WhatsApp', 'Instagram']}
              active={channel}
              onChange={(item) => {
                setChannel(item as QueueReviewChannel);
                setResourceId('');
                setPreview(null);
              }}
            />
          </label>
        ) : null}

        <Field
          label="Data da fila"
          type="date"
          iconLeft={Calendar}
          min={toLocalDateInputValue()}
          value={scheduledDate}
          onChange={setScheduledDate}
        />

        <label className="drawer-field">
          <span>{channel === 'WhatsApp' ? 'Chip' : 'Perfil'}</span>
          <SelectField
            options={resourceOptions}
            value={resourceId}
            placeholder={loadingResources ? 'Carregando...' : channel === 'WhatsApp' ? 'Selecione o chip' : 'Selecione o perfil'}
            onChange={setResourceId}
          />
        </label>

        <div className="queue-pull-drawer__section">
          <div className="queue-pull-drawer__section-heading">
            <strong>Perfil das empresas</strong>
            <span>Os filtros restringem a reserva. Leads fora do perfil não serão usados para completar vagas.</span>
          </div>

          <label className="drawer-field">
            <span>Ramos</span>
            <MultiSelectField
              options={branchOptions}
              values={branchIds}
              placeholder="Todos os ramos"
              searchPlaceholder="Buscar ramo..."
              onChange={setBranchIds}
            />
          </label>

          <label className="drawer-field">
            <span>Site</span>
            <SelectField
              options={siteOptions}
              value={siteFilter}
              onChange={(value) => setSiteFilter(value as QueueReviewPresenceFilter)}
            />
          </label>

          {channel === 'WhatsApp' ? (
            <label className="drawer-field">
              <span>Instagram</span>
              <SelectField
                options={instagramOptions}
                value={instagramFilter}
                onChange={(value) => setInstagramFilter(value as QueueReviewPresenceFilter)}
              />
            </label>
          ) : null}
        </div>

        <div className="queue-pull-drawer__section">
          <div className="queue-pull-drawer__section-heading">
            <strong>Resumo da puxada</strong>
            <span>Prévia somente leitura; a reserva acontece apenas ao confirmar.</span>
          </div>

          <div className="queue-pull-drawer__summary" aria-live="polite">
            <div className="queue-pull-drawer__summary-row">
              <span>Capacidade do {channel === 'WhatsApp' ? 'chip' : 'perfil'}</span>
              <strong>{preview?.resource.dailyLimit ?? '—'}</strong>
            </div>
            <div className="queue-pull-drawer__summary-row">
              <span>Já ocupadas nesta data</span>
              <strong>{preview?.resource.used ?? '—'}</strong>
            </div>
            <div className="queue-pull-drawer__summary-row">
              <span>Vagas disponíveis</span>
              <strong>{preview?.resource.available ?? '—'}</strong>
            </div>
            <div className="queue-pull-drawer__summary-row">
              <span>Leads compatíveis com os filtros</span>
              <strong>{preview?.eligible ?? '—'}</strong>
            </div>
            <div className="queue-pull-drawer__summary-row queue-pull-drawer__summary-row--total">
              <span>Serão puxados</span>
              <strong>{preview?.willPull ?? '—'}</strong>
            </div>
          </div>

          {preview && preview.resource.available > preview.eligible ? (
            <p className="queue-pull-drawer__hint">
              Existem apenas {preview.eligible} lead(s) compatível(is). As vagas restantes continuarão livres; nenhum lead fora do filtro será usado para completar.
            </p>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
