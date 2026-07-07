import { useEffect, useMemo, useState } from 'react';
import { Bug, Calendar, CheckSquare, ChevronDown, ChevronUp, Eye, Flag, List, Pause, Play, RefreshCcw, Send, Square, Users, X } from 'lucide-react';
import { Button, ConfirmDialog, Drawer, Field, MetricCard, SegmentedControl, SelectField, Tag, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useInstagramQueue } from '../hooks/useInstagramQueue';
import { useWhatsAppQueue } from '../hooks/useWhatsAppQueue';
import type { InstagramQueueBatch, InstagramQueueLead, InstagramQueueStatus } from '../services/instagram-queue/types';
import { permissionsFor } from '../services/permissions';
import { isStatusGroup, statusLabel, statusTone } from '../services/status/status.mapper';
import { hasWhatsAppOperationalIssue, hasWhatsAppWorkerContract } from '../services/whatsapp-queue/whatsappQueue.guards';
import type { WhatsAppQueueBatch, WhatsAppQueueLead, WhatsAppQueueStatus } from '../services/whatsapp-queue/types';
import { toLocalDateInputValue } from '../utils/date';
import { hasWebsiteForTemplate } from '../services/templates/templateSelector';

type QueuePageProps = {
  channel: 'whatsapp' | 'instagram';
};

type QueueDraft = Pick<WhatsAppQueueLead, 'company' | 'phone' | 'branch' | 'type' | 'message1' | 'message2' | 'imageName'>;

const legacyWhatsAppStatusLabel: Record<WhatsAppQueueStatus, string> = {
  queued: 'Em fila',
  sending: 'Enviando',
  sent: 'Enviada',
  paused: 'Pausada',
  error: 'Erro',
  invalid: 'Inválida',
};

const typeOptions = ['Sem site', 'Com site'];

const legacyInstagramStatusLabel: Record<InstagramQueueStatus, string> = {
  queued: 'Em fila',
  following: 'Seguindo',
  dm_opened: 'DM aberta',
  sent: 'Enviada',
  paused: 'Pausada',
  error: 'Erro',
  invalid: 'Inválida',
};

const instagramTypeOptions = ['Instagram', 'Sem WhatsApp'];

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

  const { chips, batches, summary, batchState, loading, refreshing, error, updateLead, startBatch, pauseBatch, resumeBatch, stopBatch, reprocess, invalidate } = useWhatsAppQueue(activeChip, scheduledDate);
  const running = batchState.enabled && batchState.status === 'running';

  useEffect(() => {
    if ((!activeChip || !chips.includes(activeChip)) && chips[0]) {
      setActiveChip(chips[0]);
    }
    if (activeChip && !chips.includes(activeChip) && !chips.length) {
      setActiveChip('');
    }
  }, [activeChip, chips]);

  useEffect(() => {
    setSelectedIds([]);
    setStarting(false);
  }, [activeChip, scheduledDate]);

  const visibleLeads = () => batches.flatMap((batch) => batch.leads);
  const visibleActionIds = (predicate: (lead: WhatsAppQueueLead) => boolean) => visibleLeads().filter(predicate).map((lead) => lead.id);
  const isRunnableLead = (lead: WhatsAppQueueLead) =>
    hasWhatsAppWorkerContract(lead) && (permissionsFor('whatsapp-queue', lead.status).canSend() || permissionsFor('whatsapp-queue', lead.status).canResume());
  const selectedOrRunnableIds = () =>
    selectedIds.length
      ? visibleLeads().filter((lead) => selectedIds.includes(lead.id) && isRunnableLead(lead)).map((lead) => lead.id)
      : visibleActionIds(isRunnableLead);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [{ id, ...toast }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3400);
  };

  const handleStart = async () => {
    const ids = selectedOrRunnableIds();
    if (!ids.length) {
      pushToast({ title: 'Nada para iniciar', description: 'Nao ha leads em fila ou pausados no lote visivel.', tone: 'warning' });
      return;
    }

    setStarting(true);
    try {
      const state = await startBatch(ids);
      setSelectedIds(ids);
      const next = state.next_run_at ? new Date(state.next_run_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'agora';
      pushToast({
        title: state.already_running ? 'Lote já está em execução' : 'Lote iniciado',
        description: `${ids.length} lead(s). Próximo envio: ${next}. O Worker continuará mesmo com esta tela fechada.`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Não foi possível iniciar o lote', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setStarting(false);
    }
  };

  const handlePause = async () => {
    try {
      await pauseBatch(activeChip);
      pushToast({ title: 'Lote pausado', description: 'Nenhum novo lead será enviado até você retomar o lote.', tone: 'info' });
    } catch (err) {
      pushToast({ title: 'Não foi possível pausar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleResume = async () => {
    try {
      await resumeBatch(activeChip);
      pushToast({ title: 'Lote retomado', description: 'O Worker continuará a partir do próximo lead pendente.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível retomar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleStop = async () => {
    try {
      await stopBatch(activeChip);
      setSelectedIds([]);
      pushToast({ title: 'Lote encerrado', description: 'Os itens restantes continuam em fila e podem ser iniciados depois.', tone: 'warning' });
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

    await reprocess(ids);
    setStarting(false);
    setSelectedIds([]);
    pushToast({ title: 'Leads reprocessados', description: `${ids.length} lead(s) voltaram para a fila.`, tone: 'success' });
  };

  const handleSaveLead = async (draft: QueueDraft) => {
    if (!editingLead) return;
    setSaving(true);
    await updateLead(editingLead.id, draft);
    setSaving(false);
    setEditingLead(null);
    setDrawerMode('view');
    pushToast({ title: 'Lead atualizado', description: 'Alterações salvas na fila local.', tone: 'success' });
  };

  const handleInvalidate = async () => {
    if (!confirmLead) return;
    await invalidate(confirmLead);
    setConfirmLead(null);
    setSelectedIds((current) => current.filter((id) => id !== confirmLead.id));
    pushToast({ title: 'Lead invalidado', description: `${confirmLead.company} saiu da fila ativa.`, tone: 'warning' });
  };

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

      <div className="queue-topline">
        <SegmentedControl items={chips.length ? chips : ['Geral']} active={activeChip || chips[0] || 'Geral'} onChange={setActiveChip} compact />
        <div className="queue-controls">
          <Button variant="danger" iconLeft={Square} disabled={!running && batchState.status !== 'paused'} onClick={handleStop}>Parar</Button>
          {running ? (
            <Button variant="secondary" iconLeft={Pause} onClick={handlePause}>Pausar</Button>
          ) : batchState.status === 'paused' ? (
            <Button variant="secondary" iconLeft={Play} onClick={handleResume}>Retomar</Button>
          ) : null}
          <Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || starting || running} onClick={handleReprocess}>Reprocessar</Button>
          <Button iconLeft={Play} disabled={loading || starting || running || batchState.status === 'paused'} onClick={handleStart}>{starting ? 'Iniciando...' : running ? 'Em execução' : 'Iniciar lote'}</Button>
        </div>
        {(running || batchState.status === 'paused') && (
          <small className="queue-batch-status">
            {batchState.status === 'paused' ? 'Lote pausado' : `Lote em execução • ${batchState.remaining} restante(s)`}
            {batchState.next_run_at ? ` • próximo: ${new Date(batchState.next_run_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </small>
        )}
      </div>

      <section className="queue-list-card">
        <h2>Listagem de disparos{activeChip || chips[0] ? ` - ${activeChip || chips[0]}` : ''}</h2>
        {refreshing && batches.length ? <small className="queue-refresh-indicator" role="status">Atualizando fila sem interromper os lotes...</small> : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading && !batches.length ? <div className="table-message">Carregando fila WhatsApp...</div> : null}
        {!error && !loading && !refreshing && !batches.length ? <div className="table-message">Nenhum lote WhatsApp disponivel.</div> : null}
        <div className="batch-list">
          {!error ? batches.map((batch, index) => (
            <WhatsAppBatch
              key={batch.id}
              batch={batch}
              defaultExpanded={index === 0}
              onEdit={(lead) => { setEditingLead(lead); setDrawerMode('view'); }}
              onInvalidate={setConfirmLead}
            />
          )) : null}
        </div>
      </section>

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
  onEdit,
  onInvalidate,
}: {
  batch: WhatsAppQueueBatch;
  defaultExpanded?: boolean;
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
        <strong>Lote {String(batch.number).padStart(2, '0')}</strong>
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
                  <Tag>{lead.type}</Tag>
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
      company: lead.company,
      phone: lead.phone,
      branch: lead.branch,
      type: lead.type,
      message1: lead.message1,
      message2: lead.message2,
      imageName: lead.imageName,
    });
  }, [lead]);

  const updateDraft = (key: keyof QueueDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <Drawer
      open={Boolean(lead && draft)}
      title={mode === 'edit' ? 'Editar lead do lote' : 'Detalhes do lead'}
      description="Atualize os dados localmente antes do envio pelo gateway configurado."
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
          <Field label="Empresa" value={draft.company} readOnly={mode === 'view'} onChange={(value) => updateDraft('company', value)} />
          <Field label="Telefone" value={draft.phone} readOnly={mode === 'view'} onChange={(value) => updateDraft('phone', value)} />
          <Field label="Ramo" value={draft.branch} readOnly={mode === 'view'} onChange={(value) => updateDraft('branch', value)} />
          <label className="drawer-field-group">
            <span>Tipo</span>
            {mode === 'view' ? <Field value={draft.type} readOnly /> : <SelectField options={typeOptions} value={draft.type} onChange={(value) => updateDraft('type', value)} />}
          </label>
          <Field label="Status" value={lead ? statusLabel(lead.status) : ''} readOnly />
          <Field label="Nome da imagem" value={draft.imageName ?? ''} readOnly={mode === 'view'} onChange={(value) => updateDraft('imageName', value)} />
          <Field as="textarea" label="Mensagem 1" value={draft.message1} readOnly={mode === 'view'} onChange={(value) => updateDraft('message1', value)} />
          <Field as="textarea" label="Mensagem 2" value={draft.message2} readOnly={mode === 'view'} onChange={(value) => updateDraft('message2', value)} />
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

  const { profiles, batches, summary, loading, refreshing, error, updateLead, invalidate } = useInstagramQueue(activeProfile, scheduledDate);

  useEffect(() => {
    if (!activeProfile && profiles[0]) {
      setActiveProfile(profiles[0]);
    }
  }, [activeProfile, profiles]);

  const visibleBatches = batches;

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [{ id, ...toast }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3400);
  };

  const handleSaveLead = async (draft: InstagramQueueDraft) => {
    if (!editingLead) return;
    setSaving(true);
    await updateLead(editingLead.id, draft);
    setSaving(false);
    setEditingLead(null);
    setDrawerMode('view');
    pushToast({ title: 'Lead Instagram atualizado', description: 'Alterações salvas na fila local.', tone: 'success' });
  };

  const handleInvalidate = async () => {
    if (!confirmLead) return;
    await invalidate(confirmLead);
    setConfirmLead(null);
    pushToast({ title: 'Lead invalidado', description: `${confirmLead.instagram} saiu da fila ativa.`, tone: 'warning' });
  };

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
      <div className="queue-topline">
        <SegmentedControl items={profiles.length ? profiles : ['Geral']} active={activeProfile || profiles[0] || 'Geral'} onChange={setActiveProfile} compact />
      </div>
      <section className="queue-list-card">
        <h2>Listagem de disparos{activeProfile || profiles[0] ? ` - ${activeProfile || profiles[0]}` : ''}</h2>
        {refreshing && visibleBatches.length ? <small className="queue-refresh-indicator" role="status">Atualizando fila sem interromper os lotes...</small> : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading && !visibleBatches.length ? <div className="table-message">Carregando fila Instagram...</div> : null}
        {!error && !loading && !refreshing && !visibleBatches.length ? <div className="table-message">Nenhum lote Instagram disponivel.</div> : null}
        <div className="batch-list">
          {!error ? visibleBatches.map((batch, index) => (
            <InstagramBatch
              key={batch.id}
              batch={batch}
              defaultExpanded={index === 0}
              onEdit={(lead) => { setEditingLead(lead); setDrawerMode('view'); }}
              onInvalidate={setConfirmLead}
            />
          )) : null}
        </div>
      </section>

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

type InstagramQueueDraft = Pick<InstagramQueueLead, 'company' | 'instagram' | 'branch' | 'type' | 'message1' | 'message2' | 'imageName' | 'invalidReason'>;

function InstagramBatch({
  batch,
  defaultExpanded = false,
  onEdit,
  onInvalidate,
}: {
  batch: InstagramQueueBatch;
  defaultExpanded?: boolean;
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
        <strong>Lote {String(batch.number).padStart(2, '0')}</strong>
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
                  <Tag>{lead.type}</Tag>
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
      company: lead.company,
      instagram: lead.instagram,
      branch: lead.branch,
      type: lead.type,
      message1: lead.message1,
      message2: lead.message2,
      imageName: lead.imageName,
      invalidReason: lead.invalidReason ?? '',
    });
  }, [lead]);

  const updateDraft = (key: keyof InstagramQueueDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <Drawer
      open={Boolean(lead && draft)}
      title={mode === 'edit' ? 'Editar lead do Instagram' : 'Detalhes do lead'}
      description="Atualize os dados localmente antes do envio pelo gateway configurado."
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
          <Field label="Empresa" value={draft.company} readOnly={mode === 'view'} onChange={(value) => updateDraft('company', value)} />
          <Field label="Instagram" value={draft.instagram} readOnly={mode === 'view'} onChange={(value) => updateDraft('instagram', value)} />
          <Field label="Ramo" value={draft.branch} readOnly={mode === 'view'} onChange={(value) => updateDraft('branch', value)} />
          <label className="drawer-field-group">
            <span>Tipo</span>
            {mode === 'view' ? <Field value={draft.type} readOnly /> : <SelectField options={instagramTypeOptions} value={draft.type} onChange={(value) => updateDraft('type', value)} />}
          </label>
          <Field label="Status" value={lead ? statusLabel(lead.status) : ''} readOnly />
          <Field label="Nome da imagem" value={draft.imageName ?? ''} readOnly={mode === 'view'} onChange={(value) => updateDraft('imageName', value)} />
          <Field label="Motivo de invalidação" value={draft.invalidReason ?? ''} readOnly={mode === 'view'} onChange={(value) => updateDraft('invalidReason', value)} />
          <Field as="textarea" label="Mensagem 1" value={draft.message1} readOnly={mode === 'view'} onChange={(value) => updateDraft('message1', value)} />
          <Field as="textarea" label="Mensagem 2" value={draft.message2} readOnly={mode === 'view'} onChange={(value) => updateDraft('message2', value)} />
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
