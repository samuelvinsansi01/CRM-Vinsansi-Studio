import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Archive, Instagram, MessageCircle, RotateCcw, Save, Send, Trash2, Users, X } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  FiltersBar,
  MetricCard,
  RowsPerPageControl,
  SearchInput,
  SelectField,
  TableCard,
  Tag,
  ToastViewport,
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { DestinationBadge } from '../components/DestinationBadge';
import { useBaseRecords } from '../hooks/useBaseRecords';
import { permissionsFor } from '../services/permissions';
import { baseStatusLabel } from '../services/base/status.mapper';
import type { BaseFilters, BaseLead, BaseLeadDestination, BaseLeadOrigin, BaseLeadStatus, UpdateBaseLeadInput } from '../services/base/types';
import { isStatusGroup, statusLabel, statusTone } from '../services/status/status.mapper';

type BaseLeadDraft = Pick<
  BaseLead,
  | 'company'
  | 'branch'
  | 'state'
  | 'city'
  | 'phone'
  | 'site'
  | 'instagram'
  | 'mapsUrl'
  | 'origin'
  | 'destination'
  | 'original_destination'
  | 'destination_override'
  | 'send_instagram'
  | 'instagram_override_reason'
  | 'override_by'
  | 'override_at'
  | 'status'
  | 'template'
  | 'chipOrProfile'
  | 'notes'
>;

type BaseTableRow = Record<string, ReactNode> & {
  id: string;
  statusValue: BaseLeadStatus;
};

const PAGE_SIZE = 20;

const statusOptions = [
  { value: 'sent', label: baseStatusLabel.sent },
  { value: 'archived', label: baseStatusLabel.archived },
  { value: 'invalid', label: baseStatusLabel.invalid },
  { value: 'error', label: baseStatusLabel.error },
];

const originOptions = ['WhatsApp', 'Instagram'];
const destinationOptions = ['WhatsApp', 'Instagram', 'Com site', 'Agregador'];
const dateOptions = [
  { value: 'Todos', label: 'Data' },
  { value: 'Hoje', label: 'Hoje' },
  { value: '7d', label: 'Ultimos 7 dias' },
  { value: '30d', label: 'Ultimos 30 dias' },
];

function yesNo(value?: string | null) {
  return value && value.trim() ? 'Sim' : 'Nao';
}

function silentLink(label: string, href?: string) {
  if (!href) return label;
  return <a className="silent-link" href={href} target="_blank" rel="noreferrer" title={href}>{label}</a>;
}

function ensureUrl(value?: string | null) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function mapsHref(lead: BaseLead) {
  if (lead.mapsUrl?.trim()) return ensureUrl(lead.mapsUrl);
  const query = [lead.company, lead.city, lead.state].filter(Boolean).join(' ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function instagramHref(lead: BaseLead) {
  const instagram = lead.instagram ?? '';
  if (!instagram.trim()) return '';
  if (/^https?:\/\//i.test(instagram)) return instagram;
  return `https://instagram.com/${instagram.replace(/^@/, '')}`;
}

function matchesDateFilter(sentAt: string, filter: string) {
  if (filter === 'Todos') return true;

  const sentDate = new Date(sentAt);
  if (Number.isNaN(sentDate.getTime())) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (filter === 'Hoje') return sentDate >= startOfToday;

  const days = filter === '7d' ? 7 : 30;
  const threshold = new Date(startOfToday);
  threshold.setDate(threshold.getDate() - days + 1);
  return sentDate >= threshold;
}

const columns: TableColumn<BaseTableRow>[] = [
  { key: 'company', label: 'Nome da empresa', width: '18%' },
  { key: 'branch', label: 'Ramo', width: '12%' },
  { key: 'state', label: 'Estado', width: '9%' },
  { key: 'city', label: 'Cidade', width: '10%' },
  { key: 'phone', label: 'Telefone', width: '8%' },
  { key: 'instagram', label: 'Instagram', width: '8%' },
  { key: 'site', label: 'Site', width: '8%' },
  { key: 'destination', label: 'Destino', width: '9%' },
  {
    key: 'status',
    label: 'Situacao',
    width: '10%',
    render: (row) => {
      return <Tag tone={statusTone(row.statusValue)}>{statusLabel(row.statusValue)}</Tag>;
    },
  },
];

const tableActions: TableAction[] = ['view', 'archive', 'restore', 'delete'];
type ConfirmAction = 'archive' | 'restore' | 'delete';

export function BasePage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Omit<BaseFilters, 'search'>>({});
  const [dateFilter, setDateFilter] = useState('Todos');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit' | null>(null);
  const [activeLead, setActiveLead] = useState<BaseLead | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ lead: BaseLead; action: ConfirmAction } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [saving, setSaving] = useState(false);

  const effectiveFilters = useMemo<BaseFilters>(() => ({ ...filters, search }), [filters, search]);
  const { records, summary, options, loading, error, updateLead, archiveLead, archiveMany, restoreLead, restoreMany, removeLead, removeMany } = useBaseRecords(effectiveFilters);

  const visibleRecords = useMemo(() => records.filter((lead) => matchesDateFilter(lead.sentAt, dateFilter)), [dateFilter, records]);
  const totalPages = Math.max(1, Math.ceil(visibleRecords.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pagedRecords = visibleRecords.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const rows = useMemo<BaseTableRow[]>(
    () => pagedRecords.map((lead) => ({
      id: lead.id,
      company: silentLink(lead.company, mapsHref(lead)),
      branch: lead.branch,
      state: lead.state,
      city: lead.city,
      phone: yesNo(lead.phone),
      instagram: silentLink(yesNo(lead.instagram), instagramHref(lead)),
      site: silentLink(yesNo(lead.site), ensureUrl(lead.site)),
      destination: <DestinationBadge value={lead.destination} />,
      status: lead.status,
      statusValue: lead.status,
    })),
    [pagedRecords],
  );

  const selectedCount = selectedRows.length;
  const selectedLeads = selectedRows.map((rowIndex) => pagedRecords[rowIndex]).filter((lead): lead is BaseLead => Boolean(lead));
  const selectedIds = selectedLeads.map((lead) => lead.id);
  const canBulkArchive = selectedLeads.length > 0 && selectedLeads.every((lead) => permissionsFor('base', lead.status).canArchive());
  const canBulkRestore = selectedLeads.length > 0 && selectedLeads.every((lead) => isStatusGroup(lead.status, 'archived'));
  const canBulkRemove = selectedLeads.length > 0 && selectedLeads.every((lead) => isStatusGroup(lead.status, 'archived'));
  const hasBulkAction = canBulkArchive || canBulkRestore || canBulkRemove;

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [{ id, ...toast }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3400);
  };

  const updateFilter = (key: keyof Omit<BaseFilters, 'search'>, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setSelectedRows([]);
  };

  const openLead = (lead: BaseLead, mode: 'view' | 'edit') => {
    setActiveLead(lead);
    setDrawerMode(mode);
  };

  const handleAction = (action: TableAction, row: BaseTableRow) => {
    const lead = records.find((item) => item.id === row.id);
    if (!lead) return;

    if (action === 'view') {
      openLead(lead, 'view');
      return;
    }

    if (action === 'edit') {
      openLead(lead, 'edit');
      return;
    }

    if (action === 'archive') {
      if (!permissionsFor('base', lead.status).canArchive()) {
        pushToast({ title: 'Acao bloqueada', description: 'Este registro nao pode ser arquivado neste estado.', tone: 'warning' });
        return;
      }
      setConfirmAction({ lead, action: 'archive' });
      return;
    }

    if (action === 'restore') {
      if (!isStatusGroup(lead.status, 'archived')) {
        pushToast({ title: 'Acao bloqueada', description: 'Somente registros arquivados podem ser restaurados.', tone: 'warning' });
        return;
      }
      setConfirmAction({ lead, action: 'restore' });
      return;
    }

    if (action === 'delete') {
      if (!isStatusGroup(lead.status, 'archived')) {
        pushToast({ title: 'Acao bloqueada', description: 'Exclusao definitiva exige registro arquivado.', tone: 'warning' });
        return;
      }
      setConfirmAction({ lead, action: 'delete' });
    }
  };

  const handleSaveLead = async (input: UpdateBaseLeadInput) => {
    if (!activeLead) return;
    setSaving(true);
    await updateLead(activeLead.id, input);
    setSaving(false);
    setDrawerMode(null);
    setActiveLead(null);
    pushToast({ title: 'Lead atualizado', description: 'Alterações salvas localmente na Base Permanente.', tone: 'success' });
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { lead, action } = confirmAction;
    if (action === 'archive') await archiveLead(lead);
    if (action === 'restore') await restoreLead(lead);
    if (action === 'delete') await removeLead(lead);
    setConfirmAction(null);
    setSelectedRows([]);
    const messages: Record<ConfirmAction, Omit<ToastItem, 'id'>> = {
      archive: { title: 'Lead arquivado', description: `${lead.company} foi arquivado.`, tone: 'warning' },
      restore: { title: 'Lead restaurado', description: `${lead.company} voltou para a Base Permanente.`, tone: 'success' },
      delete: { title: 'Lead excluido', description: `${lead.company} saiu da listagem operacional.`, tone: 'danger' },
    };
    pushToast(messages[action]);
  };

  const handleBulkArchive = async () => {
    try {
      await archiveMany(selectedIds);
      setSelectedRows([]);
      pushToast({ title: 'Leads arquivados', description: `${selectedIds.length} lead(s) arquivado(s).`, tone: 'warning' });
    } catch (err) {
      pushToast({ title: 'Acao em massa bloqueada', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleBulkRestore = async () => {
    try {
      await restoreMany(selectedIds);
      setSelectedRows([]);
      pushToast({ title: 'Leads restaurados', description: `${selectedIds.length} lead(s) restaurado(s).`, tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Acao em massa bloqueada', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleBulkRemove = async () => {
    try {
      await removeMany(selectedIds);
      setSelectedRows([]);
      pushToast({ title: 'Leads excluidos', description: `${selectedIds.length} lead(s) removido(s) da listagem operacional.`, tone: 'danger' });
    } catch (err) {
      pushToast({ title: 'Acao em massa bloqueada', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const confirmCopy: Record<ConfirmAction, { title: string; description: string; confirmLabel: string; danger: boolean }> = {
    archive: {
      title: 'Arquivar lead?',
      description: 'Essa acao muda o status do lead para arquivado.',
      confirmLabel: 'Arquivar',
      danger: true,
    },
    restore: {
      title: 'Restaurar lead?',
      description: 'Essa acao devolve o lead arquivado para a Base Permanente.',
      confirmLabel: 'Restaurar',
      danger: false,
    },
    delete: {
      title: 'Excluir lead definitivamente?',
      description: 'Essa acao remove o lead arquivado das listagens operacionais via soft delete.',
      confirmLabel: 'Excluir',
      danger: true,
    },
  };
  const activeConfirm = confirmAction ? confirmCopy[confirmAction.action] : null;

  return (
    <div className="dashboard-table-page lead-list-page lead-list-page--base">
      <PageHeader title="Base Permanente" />

      <section className="metric-grid metric-grid--6">
        <MetricCard icon={Users} value={String(summary.total)} label="Total" />
        <MetricCard icon={Send} value={String(summary.sent)} label="Total enviados" tone="success" />
        <MetricCard icon={MessageCircle} value={String(summary.sentWhatsApp)} label="Enviados WhatsApp" tone="success" />
        <MetricCard icon={Instagram} value={String(summary.sentInstagram)} label="Enviados Instagram" tone="primary" />
        <MetricCard icon={X} value={String(summary.invalid)} label="Inválidos" tone="danger" />
        <MetricCard icon={Archive} value={String(summary.archived)} label="Arquivados" tone="warning" />
      </section>

      <FiltersBar>
        <SelectField value={dateFilter} options={dateOptions} placeholder="Data" onChange={(value) => { setDateFilter(value); setPage(1); setSelectedRows([]); }} />
        <SelectField value={filters.origin ?? 'Todos'} options={options.origins} placeholder="Origem disparo" onChange={(value) => updateFilter('origin', value)} />
        <SelectField value={filters.branch ?? 'Todos'} options={options.branches} placeholder="Ramo" onChange={(value) => updateFilter('branch', value)} />
        <SelectField value={filters.state ?? 'Todos'} options={options.states} placeholder="Estado" onChange={(value) => updateFilter('state', value)} />
        <SelectField value={filters.destination ?? 'Todos'} options={options.destinations} placeholder="Destino" onChange={(value) => updateFilter('destination', value)} />
        <SelectField
          value={filters.status ?? 'Todos'}
          options={[{ value: 'Todos', label: 'Todos' }, ...statusOptions]}
          placeholder="Status"
          onChange={(value) => updateFilter('status', value)}
        />
        <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); setSelectedRows([]); }} placeholder="Buscar" />
      </FiltersBar>

      <TableCard
        title="Listagem de leads"
        footerText={loading ? 'Carregando registros...' : `${visibleRecords.length} registro(s) encontrado(s). ${selectedCount} selecionado(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); setSelectedRows([]); }} />}
        page={currentPage}
        totalPages={totalPages}
        onPageChange={(nextPage) => { setPage(nextPage); setSelectedRows([]); }}
      >
        {selectedLeads.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedLeads.length} selecionado(s)</span>
            {canBulkArchive ? <Button size="sm" variant="danger" iconLeft={Archive} onClick={handleBulkArchive}>Arquivar</Button> : null}
            {canBulkRestore ? <Button size="sm" variant="secondary" iconLeft={RotateCcw} onClick={handleBulkRestore}>Restaurar</Button> : null}
            {canBulkRemove ? <Button size="sm" variant="danger" iconLeft={Trash2} onClick={handleBulkRemove}>Excluir</Button> : null}
            {!hasBulkAction ? <small>Nenhuma acao disponivel para a selecao atual.</small> : null}
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando registros...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead encontrado na Base Permanente.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable
            columns={columns}
            rows={rows}
            actions={tableActions}
            getRowActions={(row) => {
              const lead = records.find((item) => item.id === row.id);
              if (!lead) return [];
              return [
                'view' as TableAction,
                ...(isStatusGroup(lead.status, 'archived')
                  ? ['restore' as TableAction, 'delete' as TableAction]
                  : permissionsFor('base', lead.status).canArchive()
                    ? ['archive' as TableAction]
                    : []),
              ];
            }}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <BaseLeadDrawer
        mode={drawerMode}
        lead={activeLead}
        saving={saving}
        onModeChange={setDrawerMode}
        onClose={() => { setDrawerMode(null); setActiveLead(null); }}
        onSave={handleSaveLead}
      />

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={activeConfirm?.title ?? ''}
        description={activeConfirm?.description ?? ''}
        confirmLabel={activeConfirm?.confirmLabel ?? 'Confirmar'}
        danger={activeConfirm?.danger}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      >
        {confirmAction ? <strong>{confirmAction.lead.company}</strong> : null}
      </ConfirmDialog>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function BaseLeadDrawer({
  mode,
  lead,
  saving,
  onModeChange,
  onClose,
  onSave,
}: {
  mode: 'view' | 'edit' | null;
  lead: BaseLead | null;
  saving: boolean;
  onModeChange: (mode: 'view' | 'edit' | null) => void;
  onClose: () => void;
  onSave: (input: UpdateBaseLeadInput) => void;
}) {
  const [draft, setDraft] = useState<BaseLeadDraft | null>(null);

  useEffect(() => {
    if (!lead) {
      setDraft(null);
      return;
    }

    setDraft({
      company: lead.company,
      branch: lead.branch,
      state: lead.state,
      city: lead.city,
      phone: lead.phone,
      site: lead.site,
      instagram: lead.instagram ?? '',
      mapsUrl: lead.mapsUrl ?? '',
      origin: lead.origin,
      destination: lead.destination,
      original_destination: lead.original_destination ?? lead.destination,
      destination_override: lead.destination_override ?? '',
      send_instagram: lead.send_instagram ?? false,
      instagram_override_reason: lead.instagram_override_reason ?? '',
      override_by: lead.override_by ?? '',
      override_at: lead.override_at ?? '',
      status: lead.status,
      template: lead.template,
      chipOrProfile: lead.chipOrProfile,
      notes: lead.notes ?? '',
    });
  }, [lead]);

  if (!lead || !draft || !mode) return null;

  const readOnly = mode === 'view';
  const updateDraft = <K extends keyof BaseLeadDraft>(key: K, value: BaseLeadDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <Drawer
      open={Boolean(lead)}
      title={mode === 'view' ? 'Detalhes do lead' : 'Editar lead permanente'}
      description={`${lead.company} - ${statusLabel(lead.status)}`}
      onClose={onClose}
      footer={
        mode === 'edit' ? (
          <>
            <Button variant="secondary" onClick={() => onModeChange('view')}>Cancelar</Button>
            <Button iconLeft={Save} loading={saving} onClick={() => onSave(draft)}>Salvar alterações</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            {permissionsFor('base', lead.status).canEdit() ? (
              <Button onClick={() => onModeChange('edit')}>Editar</Button>
            ) : null}
          </>
        )
      }
    >
      <div className="drawer-form">
        <Field label="Empresa" value={draft.company} readOnly={readOnly} onChange={(value) => updateDraft('company', value)} />
        <Field label="Ramo" value={draft.branch} readOnly={readOnly} onChange={(value) => updateDraft('branch', value)} />
        <div className="drawer-grid drawer-grid--2">
          <Field label="Estado" value={draft.state} readOnly={readOnly} onChange={(value) => updateDraft('state', value)} />
          <Field label="Cidade" value={draft.city} readOnly={readOnly} onChange={(value) => updateDraft('city', value)} />
        </div>
        <Field label="Telefone" value={draft.phone} readOnly={readOnly} onChange={(value) => updateDraft('phone', value)} />
        <Field label="Site" value={draft.site} readOnly={readOnly} onChange={(value) => updateDraft('site', value)} />
        <Field label="Instagram" value={draft.instagram ?? ''} readOnly={readOnly} onChange={(value) => updateDraft('instagram', value)} />
        <Field label="Maps URL / Place ID" value={draft.mapsUrl ?? ''} readOnly={readOnly} onChange={(value) => updateDraft('mapsUrl', value)} />
        {readOnly ? (
          <div className="drawer-grid drawer-grid--2">
            <Field label="Origem" value={draft.origin} readOnly />
            <Field label="Destino" value={draft.destination} readOnly />
            <Field label="Destino original" value={draft.original_destination ?? ''} readOnly />
            <Field label="Override aplicado" value={draft.send_instagram ? 'Instagram' : draft.destination_override ?? ''} readOnly />
          </div>
        ) : (
          <div className="drawer-grid drawer-grid--2">
            <label className="field">
              <span className="field__label">Origem</span>
              <SelectField value={draft.origin} options={originOptions} onChange={(value) => updateDraft('origin', value as BaseLeadOrigin)} />
            </label>
            <label className="field">
              <span className="field__label">Destino</span>
              <SelectField value={draft.destination} options={destinationOptions} onChange={(value) => updateDraft('destination', value as BaseLeadDestination)} />
            </label>
          </div>
        )}
        {readOnly ? (
          <Field label="Status" value={statusLabel(draft.status)} readOnly />
        ) : (
          <Field label="Status" value={statusLabel(draft.status)} readOnly />
        )}
        <Field label="Template utilizado" value={draft.template} readOnly={readOnly} onChange={(value) => updateDraft('template', value)} />
        <Field label="Chip / Perfil" value={draft.chipOrProfile} readOnly={readOnly} onChange={(value) => updateDraft('chipOrProfile', value)} />
        <Field label="Motivo override Instagram" value={draft.instagram_override_reason ?? ''} readOnly={readOnly} onChange={(value) => updateDraft('instagram_override_reason', value)} />
        <div className="drawer-grid drawer-grid--2">
          <Field label="Override por" value={draft.override_by ?? ''} readOnly={readOnly} onChange={(value) => updateDraft('override_by', value)} />
          <Field label="Override em" value={draft.override_at ?? ''} readOnly={readOnly} onChange={(value) => updateDraft('override_at', value)} />
        </div>
        <Field label="Observações" as="textarea" value={draft.notes ?? ''} readOnly={readOnly} onChange={(value) => updateDraft('notes', value)} />

        <section className="drawer-section">
          <h3>Histórico</h3>
          <div className="history-list">
            {lead.history.map((item) => (
              <article className="history-item" key={item.id}>
                <span>{item.date}</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </Drawer>
  );
}
