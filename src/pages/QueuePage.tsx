import { useEffect, useMemo, useState } from 'react';
import { Bug, Calendar, CheckSquare, ChevronDown, ChevronUp, Eye, Flag, List, ListPlus, Pause, Play, RefreshCcw, Send, Square, Users, X } from 'lucide-react';
import { Button, ConfirmDialog, Drawer, Field, MetricCard, Pagination, RowsPerPageControl, SelectField, Tag, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { ApprovedLeadsQueueDrawer } from '../components/ApprovedLeadsQueueDrawer';
import { useClientPagination } from '../hooks/useClientPagination';
import { useInstagramQueue } from '../hooks/useInstagramQueue';
import { useWhatsAppQueue } from '../hooks/useWhatsAppQueue';
import type { InstagramQueueBatch, InstagramQueueLead, InstagramQueueStatus } from '../services/instagram-queue/types';
import { permissionsFor } from '../services/permissions';
import { isStatusGroup, statusLabel, statusTone } from '../services/status/status.mapper';
import { hasWhatsAppOperationalIssue, hasWhatsAppWorkerContract } from '../services/whatsapp-queue/whatsappQueue.guards';
import type { WhatsAppQueueBatch, WhatsAppQueueLead, WhatsAppQueueStatus } from '../services/whatsapp-queue/types';
import { toLocalDateInputValue } from '../utils/date';
import { hasWebsiteForTemplate } from '../services/templates/templateSelector';
import { instagramExtensionGateway } from '../services/instagram-extension';

type QueuePageProps = {
  channel: 'whatsapp' | 'instagram';
};

type QueueDraft = { position: string; scheduled_date: string };

const legacyWhatsAppStatusLabel: Record<WhatsAppQueueStatus, string> = {
  queued: 'Em fila',
  sending: 'Enviando',
  sent: 'Enviada',
  paused: 'Pausada',
  error: 'Erro',
  invalid: 'Inválida',
};


const legacyInstagramStatusLabel: Record<InstagramQueueStatus, string> = {
  queued: 'Em fila',
  following: 'Seguindo',
  dm_opened: 'DM aberta',
  sent: 'Enviada',
  paused: 'Pausada',
  error: 'Erro',
  invalid: 'Inválida',
};


function todayInputValue() {
  return toLocalDateInputValue();
}

function instagramHandle(lead: InstagramQueueLead) {
  const raw = lead.instagram_username || lead.instagram || lead.instagram_url || '';
  const withoutUrl = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').split(/[/?#]/)[0];
  const username = withoutUrl.replace(/^@/, '').trim();
  return username;
}

function instagramHref(lead: InstagramQueueLead) {
  if (/^https?:\/\//i.test(lead.instagram_url ?? '')) return lead.instagram_url;
  const handle = instagramHandle(lead);
  return handle ? `https://instagram.com/${handle}` : undefined;
}

/** A classificação visual segue a mesma regra usada para escolher templates. */
function siteBadgeLabel(lead: { site?: string | null }) {
  return hasWebsiteForTemplate(lead.site) ? 'Com site' : 'Sem site';
}

export function QueuePage({ channel }: QueuePageProps) {
  if (channel === 'instagram') {
    return <InstagramQueuePage />;
  }

  return <WhatsAppQueuePage />;
}

function WhatsAppQueuePage() {
  const [activeChip, setActiveChip] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayInputValue);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [editingLead, setEditingLead] = useState<WhatsAppQueueLead | null>(null);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [confirmLead, setConfirmLead] = useState<WhatsAppQueueLead | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [approvedDrawerOpen, setApprovedDrawerOpen] = useState(false);

  const { chips, batches, summary, batchState, loading, refreshing, error, refresh, updateLead, startBatch, pauseBatch, resumeBatch, stopBatch, reprocess, invalidate } = useWhatsAppQueue(activeChip, scheduledDate);
  const {
    page: batchPage,
    setPage: setBatchPage,
    rowsPerPage: batchesPerPage,
    setRowsPerPage: setBatchesPerPage,
    totalPages: batchTotalPages,
    pageItems: pagedBatches,
    resetPage: resetBatchPage,
  } = useClientPagination(batches, 10);
  const running = batchState.enabled && batchState.status === 'running';

  useEffect(() => {
    if (activeChip && !chips.includes(activeChip)) {
      setActiveChip('');
    }
  }, [activeChip, chips]);

  useEffect(() => {
    setSelectedIds([]);
    setStarting(false);
    resetBatchPage();
  }, [activeChip, scheduledDate, resetBatchPage]);

  const visibleLeads = () => batches.flatMap((batch) => batch.leads);
  const visibleActionIds = (predicate: (lead: WhatsAppQueueLead) => boolean) => visibleLeads().filter(predicate).map((lead) => lead.id);
  const isRunnableLead = (lead: WhatsAppQueueLead) =>
    hasWhatsAppWorkerContract(lead) && (permissionsFor('whatsapp-queue', lead.status).canSend() || permissionsFor('whatsapp-queue', lead.status).canResume());
  const selectedOrRunnableLeads = () =>
    selectedIds.length
      ? visibleLeads().filter((lead) => selectedIds.includes(lead.id) && isRunnableLead(lead))
      : visibleLeads().filter(isRunnableLead);
  const selectedOrRunnableIds = () => selectedOrRunnableLeads().map((lead) => lead.id);
  const groupRunnableByChip = (leads: WhatsAppQueueLead[]) => {
    const groups = new Map<string, string[]>();
    for (const lead of leads) {
      const chip = lead.chip_instance || lead.chip;
      if (!chip) continue;
      groups.set(chip, [...(groups.get(chip) ?? []), lead.id]);
    }
    return groups;
  };

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [{ id, ...toast }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3400);
  };

  const handleStart = async () => {
    const leads = selectedOrRunnableLeads();
    const ids = leads.map((lead) => lead.id);
    if (!ids.length) {
      pushToast({ title: 'Nada para iniciar', description: 'Nao ha leads em fila ou pausados no lote visivel.', tone: 'warning' });
      return;
    }

    const groups = groupRunnableByChip(leads);
    if (!groups.size) {
      pushToast({ title: 'Nada para iniciar', description: 'Nenhum lead visivel possui chip operacional.', tone: 'warning' });
      return;
    }

    setStarting(true);
    try {
      const states = [];
      for (const [, groupIds] of groups.entries()) {
        states.push(await startBatch(groupIds));
      }
      setSelectedIds(ids);
      const firstNext = states
        .map((state) => state.next_run_at)
        .filter(Boolean)
        .sort()[0];
      const next = firstNext ? new Date(firstNext).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'agora';
      pushToast({
        title: states.some((state) => state.already_running) ? 'Lote já está em execução' : activeChip ? `Lote iniciado para ${activeChip}` : 'Lotes visíveis iniciados',
        description: activeChip
          ? `${ids.length} lead(s). Próximo envio: ${next}. O Worker continuará mesmo com esta tela fechada.`
          : `${ids.length} lead(s) em ${groups.size} chip(s). Próximo envio: ${next}. O Worker continuará mesmo com esta tela fechada.`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Não foi possível iniciar o lote', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setStarting(false);
    }
  };

  const targetChips = () => activeChip ? [activeChip] : Array.from(new Set(batches.map((batch) => batch.chip).filter(Boolean)));

  const handlePause = async () => {
    try {
      const targets = targetChips();
      await Promise.all(targets.map((chip) => pauseBatch(chip)));
      pushToast({ title: activeChip ? 'Lote pausado' : 'Lotes visíveis pausados', description: 'Nenhum novo lead será enviado até você retomar o lote.', tone: 'info' });
    } catch (err) {
      pushToast({ title: 'Não foi possível pausar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleResume = async () => {
    try {
      const targets = targetChips();
      await Promise.all(targets.map((chip) => resumeBatch(chip)));
      pushToast({ title: activeChip ? 'Lote retomado' : 'Lotes visíveis retomados', description: 'O Worker continuará a partir do próximo lead pendente.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível retomar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleStop = async () => {
    try {
      const targets = targetChips();
      await Promise.all(targets.map((chip) => stopBatch(chip)));
      setSelectedIds([]);
      pushToast({ title: activeChip ? 'Lote encerrado' : 'Lotes visíveis encerrados', description: 'Os itens restantes continuam em fila e podem ser iniciados depois.', tone: 'warning' });
    } catch (err) {
      pushToast({ title: 'Não foi possível encerrar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleReprocess = async () => {
    const ids = selectedIds.length ? selectedIds : visibleActionIds((lead) => permissionsFor('whatsapp-queue', lead.status).canRetry());
    if (!ids.length) {
      pushToast({ title: 'Nada para reprocessar', description: 'Selecione leads com erro ou invalidos.', tone: 'warning' });
      return;
    }

    try {
      await reprocess(ids);
      setStarting(false);
      setSelectedIds([]);
      pushToast({ title: 'Leads reprocessados', description: `${ids.length} lead(s) voltaram para a fila.`, tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível reprocessar', description: err instanceof Error ? err.message : 'Atualize a fila e tente novamente.', tone: 'danger' });
    }
  };

  const handleSaveLead = async (draft: QueueDraft) => {
    if (!editingLead) return;
    const position = Number(draft.position);
    if (!Number.isSafeInteger(position) || position < 1) {
      pushToast({ title: 'Posição inválida', description: 'Informe uma posição inteira maior ou igual a 1.', tone: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await updateLead(editingLead.id, { position, scheduled_date: draft.scheduled_date });
      setEditingLead(null);
      setDrawerMode('view');
      pushToast({ title: 'Item de fila atualizado', description: 'Posição e agendamento foram persistidos em queue_items.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível atualizar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const handleInvalidate = async () => {
    if (!confirmLead) return;
    await invalidate(confirmLead);
    setConfirmLead(null);
    setSelectedIds((current) => current.filter((id) => id !== confirmLead.id));
    pushToast({ title: 'Lead invalidado', description: `${confirmLead.company} saiu da fila ativa.`, tone: 'warning' });
  };

  const chipFilterOptions = [{ label: 'Todos os chips', value: '' }, ...chips.map((chip) => ({ label: chip, value: chip }))];
  const scopeLabel = activeChip || 'Todos os chips';
  const startButtonLabel = starting
    ? 'Iniciando...'
    : running
      ? 'Em execução'
      : activeChip
        ? `Iniciar ${activeChip}`
        : 'Iniciar lotes visíveis';

  return (
    <div className="queue-page queue-page--whatsapp">
      <PageHeader title="Fila WhatsApp" action={<Field label="Data" type="date" iconLeft={Calendar} value={scheduledDate} onChange={setScheduledDate} />} />
      <section className="metric-grid metric-grid--5">
        <MetricCard icon={Users} value={String(summary.total)} label="Total" />
        <MetricCard icon={List} value={String(summary.queued)} label="Em fila" tone="primary" />
        <MetricCard icon={Send} value={String(summary.sent)} label="Enviados" tone="success" />
        <MetricCard icon={CheckSquare} value={String(summary.finished)} label="Finalizados" tone="warning" />
        <MetricCard icon={Bug} value={String(summary.errors)} label="Erros" tone="danger" />
      </section>

      <div className="queue-topline queue-topline--actions">
        <div className="queue-controls">
          <SelectField className="queue-inline-filter" options={chipFilterOptions} value={activeChip} onChange={setActiveChip} placeholder="Todos os chips" />
          <Button variant="secondary" iconLeft={ListPlus} disabled={loading || running} onClick={() => setApprovedDrawerOpen(true)}>Puxar aprovados</Button>
          <Button variant="danger" iconLeft={Square} disabled={!running && batchState.status !== 'paused'} onClick={handleStop}>Parar</Button>
          {running ? (
            <Button variant="secondary" iconLeft={Pause} onClick={handlePause}>Pausar</Button>
          ) : batchState.status === 'paused' ? (
            <Button variant="secondary" iconLeft={Play} onClick={handleResume}>Retomar</Button>
          ) : null}
          <Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || starting || running} onClick={handleReprocess}>Reprocessar</Button>
          <Button iconLeft={Play} disabled={loading || starting || running || batchState.status === 'paused'} onClick={handleStart}>{startButtonLabel}</Button>
        </div>
      </div>

      <section className="queue-list-card">
        <div className="queue-list-card__header">
          <h2>Listagem de disparos - {scopeLabel}</h2>
          {(running || batchState.status === 'paused') && (
            <small className="queue-batch-status" role="status">
              {batchState.status === 'paused' ? 'Lote pausado' : `Lote em execução • ${batchState.remaining} restante(s)`}
              {Number(batchState.processed || 0) > 0 ? ` • ${batchState.processed} processado(s)` : ''}
              {Number(batchState.failed || 0) > 0 ? ` • ${batchState.failed} erro(s)` : ''}
              {batchState.next_run_at ? ` • próximo: ${new Date(batchState.next_run_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </small>
          )}
        </div>
        {refreshing && running && batches.length ? <small className="queue-refresh-indicator" role="status">Atualizando fila sem interromper os lotes...</small> : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading && !batches.length ? <div className="table-message">Carregando fila WhatsApp...</div> : null}
        {!error && !loading && !refreshing && !batches.length ? <div className="table-message">Nenhum lote WhatsApp disponivel.</div> : null}
        <div className="batch-list">
          {!error ? pagedBatches.map((batch, index) => (
            <WhatsAppBatch
              key={batch.id}
              batch={batch}
              showScope={!activeChip}
              defaultExpanded={index === 0}
              onEdit={(lead) => { setEditingLead(lead); setDrawerMode('view'); }}
              onInvalidate={setConfirmLead}
            />
          )) : null}
        </div>
        {batches.length ? (
          <div className="queue-list-card__footer">
            <div className="queue-list-card__footer-left">
              <RowsPerPageControl value={batchesPerPage} onChange={setBatchesPerPage} />
              <small>Mostrando {pagedBatches.length} de {batches.length} lote(s)</small>
            </div>
            <Pagination page={batchPage} totalPages={batchTotalPages} onPageChange={setBatchPage} />
          </div>
        ) : null}
      </section>

      <ApprovedLeadsQueueDrawer
        open={approvedDrawerOpen}
        channel="WhatsApp"
        scheduledDate={scheduledDate}
        preferredResourceId={activeChip}
        onClose={() => setApprovedDrawerOpen(false)}
        onPrepared={refresh}
        onToast={(title, description, tone) => pushToast({ title, description, tone })}
      />
      <QueueLeadDrawer lead={editingLead} mode={drawerMode} saving={saving} onModeChange={setDrawerMode} onClose={() => { setEditingLead(null); setDrawerMode('view'); }} onSave={handleSaveLead} />
      <ConfirmDialog
        open={Boolean(confirmLead)}
        title="Invalidar lead da fila?"
        description="Essa ação marca o lead como inválido localmente e remove da execução do lote."
        confirmLabel="Invalidar"
        danger
        onClose={() => setConfirmLead(null)}
        onConfirm={handleInvalidate}
      />
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function WhatsAppBatch({
  batch,
  defaultExpanded = false,
  showScope = false,
  onEdit,
  onInvalidate,
}: {
  batch: WhatsAppQueueBatch;
  defaultExpanded?: boolean;
  showScope?: boolean;
  onEdit: (lead: WhatsAppQueueLead) => void;
  onInvalidate: (lead: WhatsAppQueueLead) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [openRow, setOpenRow] = useState('');

  const stats = useMemo(
    () => ({
      sent: batch.leads.filter((lead) => isStatusGroup(lead.status, 'sent')).length,
      queued: batch.leads.filter((lead) => (isStatusGroup(lead.status, 'queued') || isStatusGroup(lead.status, 'paused')) && hasWhatsAppWorkerContract(lead)).length,
      errors: batch.leads.filter((lead) => isStatusGroup(lead.status, 'error') || hasWhatsAppOperationalIssue(lead)).length,
      invalid: batch.leads.filter((lead) => isStatusGroup(lead.status, 'invalid')).length,
    }),
    [batch.leads],
  );

  return (
    <article className={`batch ${expanded ? 'batch--expanded' : ''}`}>
      <button className="batch__header" type="button" onClick={() => setExpanded((current) => !current)}>
        <strong>{showScope ? `${batch.chip} • ` : ''}Lote {String(batch.number).padStart(2, '0')}</strong>
        <span>{batch.leads.length}/{batch.limit}</span>
        <span>{stats.sent} enviados</span>
        <span>{stats.queued} aguardando</span>
        <span>{stats.errors} erros</span>
        <span>{stats.invalid} invalidos</span>
        {expanded ? <ChevronUp size={16} strokeWidth={1.8} /> : <ChevronDown size={16} strokeWidth={1.8} />}
      </button>
      {expanded ? (
        <div className="batch__rows">
          {batch.leads.map((lead) => (
            <div className={`batch-row ${openRow === lead.id ? 'batch-row--open' : ''}`} key={lead.id}>
              <div className="batch-row__summary">
                <span className="batch-row__company">
                  {lead.company}
                </span>
                <span>{lead.phone}</span>
                <span className="batch-row__tags">
                  <Tag>{lead.branch}</Tag>
                  {String(lead.type) !== siteBadgeLabel(lead) ? <Tag>{lead.type}</Tag> : null}
                  <Tag>{siteBadgeLabel(lead)}</Tag>
                  <Tag tone={hasWhatsAppOperationalIssue(lead) ? 'danger' : statusTone(lead.status)}>
                    {hasWhatsAppOperationalIssue(lead) ? 'Dados incompletos' : statusLabel(lead.status)}
                  </Tag>
                </span>
                <span className="batch-row__icons">
                  <button type="button" className="batch-row__action" onClick={() => onEdit(lead)} aria-label="Visualizar lead">
                    <Eye size={18} />
                  </button>
                  <button type="button" className="batch-row__action batch-row__action--danger" disabled={!permissionsFor('whatsapp-queue', lead.status).canInvalidate()} onClick={() => onInvalidate(lead)} aria-label="Invalidar lead">
                    <Flag size={18} />
                  </button>
                  <button type="button" className="batch-row__toggle" onClick={() => setOpenRow(openRow === lead.id ? '' : lead.id)}>
                    {openRow === lead.id ? <ChevronUp size={16} strokeWidth={1.8} /> : <ChevronDown size={16} strokeWidth={1.8} />}
                  </button>
                </span>
              </div>
              {openRow === lead.id ? (
                <div className="message-preview-grid">
                  <MessagePreview title="Mensagem 1" text={lead.message1} />
                  <MessagePreview title="Mensagem 2" text={lead.message2} />
                  <MessagePreview title="Mensagem 3" text={lead.message3} />
                  <MessagePreview title="Mensagem 4" text={lead.message4} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function QueueLeadDrawer({
  lead,
  mode,
  saving,
  onModeChange,
  onClose,
  onSave,
}: {
  lead: WhatsAppQueueLead | null;
  mode: 'view' | 'edit';
  saving: boolean;
  onModeChange: (mode: 'view' | 'edit') => void;
  onClose: () => void;
  onSave: (draft: QueueDraft) => void;
}) {
  const [draft, setDraft] = useState<QueueDraft | null>(null);

  useEffect(() => {
    if (!lead) {
      setDraft(null);
      return;
    }

    setDraft({
      position: String(lead.position),
      scheduled_date: lead.scheduled_date,
    });
  }, [lead]);

  const updateDraft = (key: keyof QueueDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <Drawer
      open={Boolean(lead && draft)}
      title={mode === 'edit' ? 'Editar item da fila' : 'Detalhes do item da fila'}
      description="Somente posição e agendamento pertencem ao item da fila. Lead, chip e template são referências canônicas e devem ser alterados em seus próprios cadastros."
      onClose={onClose}
      footer={
        mode === 'edit' ? (
          <>
            <Button variant="secondary" onClick={() => onModeChange('view')}>Cancelar</Button>
            <Button loading={saving} onClick={() => draft && onSave(draft)}>Salvar</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            {lead && permissionsFor('whatsapp-queue', lead.status).canEdit() ? (
              <Button onClick={() => onModeChange('edit')}>Editar</Button>
            ) : null}
          </>
        )
      }
    >
      {draft ? (
        <div className={`drawer-form ${mode === 'view' ? 'drawer-form--readonly' : ''}`}>
          <Field label="Empresa" value={lead?.company ?? ''} readOnly />
          <Field label="Telefone" value={lead?.phone ?? ''} readOnly />
          <Field label="Ramo" value={lead?.branch ?? ''} readOnly />
          <Field label="Tipo" value={lead?.type ?? ''} readOnly />
          <Field label="Chip" value={lead?.chip_label || lead?.chip_instance || lead?.chip || ''} readOnly />
          <Field label="Template ID" value={lead?.template_id ?? ''} readOnly />
          <Field label="Status" value={lead ? statusLabel(lead.status) : ''} readOnly />
          <Field label="Posição na fila" type="number" min="1" value={draft.position} readOnly={mode === 'view'} onChange={(value) => updateDraft('position', value)} />
          <Field label="Agendado para" type="date" value={draft.scheduled_date} readOnly={mode === 'view'} onChange={(value) => updateDraft('scheduled_date', value)} />
          <Field as="textarea" label="Mensagem 1 (template)" value={lead?.message1 ?? ''} readOnly />
          <Field as="textarea" label="Mensagem 2 (template)" value={lead?.message2 ?? ''} readOnly />
          <Field as="textarea" label="Mensagem 3 (template)" value={lead?.message3 ?? ''} readOnly />
          <Field as="textarea" label="Mensagem 4 (template)" value={lead?.message4 ?? ''} readOnly />
        </div>
      ) : null}
    </Drawer>
  );
}

function InstagramQueuePage() {
  const [activeProfile, setActiveProfile] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayInputValue);
  const [editingLead, setEditingLead] = useState<InstagramQueueLead | null>(null);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [confirmLead, setConfirmLead] = useState<InstagramQueueLead | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [approvedDrawerOpen, setApprovedDrawerOpen] = useState(false);

  const { profiles, batches, summary, loading, refreshing, error, refresh, updateLead, invalidate, reprocess } = useInstagramQueue(activeProfile, scheduledDate);
  const {
    page: batchPage,
    setPage: setBatchPage,
    rowsPerPage: batchesPerPage,
    setRowsPerPage: setBatchesPerPage,
    totalPages: batchTotalPages,
    pageItems: pagedBatches,
    resetPage: resetBatchPage,
  } = useClientPagination(batches, 10);

  useEffect(() => {
    if (activeProfile && !profiles.includes(activeProfile)) {
      setActiveProfile('');
    }
  }, [activeProfile, profiles]);

  useEffect(() => {
    resetBatchPage();
  }, [activeProfile, scheduledDate, resetBatchPage]);

  const visibleBatches = batches;

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [{ id, ...toast }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3400);
  };

  const handleSaveLead = async (draft: InstagramQueueDraft) => {
    if (!editingLead) return;
    const position = Number(draft.position);
    if (!Number.isSafeInteger(position) || position < 1) {
      pushToast({ title: 'Posição inválida', description: 'Informe uma posição inteira maior ou igual a 1.', tone: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await updateLead(editingLead.id, { position, scheduled_date: draft.scheduled_date });
      setEditingLead(null);
      setDrawerMode('view');
      pushToast({ title: 'Item de fila atualizado', description: 'Posição e agendamento foram persistidos em queue_items.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível atualizar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const handleInvalidate = async () => {
    if (!confirmLead) return;
    await invalidate(confirmLead);
    setConfirmLead(null);
    pushToast({ title: 'Lead invalidado', description: `${confirmLead.instagram} saiu da fila ativa.`, tone: 'warning' });
  };

  const handlePairExtension = async () => {
    const profile = activeProfile || (profiles.length === 1 ? profiles[0] : '');
    if (!profile) {
      pushToast({ title: 'Selecione um perfil', description: 'Escolha o perfil Instagram antes de gerar o vínculo.', tone: 'warning' });
      return;
    }
    setPairing(true);
    try {
      const pairing = await instagramExtensionGateway.pair(profile);
      let copied = false;
      try {
        await navigator.clipboard.writeText(pairing.token);
        copied = true;
      } catch {
        window.prompt(`Copie o token temporário para a extensão do perfil @${pairing.profile}:`, pairing.token);
      }
      const expires = pairing.expiresAt ? new Date(pairing.expiresAt).toLocaleString('pt-BR') : 'nas próximas horas';
      pushToast({
        title: copied ? 'Token copiado' : 'Token gerado',
        description: `${copied ? 'Cole' : 'Use o token exibido'} na extensão do perfil @${pairing.profile}. Expira em ${expires}.`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Falha ao vincular extensão', description: err instanceof Error ? err.message : 'Não foi possível gerar o vínculo.', tone: 'danger' });
    } finally {
      setPairing(false);
    }
  };

  const handleReprocessErrors = async () => {
    const errorIds = visibleBatches.flatMap((batch) => batch.leads).filter((lead) => isStatusGroup(lead.status, 'error')).map((lead) => lead.id);
    if (!errorIds.length) {
      pushToast({ title: 'Sem erros', description: 'Não há itens com erro neste filtro.', tone: 'warning' });
      return;
    }
    setReprocessing(true);
    try {
      await reprocess(errorIds);
      pushToast({ title: 'Itens liberados', description: `${errorIds.length} item(ns) voltaram para a fila.`, tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Falha ao reprocessar', description: err instanceof Error ? err.message : 'Não foi possível reprocessar os itens.', tone: 'danger' });
    } finally {
      setReprocessing(false);
    }
  };

  const profileFilterOptions = [{ label: 'Todos os perfis', value: '' }, ...profiles.map((profile) => ({ label: profile, value: profile }))];
  const scopeLabel = activeProfile || 'Todos os perfis';

  return (
    <div className="queue-page queue-page--instagram">
      <PageHeader title="Fila Instagram" action={<Field label="Data" type="date" iconLeft={Calendar} value={scheduledDate} onChange={setScheduledDate} />} />
      <section className="metric-grid metric-grid--5">
        <MetricCard icon={Users} value={String(summary.total)} label="Total" />
        <MetricCard icon={List} value={String(summary.queued)} label="Em fila" tone="primary" />
        <MetricCard icon={Send} value={String(summary.sent)} label="Enviados" tone="success" />
        <MetricCard icon={Bug} value={String(summary.errors)} label="Erros" tone="warning" />
        <MetricCard icon={X} value={String(summary.invalid)} label="Invalidos" tone="danger" />
      </section>
      <div className="queue-topline queue-topline--actions">
        <div className="queue-controls">
          <SelectField className="queue-inline-filter" options={profileFilterOptions} value={activeProfile} onChange={setActiveProfile} placeholder="Todos os perfis" />
          <Button variant="secondary" iconLeft={ListPlus} disabled={loading} onClick={() => setApprovedDrawerOpen(true)}>Puxar aprovados</Button>
          <Button variant="secondary" iconLeft={RefreshCcw} loading={reprocessing} disabled={loading || reprocessing} onClick={handleReprocessErrors}>Reprocessar erros</Button>
          <Button iconLeft={Send} loading={pairing} disabled={loading || pairing} onClick={handlePairExtension}>Vincular extensão</Button>
        </div>
      </div>
      <section className="queue-list-card">
        <div className="queue-list-card__header">
          <h2>Listagem de disparos - {scopeLabel}</h2>
        </div>
        {refreshing && visibleBatches.length ? <small className="queue-refresh-indicator" role="status">Atualizando fila sem interromper os lotes...</small> : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading && !visibleBatches.length ? <div className="table-message">Carregando fila Instagram...</div> : null}
        {!error && !loading && !refreshing && !visibleBatches.length ? <div className="table-message">Nenhum lote Instagram disponivel.</div> : null}
        <div className="batch-list">
          {!error ? pagedBatches.map((batch, index) => (
            <InstagramBatch
              key={batch.id}
              batch={batch}
              showScope={!activeProfile}
              defaultExpanded={index === 0}
              onEdit={(lead) => { setEditingLead(lead); setDrawerMode('view'); }}
              onInvalidate={setConfirmLead}
            />
          )) : null}
        </div>
        {visibleBatches.length ? (
          <div className="queue-list-card__footer">
            <div className="queue-list-card__footer-left">
              <RowsPerPageControl value={batchesPerPage} onChange={setBatchesPerPage} />
              <small>Mostrando {pagedBatches.length} de {visibleBatches.length} lote(s)</small>
            </div>
            <Pagination page={batchPage} totalPages={batchTotalPages} onPageChange={setBatchPage} />
          </div>
        ) : null}
      </section>

      <ApprovedLeadsQueueDrawer
        open={approvedDrawerOpen}
        channel="Instagram"
        scheduledDate={scheduledDate}
        preferredResourceId={activeProfile}
        onClose={() => setApprovedDrawerOpen(false)}
        onPrepared={refresh}
        onToast={(title, description, tone) => pushToast({ title, description, tone })}
      />
      <InstagramLeadDrawer lead={editingLead} mode={drawerMode} saving={saving} onModeChange={setDrawerMode} onClose={() => { setEditingLead(null); setDrawerMode('view'); }} onSave={handleSaveLead} />
      <ConfirmDialog
        open={Boolean(confirmLead)}
        title="Invalidar lead do Instagram?"
        description="Essa ação marca o lead como inválido localmente e remove da execução do lote."
        confirmLabel="Invalidar"
        danger
        onClose={() => setConfirmLead(null)}
        onConfirm={handleInvalidate}
      />
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

type InstagramQueueDraft = { position: string; scheduled_date: string };

function InstagramBatch({
  batch,
  defaultExpanded = false,
  showScope = false,
  onEdit,
  onInvalidate,
}: {
  batch: InstagramQueueBatch;
  defaultExpanded?: boolean;
  showScope?: boolean;
  onEdit: (lead: InstagramQueueLead) => void;
  onInvalidate: (lead: InstagramQueueLead) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [openRow, setOpenRow] = useState('');

  const stats = useMemo(
    () => ({
      sent: batch.leads.filter((lead) => isStatusGroup(lead.status, 'sent')).length,
      queued: batch.leads.filter((lead) => isStatusGroup(lead.status, 'queued') || isStatusGroup(lead.status, 'paused')).length,
      errors: batch.leads.filter((lead) => isStatusGroup(lead.status, 'error')).length,
      invalid: batch.leads.filter((lead) => isStatusGroup(lead.status, 'invalid')).length,
    }),
    [batch.leads],
  );

  return (
    <article className={`batch ${expanded ? 'batch--expanded' : ''}`}>
      <button className="batch__header" type="button" onClick={() => setExpanded((current) => !current)}>
        <strong>{showScope ? `${batch.profile} • ` : ''}Lote {String(batch.number).padStart(2, '0')}</strong>
        <span>{batch.leads.length}/{batch.limit}</span>
        <span>{stats.sent} enviados</span>
        <span>{stats.queued} aguardando</span>
        <span>{stats.errors} erros</span>
        <span>{stats.invalid} inválidos</span>
        {expanded ? <ChevronUp size={16} strokeWidth={1.8} /> : <ChevronDown size={16} strokeWidth={1.8} />}
      </button>
      {expanded ? (
        <div className="batch__rows">
          {batch.leads.map((lead) => (
            <div className={`batch-row ${openRow === lead.id ? 'batch-row--open' : ''}`} key={lead.id}>
              <div className="batch-row__summary batch-row__summary--instagram">
                <span className="batch-row__company">
                  {instagramHref(lead) ? (
                    <a href={instagramHref(lead)} target="_blank" rel="noreferrer">{lead.company}</a>
                  ) : (
                    lead.company
                  )}
                </span>
                <span className="batch-row__tags">
                  <Tag>{lead.branch}</Tag>
                  {String(lead.type) !== siteBadgeLabel(lead) ? <Tag>{lead.type}</Tag> : null}
                  <Tag>{siteBadgeLabel(lead)}</Tag>
                  <Tag tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Tag>
                </span>
                <span className="batch-row__icons">
                  <button type="button" className="batch-row__action" onClick={() => onEdit(lead)} aria-label="Visualizar lead">
                    <Eye size={18} />
                  </button>
                  <button type="button" className="batch-row__action batch-row__action--danger" disabled={!permissionsFor('instagram-queue', lead.status).canInvalidate()} onClick={() => onInvalidate(lead)} aria-label="Invalidar lead">
                    <Flag size={18} />
                  </button>
                  <button type="button" className="batch-row__toggle" onClick={() => setOpenRow(openRow === lead.id ? '' : lead.id)}>
                    {openRow === lead.id ? <ChevronUp size={16} strokeWidth={1.8} /> : <ChevronDown size={16} strokeWidth={1.8} />}
                  </button>
                </span>
              </div>
              {openRow === lead.id ? (
                <div className="message-preview-grid">
                  <MessagePreview title="Mensagem 1" text={lead.message1} />
                  <MessagePreview title="Mensagem 2" text={lead.message2} />
                  <MessagePreview title="Mensagem 3" text={lead.message3} />
                  <MessagePreview title="Mensagem 4" text={lead.message4} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function InstagramLeadDrawer({
  lead,
  mode,
  saving,
  onModeChange,
  onClose,
  onSave,
}: {
  lead: InstagramQueueLead | null;
  mode: 'view' | 'edit';
  saving: boolean;
  onModeChange: (mode: 'view' | 'edit') => void;
  onClose: () => void;
  onSave: (draft: InstagramQueueDraft) => void;
}) {
  const [draft, setDraft] = useState<InstagramQueueDraft | null>(null);

  useEffect(() => {
    if (!lead) {
      setDraft(null);
      return;
    }

    setDraft({
      position: String(lead.position),
      scheduled_date: lead.scheduled_date,
    });
  }, [lead]);

  const updateDraft = (key: keyof InstagramQueueDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <Drawer
      open={Boolean(lead && draft)}
      title={mode === 'edit' ? 'Editar item da fila Instagram' : 'Detalhes do item da fila Instagram'}
      description="Somente posição e agendamento pertencem ao item da fila. Lead, perfil e template são referências canônicas e devem ser alterados em seus próprios cadastros."
      onClose={onClose}
      footer={
        mode === 'edit' ? (
          <>
            <Button variant="secondary" onClick={() => onModeChange('view')}>Cancelar</Button>
            <Button loading={saving} onClick={() => draft && onSave(draft)}>Salvar</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            {lead && permissionsFor('instagram-queue', lead.status).canEdit() ? (
              <Button onClick={() => onModeChange('edit')}>Editar</Button>
            ) : null}
          </>
        )
      }
    >
      {draft ? (
        <div className={`drawer-form ${mode === 'view' ? 'drawer-form--readonly' : ''}`}>
          <Field label="Empresa" value={lead?.company ?? ''} readOnly />
          <Field label="Instagram" value={lead?.instagram_username || lead?.instagram || ''} readOnly />
          <Field label="Ramo" value={lead?.branch ?? ''} readOnly />
          <Field label="Tipo" value={lead?.type ?? ''} readOnly />
          <Field label="Perfil remetente" value={lead?.profile ?? ''} readOnly />
          <Field label="Template ID" value={lead?.template_id ?? ''} readOnly />
          <Field label="Status" value={lead ? statusLabel(lead.status) : ''} readOnly />
          <Field label="Posição na fila" type="number" min="1" value={draft.position} readOnly={mode === 'view'} onChange={(value) => updateDraft('position', value)} />
          <Field label="Agendado para" type="date" value={draft.scheduled_date} readOnly={mode === 'view'} onChange={(value) => updateDraft('scheduled_date', value)} />
          <Field as="textarea" label="Mensagem 1 (template)" value={lead?.message1 ?? ''} readOnly />
          <Field as="textarea" label="Mensagem 2 (template)" value={lead?.message2 ?? ''} readOnly />
          <Field as="textarea" label="Mensagem 3 (template)" value={lead?.message3 ?? ''} readOnly />
          <Field as="textarea" label="Mensagem 4 (template)" value={lead?.message4 ?? ''} readOnly />
        </div>
      ) : null}
    </Drawer>
  );
}

function MessagePreview({ title, text }: { title: string; text?: string }) {
  return (
    <div className="message-preview">
      <strong>{title}</strong>
      <div className="message-preview__body">
        <p>
          {text ?? 'Mensagem sera aplicada pelo template configurado para o ramo e tipo do lead.'}
        </p>
      </div>
    </div>
  );
}
