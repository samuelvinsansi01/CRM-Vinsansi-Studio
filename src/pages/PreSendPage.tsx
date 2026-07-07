import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Instagram, PhoneCall, RefreshCcw, RotateCcw, Save, Send, TableProperties } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  MetricCard,
  Pagination,
  Panel,
  SelectField,
  Tag,
  ToastViewport,
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { usePreSend, usePreSendQueue } from '../hooks/usePreSend';
import { isValidInstagram } from '../services/instagram/instagram.utils';
import { permissionsFor } from '../services/permissions';
import { preSendService } from '../services/pre-send/preSend.service';
import type { InstagramQueueFillResult, PreSendChannel, PreSendDayCard, PreSendLead, PreSendQueueFilter, PreSendSummary, PreSendValidationSummary } from '../services/pre-send/types';
import { normalizeStatusGroup, statusLabel, statusTone } from '../services/status/status.mapper';

type PreSendForm = {
  company: string;
  branch: string;
  destination: string;
  phone: string;
  instagram: string;
  site: string;
  send_instagram: 'Sim' | 'Não';
  instagram_override_reason: string;
  city: string;
  state: string;
};

type QueueTableRow = Record<string, ReactNode> & {
  id: string;
  empresa: ReactNode;
  ramo: string;
  contato: ReactNode;
  status: JSX.Element;
};

const queueFilterOptions: PreSendQueueFilter[] = ['Geral', 'WhatsApp', 'Com site + Agregadores'];
const defaultManualSentReason = 'Marcado manualmente como ja enviado no Pre-Envio.';

function silentLink(label: string, href?: string) {
  if (!href) return label;
  return <a className="silent-link" href={href} target="_blank" rel="noreferrer" title={href}>{label}</a>;
}

function ensureUrl(value?: string | null) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function mapsHref(lead: PreSendLead) {
  if (lead.mapsUrl?.trim()) return ensureUrl(lead.mapsUrl);
  const query = [lead.company, lead.city, lead.state].filter(Boolean).join(' ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function instagramHref(value?: string | null) {
  const instagram = String(value ?? '').trim();
  if (!instagram) return '';
  if (/^https?:\/\//i.test(instagram)) return instagram;
  return `https://instagram.com/${instagram.replace(/^@/, '')}`;
}

function toForm(lead: PreSendLead): PreSendForm {
  return {
    company: lead.company,
    branch: lead.branch,
    destination: lead.destination,
    phone: lead.phone ?? '',
    instagram: lead.instagram ?? '',
    site: lead.site ?? '',
    send_instagram: lead.send_instagram ? 'Sim' : 'Não',
    instagram_override_reason: lead.instagram_override_reason ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
  };
}

function canMarkAlreadySent(lead: PreSendLead) {
  return ['review', 'approved', 'pending', 'rejected', 'invalid'].includes(normalizeStatusGroup(lead.status));
}

function daySelectionKey(dayId: string) {
  return dayId.replace(/^whatsapp-/, '').replace(/^instagram-/, '');
}

function DayLimitGrid({ dayCards, activeDayKey, onDayChange }: { dayCards: PreSendDayCard[]; activeDayKey: string; onDayChange: (dayId: string) => void }) {
  return (
    <section className="day-limit-grid">
      {dayCards.map((day) => (
        <button className={`day-card ${day.isToday ? 'day-card--today' : ''} ${daySelectionKey(day.id) === activeDayKey ? 'day-card--active' : ''} ${day.queued > 0 ? 'day-card--has-leads' : ''} ${day.limit > 0 && day.queued >= day.limit ? 'day-card--complete' : ''}`} type="button" key={day.id} onClick={() => onDayChange(day.id)}>
          <small>{day.channel}</small>
          <strong>{day.queued}/{day.limit}</strong>
          <span>{day.label}</span>
        </button>
      ))}
    </section>
  );
}

function ValidationQueue({
  title,
  channel,
  activeDayId,
  onToast,
  onRefreshSummary,
  moveApprovedImportsToQueue,
  validateLead,
  validateLeads,
  revalidateApprovedLeads,
  invalidateLead,
  archiveLead,
  markAlreadySent,
  updateLead,
  onScopeChange,
}: {
  title: string;
  channel: PreSendChannel;
  activeDayId: string;
  onToast: (toast: Omit<ToastItem, 'id'>) => void;
  onRefreshSummary: () => void;
  moveApprovedImportsToQueue: (input: { channel: PreSendChannel; dayId: string; profile?: string; queueFilter?: PreSendQueueFilter }) => Promise<number>;
  validateLead: (id: string) => Promise<void>;
  validateLeads: (ids: string[]) => Promise<PreSendValidationSummary>;
  revalidateApprovedLeads: (ids: string[]) => Promise<PreSendValidationSummary>;
  invalidateLead: (id: string) => Promise<void>;
  archiveLead: (id: string) => Promise<void>;
  markAlreadySent: (ids: string[], reason?: string) => Promise<number>;
  updateLead: (id: string, input: Partial<PreSendLead>) => Promise<InstagramQueueFillResult | undefined>;
  onScopeChange?: (scope: { profile: string; queueFilter: PreSendQueueFilter }) => void;
}) {
  const [activeProfile, setActiveProfile] = useState('');
  const [queueFilter, setQueueFilter] = useState<PreSendQueueFilter>('Geral');
  const [page, setPage] = useState(1);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fillSaving, setFillSaving] = useState(false);
  const [initialValidationSaving, setInitialValidationSaving] = useState(false);
  const [revalidationSaving, setRevalidationSaving] = useState(false);
  const [editingLead, setEditingLead] = useState<PreSendLead | null>(null);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [leadForm, setLeadForm] = useState<PreSendForm | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PreSendLead | null>(null);
  const [sentTarget, setSentTarget] = useState<PreSendLead | null>(null);
  const [sentReason, setSentReason] = useState(defaultManualSentReason);

  const { profiles, leads, loading, error, capacity } = usePreSendQueue(channel, activeDayId, activeProfile, queueFilter, refreshToken);

  useEffect(() => {
    if (!profiles.length) return;
    if (!activeProfile || !profiles.includes(activeProfile)) {
      setActiveProfile(profiles[0]);
    }
  }, [activeProfile, profiles]);

  useEffect(() => {
    onScopeChange?.({ profile: activeProfile || profiles[0] || '', queueFilter });
  }, [activeProfile, onScopeChange, profiles, queueFilter]);

  useEffect(() => {
    setPage(1);
    setSelectedRows([]);
  }, [activeDayId, activeProfile, queueFilter]);

  const totalPages = Math.max(1, Math.ceil(leads.length / 10));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => leads.slice((currentPage - 1) * 10, currentPage * 10), [leads, currentPage]);
  const selectedIds = selectedRows.map((rowIndex) => pageRows[rowIndex]?.id).filter(Boolean);
  const selectedLeads = selectedRows.map((rowIndex) => pageRows[rowIndex]).filter((lead): lead is PreSendLead => Boolean(lead));
  const approvableIds = useMemo(() => leads.filter((lead) => permissionsFor('pre-send', lead.status).canApprove()).map((lead) => lead.id), [leads]);
  const approvedIds = useMemo(() => leads.filter((lead) => channel === 'WhatsApp' && normalizeStatusGroup(lead.status) === 'approved').map((lead) => lead.id), [channel, leads]);
  const canApproveSelection = selectedLeads.length > 0 && selectedLeads.every((lead) => permissionsFor('pre-send', lead.status).canApprove());
  const canRevalidateSelection = selectedLeads.length > 0 && selectedLeads.every((lead) => channel === 'WhatsApp' && normalizeStatusGroup(lead.status) === 'approved');
  const selectedApprovableIds = canApproveSelection ? selectedIds : [];
  const selectedRevalidationIds = canRevalidateSelection ? selectedIds : [];
  const emptyProfileLabel = channel === 'WhatsApp' ? 'Sem chip ativo' : 'Sem perfil';
  const hasOperationalProfile = profiles.length > 0 && Boolean(activeProfile || profiles[0]);

  const refreshQueue = () => {
    setRefreshToken((current) => current + 1);
    onRefreshSummary();
  };

  const tableRows = pageRows.map((lead) => ({
    id: lead.id,
    empresa: silentLink(lead.company, mapsHref(lead)),
    ramo: lead.branch,
    contato: channel === 'WhatsApp'
      ? lead.phone ?? ''
      : silentLink(lead.instagram ?? lead.instagram_url ?? '', instagramHref(lead.instagram_url ?? lead.instagram)),
    status: <Tag tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Tag>,
  }));

  const columns: TableColumn<QueueTableRow>[] = [
    { key: 'empresa', label: 'Nome da empresa', width: '34%' },
    { key: 'ramo', label: 'Ramo', width: '22%' },
    { key: 'contato', label: channel === 'WhatsApp' ? 'Telefone' : 'Instagram', width: '22%' },
    { key: 'status', label: 'Status', width: '14%' },
  ];

  const findLead = (row: QueueTableRow) => pageRows.find((lead) => lead.id === row.id);

  const openLeadDrawer = (lead: PreSendLead, mode: 'view' | 'edit' = 'view') => {
    setEditingLead(lead);
    setLeadForm(toForm(lead));
    setDrawerMode(mode);
  };

  const saveLead = async () => {
    if (!editingLead || !leadForm) return;

    setSaving(true);
    try {
      const sendInstagram = leadForm.send_instagram === 'Sim';
      if (sendInstagram && !isValidInstagram(leadForm.instagram)) {
        onToast({ title: 'Lead sem Instagram válido', description: 'Informe um Instagram válido antes de enviar este lead ao fluxo Instagram.', tone: 'danger' });
        return;
      }

      const queueResult = await updateLead(editingLead.id, {
        company: leadForm.company,
        branch: leadForm.branch,
        destination: (sendInstagram ? 'Instagram' : leadForm.destination) as PreSendLead['destination'],
        phone: leadForm.phone,
        instagram: leadForm.instagram,
        site: leadForm.site,
        send_instagram: sendInstagram,
        instagram_url: leadForm.instagram,
        destination_override: sendInstagram ? 'Instagram' : undefined,
        instagram_override_reason: sendInstagram ? leadForm.instagram_override_reason || 'Override manual para Instagram' : '',
        override_by: sendInstagram ? editingLead.override_by || 'Operador local' : '',
        override_at: sendInstagram ? editingLead.override_at || new Date().toISOString() : '',
        city: leadForm.city,
        state: leadForm.state,
      });
      setEditingLead(null);
      setLeadForm(null);
      setDrawerMode('view');
      refreshQueue();
      if (queueResult) {
        const details: string[] = [];
        if (queueResult.queued) details.push(`${queueResult.queued} lead(s) enviado(s) para a fila Instagram.`);
        if (queueResult.waitingPreSend) details.push(`${queueResult.waitingPreSend} aguardando capacidade do perfil.`);
        if (queueResult.blockedPreSend) details.push(`${queueResult.blockedPreSend} permaneceu(ram) no card Instagram por pendência operacional.`);
        if (!details.length) details.push('Link salvo. O lead permanece no card Instagram aguardando capacidade ou configuração.');
        const firstNotice = queueResult.notices[0];
        if (firstNotice) details.push(firstNotice);
        onToast({
          title: queueResult.queued ? 'Fila Instagram atualizada' : 'Instagram salvo no Pré-Envio',
          description: details.join(' '),
          tone: queueResult.queued ? 'success' : 'warning',
        });
      } else {
        onToast({ title: 'Lead atualizado', description: 'Pré-envio atualizado localmente.', tone: 'success' });
      }
    } catch (err) {
      onToast({ title: 'Não foi possível salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (action: TableAction, row: QueueTableRow) => {
    const lead = findLead(row);
    if (!lead) return;

    if (action === 'view' || action === 'edit') {
      openLeadDrawer(lead, action === 'edit' ? 'edit' : 'view');
      return;
    }

    if (action === 'invalidate') {
      try {
        await invalidateLead(lead.id);
        refreshQueue();
        onToast({ title: 'Lead invalidado', description: 'O lead foi retirado do fluxo ativo do Instagram.', tone: 'warning' });
      } catch (err) {
        onToast({ title: 'Não foi possível invalidar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
      }
      return;
    }

    if (action === 'archive' || action === 'cancel') {
      if (!permissionsFor('pre-send', lead.status).canArchive()) {
        onToast({ title: 'Acao bloqueada', description: 'Este lead nao pode ser arquivado neste estado.', tone: 'warning' });
        return;
      }
      setArchiveTarget(lead);
      return;
    }

    if (action === 'sent') {
      if (!canMarkAlreadySent(lead)) {
        onToast({ title: 'Acao bloqueada', description: 'Este lead nao pode ser marcado como enviado neste estado.', tone: 'warning' });
        return;
      }
      setSentTarget(lead);
      setSentReason(defaultManualSentReason);
      return;
    }

    if (action === 'approve') {
      if (!permissionsFor('pre-send', lead.status).canApprove()) {
        onToast({ title: 'Acao bloqueada', description: 'Este lead nao pode ser validado neste estado.', tone: 'warning' });
        return;
      }
      await validateLead(lead.id);
      refreshQueue();
      onToast({ title: 'Lead validado', description: 'Status atualizado localmente para aprovado.', tone: 'success' });
    }
  };

  const fillQueue = async () => {
    if (fillSaving || initialValidationSaving || revalidationSaving) return;
    setFillSaving(true);
    try {
      const moved = await moveApprovedImportsToQueue({ channel, dayId: activeDayId, profile: activeProfile || profiles[0] || '', queueFilter });
      setSelectedRows([]);
      refreshQueue();
      onToast({ title: 'Pre-envio preenchido', description: `${moved} lead(s) adicionado(s) para validacao.`, tone: 'success' });
    } catch (err) {
      onToast({ title: 'Erro ao preencher fila', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setFillSaving(false);
    }
  };

  const revalidateSelected = async () => {
    if (fillSaving || initialValidationSaving || revalidationSaving) return;
    if (selectedRows.length && !canRevalidateSelection) {
      onToast({ title: 'Selecao incompativel', description: 'Revalidar exige apenas leads WhatsApp ja aprovados.', tone: 'warning' });
      return;
    }
    const ids = selectedRevalidationIds.length ? selectedRevalidationIds : approvedIds;
    if (!ids.length) {
      onToast({ title: 'Nada para revalidar', description: 'Nao ha leads WhatsApp aprovados neste dia, chip e filtro.', tone: 'warning' });
      return;
    }

    setRevalidationSaving(true);
    try {
      const result = await revalidateApprovedLeads(ids);
      setSelectedRows([]);
      refreshQueue();
      onToast({
        title: 'Aprovados revalidados',
        description: `${result.approved} confirmado(s)${result.requiresReview ? `, ${result.requiresReview} para revisao` : ''}${result.errors ? `, ${result.errors} erro(s) do provider` : ''}${result.skipped ? `, ${result.skipped} ignorado(s)` : ''}. Nenhum lead foi enviado para fila.`,
        tone: result.errors || result.requiresReview ? 'warning' : 'success',
      });
    } catch (err) {
      onToast({ title: 'Erro ao revalidar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setRevalidationSaving(false);
    }
  };

  const validateSelected = async () => {
    if (fillSaving || initialValidationSaving || revalidationSaving) return;
    if (selectedRows.length && !canApproveSelection) {
      onToast({ title: 'Selecao incompativel', description: 'Validar exige que todos os selecionados possam ser aprovados.', tone: 'warning' });
      return;
    }
    const ids = selectedApprovableIds.length ? selectedApprovableIds : approvableIds;
    if (!ids.length) {
      onToast({ title: 'Nada para validar', description: 'Selecione leads ou filtre itens inválidos.', tone: 'warning' });
      return;
    }

    setInitialValidationSaving(true);
    try {
      const result = await validateLeads(ids);
      setSelectedRows([]);
      refreshQueue();
      onToast({
        title: 'Leads validados',
        description: `${result.approved} aprovado(s)${result.requiresReview ? `, ${result.requiresReview} para revisao` : ''}${result.returned ? `, ${result.returned} movido(s) para Instagram pendente de link` : ''}${result.errors ? `, ${result.errors} erro(s) do provider` : ''}${result.skipped ? `, ${result.skipped} ja aprovado(s)` : ''}.`,
        tone: result.errors ? 'warning' : 'success',
      });
    } catch (err) {
      onToast({ title: 'Erro ao validar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setInitialValidationSaving(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;

    try {
      await archiveLead(archiveTarget.id);
      setArchiveTarget(null);
      refreshQueue();
      onToast({ title: 'Lead arquivado', description: 'Registro removido do pré-envio local.', tone: 'warning' });
    } catch (err) {
      onToast({ title: 'Erro ao arquivar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const confirmMarkAlreadySent = async () => {
    if (!sentTarget) return;

    try {
      const marked = await markAlreadySent([sentTarget.id], sentReason.trim() || defaultManualSentReason);
      setSentTarget(null);
      setSentReason(defaultManualSentReason);
      refreshQueue();
      onToast({ title: 'Lead marcado como enviado', description: `${marked} lead(s) removido(s) do fluxo ativo.`, tone: 'success' });
    } catch (err) {
      onToast({ title: 'Erro ao marcar como enviado', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  return (
    <div className="validation-list">
      <div className="validation-list__header">
        {title ? <h3>{title}</h3> : null}
        {channel === 'WhatsApp' ? <SelectField options={queueFilterOptions} value={queueFilter} placeholder="Destino" onChange={(value) => setQueueFilter(value as PreSendQueueFilter)} /> : null}
        <SelectField options={profiles.length ? profiles : [emptyProfileLabel]} value={activeProfile || profiles[0] || emptyProfileLabel} placeholder={channel === 'WhatsApp' ? 'Chip' : 'Perfil'} onChange={setActiveProfile} />
        {channel === 'WhatsApp' ? <Button variant="secondary" iconLeft={TableProperties} size="sm" loading={fillSaving} disabled={!hasOperationalProfile || !capacity || capacity.available <= 0 || initialValidationSaving || revalidationSaving} onClick={fillQueue}>Preencher fila</Button> : null}
        {channel === 'WhatsApp' ? <Button variant="secondary" iconLeft={RefreshCcw} size="sm" loading={revalidationSaving} disabled={fillSaving || initialValidationSaving || (selectedRows.length ? !canRevalidateSelection : !approvedIds.length)} onClick={revalidateSelected}>Revalidar aprovados</Button> : null}
        {channel === 'WhatsApp' ? <Button size="sm" loading={initialValidationSaving} disabled={fillSaving || revalidationSaving || (selectedRows.length ? !canApproveSelection : !approvableIds.length)} onClick={validateSelected}>Validar leads</Button> : null}
      </div>
      {selectedLeads.length && !canApproveSelection && !canRevalidateSelection ? (
        <div className="lead-bulk-actions"><span>{selectedLeads.length} selecionado(s)</span><small>Nenhuma acao disponivel para a selecao atual.</small></div>
      ) : null}
      {error ? <div className="table-message">{error}</div> : null}
      {!error && loading ? <div className="table-message">Carregando leads...</div> : null}
      {!error && !loading && tableRows.length ? (
        <DataTable
          selectable
          selectedRows={selectedRows}
          onSelectedRowsChange={setSelectedRows}
          columns={columns}
          rows={tableRows}
          actions={channel === 'Instagram' ? ['view', 'invalidate', 'archive'] : ['view', 'approve', 'archive']}
          getRowActions={(row) => {
            const lead = findLead(row);
            if (!lead) return [];
            const permissions = permissionsFor('pre-send', lead.status);
            if (channel === 'Instagram') {
              return [
                'view',
                ...(permissions.canInvalidate() ? ['invalidate' as TableAction] : []),
                ...(permissions.canArchive() ? ['archive' as TableAction] : []),
              ];
            }
            return [
              'view',
              ...(permissions.canApprove() ? ['approve' as TableAction] : []),
              ...(canMarkAlreadySent(lead) ? ['sent' as TableAction] : []),
              ...(permissions.canArchive() ? ['archive' as TableAction] : []),
            ];
          }}
          onAction={handleAction}
        />
      ) : null}
      <div className="validation-list__footer">
        <small>{loading ? 'Carregando...' : `Mostrando ${pageRows.length} de ${leads.length} lead(s)`}</small>
        <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
      </div>

      <Drawer
        open={Boolean(editingLead && leadForm)}
        title={drawerMode === 'edit' ? 'Editar lead' : 'Detalhes do lead'}
        description={channel === 'Instagram' ? 'Ao salvar um Instagram válido, o sistema tenta inserir o lead automaticamente na fila conforme a capacidade.' : 'Edição local do pré-envio.'}
        onClose={() => {
          setEditingLead(null);
          setLeadForm(null);
          setDrawerMode('view');
        }}
        footer={
          drawerMode === 'edit' ? (
            <>
              <Button variant="secondary" onClick={() => editingLead ? openLeadDrawer(editingLead, 'view') : null}>Cancelar</Button>
              <Button iconLeft={Save} loading={saving} onClick={saveLead}>Salvar</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { setEditingLead(null); setLeadForm(null); setDrawerMode('view'); }}>Fechar</Button>
              {editingLead && permissionsFor('pre-send', editingLead.status).canEdit() ? (
                <Button onClick={() => openLeadDrawer(editingLead, 'edit')}>Editar</Button>
              ) : null}
            </>
          )
        }
      >
        {leadForm ? (
          <div className={`drawer-form ${drawerMode === 'view' ? 'drawer-form--readonly' : ''}`}>
            <Field label="Empresa" value={leadForm.company} readOnly={drawerMode === 'view'} onChange={(value) => setLeadForm((current) => current ? { ...current, company: value } : current)} />
            <Field label="Ramo" value={leadForm.branch} readOnly={drawerMode === 'view'} onChange={(value) => setLeadForm((current) => current ? { ...current, branch: value } : current)} />
            {drawerMode === 'view' ? <Field label="Destino" value={leadForm.destination} readOnly /> : <SelectField options={['WhatsApp', 'Com site', 'Agregadores', 'Instagram']} value={leadForm.destination} onChange={(value) => setLeadForm((current) => current ? { ...current, destination: value } : current)} />}
            <Field label="Status" value={editingLead ? statusLabel(editingLead.status) : ''} readOnly />
            <Field label="WhatsApp" value={leadForm.phone} readOnly={drawerMode === 'view'} onChange={(value) => setLeadForm((current) => current ? { ...current, phone: value } : current)} />
            <Field label="Instagram" value={leadForm.instagram} readOnly={drawerMode === 'view'} onChange={(value) => setLeadForm((current) => current ? { ...current, instagram: value } : current)} />
            {channel === 'Instagram' && editingLead?.queueWaitReason ? <Field label="Pendência operacional" value={editingLead.queueWaitReason} readOnly /> : null}
            <Field label="Site" value={leadForm.site} readOnly={drawerMode === 'view'} onChange={(value) => setLeadForm((current) => current ? { ...current, site: value } : current)} />
            <label className="drawer-field-group">
              <span>Enviar Instagram?</span>
              {drawerMode === 'view' || (editingLead && !permissionsFor('pre-send', editingLead.status).canInstagramOverride()) ? (
                <Field value={leadForm.send_instagram} readOnly />
              ) : (
                <SelectField options={['Não', 'Sim']} value={leadForm.send_instagram} onChange={(value) => setLeadForm((current) => current ? { ...current, send_instagram: value as PreSendForm['send_instagram'] } : current)} />
              )}
            </label>
            <Field label="Motivo do override Instagram" value={leadForm.instagram_override_reason} readOnly={drawerMode === 'view'} onChange={(value) => setLeadForm((current) => current ? { ...current, instagram_override_reason: value } : current)} />
            <Field label="Cidade" value={leadForm.city} readOnly={drawerMode === 'view'} onChange={(value) => setLeadForm((current) => current ? { ...current, city: value } : current)} />
            <Field label="Estado" value={leadForm.state} readOnly={drawerMode === 'view'} onChange={(value) => setLeadForm((current) => current ? { ...current, state: value } : current)} />
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Arquivar lead?"
        description="O lead sera removido do pre-envio local."
        confirmLabel="Arquivar"
        danger
        onConfirm={confirmArchive}
        onClose={() => setArchiveTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(sentTarget)}
        title="Marcar como ja enviado?"
        description="O lead sera enviado para a Base Permanente, registrado em sent_contacts e removido do fluxo ativo."
        confirmLabel="Marcar como enviado"
        onConfirm={confirmMarkAlreadySent}
        onClose={() => {
          setSentTarget(null);
          setSentReason(defaultManualSentReason);
        }}
      >
        <Field label="Motivo" value={sentReason} onChange={setSentReason} />
      </ConfirmDialog>
    </div>
  );
}

export function PreSendPage() {
  const [activeDayKey, setActiveDayKey] = useState('');
  const [whatsappScope, setWhatsAppScope] = useState<{ profile: string; queueFilter: PreSendQueueFilter }>({ profile: '', queueFilter: 'Geral' });
  const [instagramScope, setInstagramScope] = useState<{ profile: string; queueFilter: PreSendQueueFilter }>({ profile: '', queueFilter: 'Geral' });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const { dayCards, summary, loading, error, defaultDayId, refresh, moveDayToQueue, moveApprovedImportsToQueue, returnDayToImport, validateLead, validateLeads, revalidateApprovedLeads, invalidateLead, archiveLead, markAlreadySent, updateLead } = usePreSend();
  const [daySummary, setDaySummary] = useState<PreSendSummary>(summary);

  useEffect(() => {
    const defaultKey = daySelectionKey(defaultDayId);
    if (defaultKey && (!activeDayKey || !dayCards.some((day) => daySelectionKey(day.id) === activeDayKey))) {
      setActiveDayKey(defaultKey);
    }
  }, [activeDayKey, dayCards, defaultDayId]);

  const dayIdForChannel = (channel: PreSendChannel) => {
    return dayCards.find((day) => day.channel === channel && daySelectionKey(day.id) === activeDayKey)?.id ??
      dayCards.find((day) => day.channel === channel)?.id ??
      defaultDayId;
  };

  useEffect(() => {
    let active = true;

    if (!dayCards.length) {
      setDaySummary(summary);
      return () => {
        active = false;
      };
    }

    async function loadDaySummary() {
      const nextSummary = await preSendService.summary({
        whatsappDayId: dayIdForChannel('WhatsApp'),
        instagramDayId: dayIdForChannel('Instagram'),
      });
      if (active) setDaySummary(nextSummary);
    }

    void loadDaySummary();

    return () => {
      active = false;
    };
  }, [activeDayKey, dayCards, defaultDayId, summary, summaryRefreshToken]);

  const refreshAll = () => {
    refresh();
    setSummaryRefreshToken((current) => current + 1);
  };

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  };

  const sendPreparedToQueues = async () => {
    try {
      await moveDayToQueue({
        whatsappDayId: dayIdForChannel('WhatsApp'),
        instagramDayId: dayIdForChannel('Instagram'),
        whatsappProfile: whatsappScope.profile,
        instagramProfile: instagramScope.profile,
        queueFilter: whatsappScope.queueFilter,
      });
      refreshAll();
      pushToast({ title: 'Leads enviados para as filas', description: 'Filas montadas conforme dia, chip e perfil selecionados.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Nao foi possivel enviar para as filas', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const returnSelectedDayToImport = async () => {
    try {
      await returnDayToImport({
        whatsappDayId: dayIdForChannel('WhatsApp'),
        instagramDayId: dayIdForChannel('Instagram'),
      });
      refreshAll();
      pushToast({ title: 'Leads retornaram ao Inicio', description: 'Leads do dia selecionado voltaram ao Inicio como aprovados.', tone: 'info' });
    } catch (err) {
      pushToast({ title: 'Nao foi possivel retornar leads', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  return (
    <div className="pre-send-page">
      <PageHeader
        title="Pré-Envio"
        action={
          <div className="pre-send-header-actions">
            <Button variant="secondary" iconLeft={RotateCcw} onClick={returnSelectedDayToImport}>Retornar leads para inicio</Button>
            <Button iconLeft={Send} onClick={sendPreparedToQueues}>Enviar leads para as filas</Button>
          </div>
        }
      />
      {error ? <div className="table-message">{error}</div> : null}
      {!error && loading ? <div className="table-message">Carregando semana de pre-envio...</div> : null}
      <DayLimitGrid dayCards={dayCards} activeDayKey={activeDayKey || daySelectionKey(defaultDayId)} onDayChange={(dayId) => setActiveDayKey(daySelectionKey(dayId))} />
      <section className="metric-grid metric-grid--2 pre-send-summary">
        <MetricCard icon={PhoneCall} value={String(daySummary.whatsapp)} label={`Numeros validados${daySummary.dateLabel ? ` - ${daySummary.dateLabel}` : ''}`} tone="success" />
        <MetricCard icon={Instagram} value={String(daySummary.instagram)} label={`Retornos Instagram${daySummary.dateLabel ? ` - ${daySummary.dateLabel}` : ''}`} />
      </section>
      <div className="pre-send-action">
        <Button iconLeft={RefreshCcw} onClick={() => { refreshAll(); pushToast({ title: 'Pré-envio atualizado', description: 'Dados locais recarregados.', tone: 'info' }); }}>Atualizar pré-envio</Button>
      </div>
      <section className="queue-grid">
        <Panel className="queue-card-shell">
          <ValidationQueue
            title="WhatsApp"
            channel="WhatsApp"
            activeDayId={dayIdForChannel('WhatsApp')}
            onToast={pushToast}
            onRefreshSummary={refreshAll}
            moveApprovedImportsToQueue={moveApprovedImportsToQueue}
            validateLead={validateLead}
            validateLeads={validateLeads}
            revalidateApprovedLeads={revalidateApprovedLeads}
            invalidateLead={invalidateLead}
            archiveLead={archiveLead}
            markAlreadySent={markAlreadySent}
            updateLead={updateLead}
            onScopeChange={setWhatsAppScope}
          />
        </Panel>
        <Panel className="queue-card-shell">
          <ValidationQueue
            title="Instagram"
            channel="Instagram"
            activeDayId={dayIdForChannel('Instagram')}
            onToast={pushToast}
            onRefreshSummary={refreshAll}
            moveApprovedImportsToQueue={moveApprovedImportsToQueue}
            validateLead={validateLead}
            validateLeads={validateLeads}
            revalidateApprovedLeads={revalidateApprovedLeads}
            invalidateLead={invalidateLead}
            archiveLead={archiveLead}
            markAlreadySent={markAlreadySent}
            updateLead={updateLead}
            onScopeChange={setInstagramScope}
          />
        </Panel>
      </section>
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
