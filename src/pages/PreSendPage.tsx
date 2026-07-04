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
import type { PreSendChannel, PreSendDayCard, PreSendLead, PreSendQueueFilter } from '../services/pre-send/types';
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
  moveToQueue,
  moveApprovedImportsToQueue,
  validateLead,
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
  moveToQueue: (ids: string[], options?: { whatsappProfile?: string; instagramProfile?: string }) => Promise<number>;
  moveApprovedImportsToQueue: (input: { channel: PreSendChannel; dayId: string; profile?: string; queueFilter?: PreSendQueueFilter }) => Promise<number>;
  validateLead: (id: string) => Promise<void>;
  archiveLead: (id: string) => Promise<void>;
  markAlreadySent: (ids: string[], reason?: string) => Promise<number>;
  updateLead: (id: string, input: Partial<PreSendLead>) => Promise<void>;
  onScopeChange?: (scope: { profile: string; queueFilter: PreSendQueueFilter }) => void;
}) {
  const [activeProfile, setActiveProfile] = useState('');
  const [queueFilter, setQueueFilter] = useState<PreSendQueueFilter>('Geral');
  const [page, setPage] = useState(1);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editingLead, setEditingLead] = useState<PreSendLead | null>(null);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [leadForm, setLeadForm] = useState<PreSendForm | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PreSendLead | null>(null);
  const [sentTarget, setSentTarget] = useState<PreSendLead | null>(null);
  const [sentReason, setSentReason] = useState(defaultManualSentReason);

  const { profiles, leads, loading, error } = usePreSendQueue(channel, activeDayId, activeProfile, queueFilter, refreshToken);

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
  const queueableIds = useMemo(() => leads.filter((lead) => permissionsFor('pre-send', lead.status).canQueue()).map((lead) => lead.id), [leads]);
  const approvableIds = useMemo(() => pageRows.filter((lead) => permissionsFor('pre-send', lead.status).canApprove()).map((lead) => lead.id), [pageRows]);
  const canQueueSelection = selectedLeads.length > 0 && selectedLeads.every((lead) => permissionsFor('pre-send', lead.status).canQueue());
  const canApproveSelection = selectedLeads.length > 0 && selectedLeads.every((lead) => permissionsFor('pre-send', lead.status).canApprove());
  const selectedQueueableIds = canQueueSelection ? selectedIds : [];
  const selectedApprovableIds = canApproveSelection ? selectedIds : [];
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

      await updateLead(editingLead.id, {
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
      onToast({ title: 'Lead atualizado', description: 'Pré-envio atualizado localmente.', tone: 'success' });
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
    if (selectedRows.length && !canQueueSelection) {
      onToast({ title: 'Selecao incompativel', description: 'Preencher fila exige que todos os selecionados estejam aprovados.', tone: 'warning' });
      return;
    }
    const ids = selectedQueueableIds.length ? selectedQueueableIds : queueableIds;
    setSaving(true);
    try {
      const moved = ids.length
        ? await moveToQueue(ids, channel === 'WhatsApp' ? { whatsappProfile: activeProfile } : { instagramProfile: activeProfile })
        : await moveApprovedImportsToQueue({ channel, dayId: activeDayId, profile: activeProfile || profiles[0] || '', queueFilter });
      setSelectedRows([]);
      refreshQueue();
      onToast({ title: 'Fila preenchida', description: `${moved} lead(s) movido(s) para fila local.`, tone: 'success' });
    } catch (err) {
      onToast({ title: 'Erro ao preencher fila', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const validateSelected = async () => {
    if (selectedRows.length && !canApproveSelection) {
      onToast({ title: 'Selecao incompativel', description: 'Validar exige que todos os selecionados possam ser aprovados.', tone: 'warning' });
      return;
    }
    const ids = selectedApprovableIds.length ? selectedApprovableIds : approvableIds;
    if (!ids.length) {
      onToast({ title: 'Nada para validar', description: 'Selecione leads ou filtre itens inválidos.', tone: 'warning' });
      return;
    }

    setSaving(true);
    try {
      await Promise.all(ids.map((id) => validateLead(id)));
      setSelectedRows([]);
      refreshQueue();
      onToast({ title: 'Leads validados', description: `${ids.length} lead(s) atualizado(s) localmente.`, tone: 'success' });
    } catch (err) {
      onToast({ title: 'Erro ao validar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
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
        <Button variant="secondary" iconLeft={TableProperties} size="sm" loading={saving} disabled={selectedRows.length ? !canQueueSelection : !hasOperationalProfile} onClick={fillQueue}>Preencher fila</Button>
        {channel === 'WhatsApp' ? <Button size="sm" loading={saving} disabled={selectedRows.length ? !canApproveSelection : !approvableIds.length} onClick={validateSelected}>Validar leads</Button> : null}
      </div>
      {selectedLeads.length && !canQueueSelection && !canApproveSelection ? (
        <div className="lead-bulk-actions"><span>{selectedLeads.length} selecionado(s)</span><small>Nenhuma acao disponivel para a selecao atual.</small></div>
      ) : null}
      {error ? <div className="table-message">{error}</div> : null}
      {!error && loading ? <div className="table-message">Carregando leads...</div> : null}
      {!error && !loading && !tableRows.length ? <div className="table-message">Nenhum lead disponivel para pre-envio.</div> : null}
      {!error && !loading && tableRows.length ? (
        <DataTable
          selectable
          selectedRows={selectedRows}
          onSelectedRowsChange={setSelectedRows}
          columns={columns}
          rows={tableRows}
          actions={['view', 'approve', 'archive']}
          getRowActions={(row) => {
            const lead = findLead(row);
            if (!lead) return [];
            const permissions = permissionsFor('pre-send', lead.status);
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
        description="Edição local do pré-envio."
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
  const { dayCards, summary, loading, error, defaultDayId, refresh, moveToQueue, moveDayToQueue, moveInstagramDayToQueue, moveApprovedImportsToQueue, returnDayToImport, validateLead, archiveLead, markAlreadySent, updateLead } = usePreSend();

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
      pushToast({ title: 'Leads enviados para as filas', description: 'Filas montadas conforme dia, chip e perfil selecionados.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Nao foi possivel enviar para as filas', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const sendInstagramReturnsToQueue = async () => {
    try {
      await moveInstagramDayToQueue({
        instagramDayId: dayIdForChannel('Instagram'),
        instagramProfile: instagramScope.profile,
      });
      pushToast({ title: 'Instagram destinado para fila', description: 'Retornos Instagram aprovados foram enviados para a fila do dia selecionado.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Nao foi possivel destinar Instagram', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const returnSelectedDayToImport = async () => {
    try {
      await returnDayToImport({
        whatsappDayId: dayIdForChannel('WhatsApp'),
        instagramDayId: dayIdForChannel('Instagram'),
      });
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
            <Button variant="secondary" iconLeft={Instagram} onClick={sendInstagramReturnsToQueue}>Destinar leads para Instagram</Button>
            <Button iconLeft={Send} onClick={sendPreparedToQueues}>Enviar leads para as filas</Button>
          </div>
        }
      />
      {error ? <div className="table-message">{error}</div> : null}
      {!error && loading ? <div className="table-message">Carregando semana de pre-envio...</div> : null}
      <DayLimitGrid dayCards={dayCards} activeDayKey={activeDayKey || daySelectionKey(defaultDayId)} onDayChange={(dayId) => setActiveDayKey(daySelectionKey(dayId))} />
      <section className="metric-grid metric-grid--2 pre-send-summary">
        <MetricCard icon={PhoneCall} value={String(summary.whatsapp)} label="Numeros validados" tone="success" />
        <MetricCard icon={Instagram} value={String(summary.instagram)} label="Retornos Instagram" />
      </section>
      <div className="pre-send-action">
        <Button iconLeft={RefreshCcw} onClick={() => { refresh(); pushToast({ title: 'Pré-envio atualizado', description: 'Dados locais recarregados.', tone: 'info' }); }}>Atualizar pré-envio</Button>
      </div>
      <section className="queue-grid">
        <Panel className="queue-card-shell">
          <ValidationQueue
            title="WhatsApp"
            channel="WhatsApp"
            activeDayId={dayIdForChannel('WhatsApp')}
            onToast={pushToast}
            onRefreshSummary={refresh}
            moveToQueue={moveToQueue}
            moveApprovedImportsToQueue={moveApprovedImportsToQueue}
            validateLead={validateLead}
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
            onRefreshSummary={refresh}
            moveToQueue={moveToQueue}
            moveApprovedImportsToQueue={moveApprovedImportsToQueue}
            validateLead={validateLead}
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
