import { Archive, Check, Globe2, Instagram, Link2, MessageCircle, RefreshCcw, RotateCcw, Users, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  Button,
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
import { useDashboardData, type HomeFilters } from '../hooks/useDashboardData';
import type { ImportLead, ImportLeadDestination } from '../services/import/types';
import { isValidInstagram } from '../services/instagram/instagram.utils';
import { permissionsFor } from '../services/permissions';
import { isStatusGroup, statusLabel, statusTone } from '../services/status/status.mapper';

type DashboardRow = Record<string, ReactNode> & {
  id: string;
};

const PAGE_SIZE = 20;
const destinationOptions: ImportLeadDestination[] = ['WhatsApp', 'Com site', 'Agregadores', 'Instagram'];

const defaultFilters: HomeFilters = {
  search: '',
  branch: 'Todos',
  state: 'Todos',
  destination: 'Todos',
  instagram: 'Todos',
  situation: 'Em aguarde',
};

const columns: TableColumn<DashboardRow>[] = [
  { key: 'company', label: 'Nome da empresa', width: '18%' },
  { key: 'branch', label: 'Ramo', width: '13%' },
  { key: 'state', label: 'Estado', width: '9%' },
  { key: 'city', label: 'Cidade', width: '10%' },
  { key: 'phone', label: 'Telefone', width: '8%' },
  { key: 'instagram', label: 'Instagram', width: '8%' },
  { key: 'site', label: 'Site', width: '8%' },
  { key: 'destination', label: 'Destino', width: '10%' },
  { key: 'situation', label: 'Situacao', width: '10%' },
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

function mapsHref(lead: ImportLead) {
  if (lead.normalizedMapsUrl?.trim()) return ensureUrl(lead.normalizedMapsUrl);
  const query = [lead.empresa, lead.cidade, lead.estado].filter(Boolean).join(' ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function instagramHref(lead: ImportLead) {
  const instagram = lead.instagram_url ?? lead.instagram ?? '';
  if (!instagram.trim()) return '';
  if (/^https?:\/\//i.test(instagram)) return instagram;
  return `https://instagram.com/${instagram.replace(/^@/, '')}`;
}

function leadDestination(lead: ImportLead) {
  return lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino;
}

function leadChannel(lead: ImportLead) {
  return leadDestination(lead) === 'Instagram' ? 'Instagram' : 'WhatsApp';
}

function hasPhone(lead: ImportLead) {
  return Boolean(lead.whatsapp?.trim());
}

function hasInstagram(lead: ImportLead) {
  return isValidInstagram(lead.instagram_url ?? lead.instagram ?? '');
}

function situationTag(lead: ImportLead) {
  return <Tag tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Tag>;
}

export function HomePage() {
  const [filters, setFilters] = useState<HomeFilters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [activeLead, setActiveLead] = useState<ImportLead | null>(null);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [leadForm, setLeadForm] = useState({
    empresa: '',
    ramo: '',
    destino: 'WhatsApp' as ImportLeadDestination,
    whatsapp: '',
    instagram: '',
    site: '',
    cidade: '',
    estado: '',
  });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dashboard = useDashboardData(filters);

  const rows = useMemo<DashboardRow[]>(
    () =>
      dashboard.visibleLeads.map((lead) => ({
        id: lead.id,
        company: silentLink(lead.empresa, mapsHref(lead)),
        branch: lead.ramo,
        state: lead.estado || '-',
        city: lead.cidade || '-',
        phone: yesNo(lead.whatsapp),
        instagram: silentLink(yesNo(lead.instagram_url ?? lead.instagram), instagramHref(lead)),
        site: silentLink(yesNo(lead.site), ensureUrl(lead.site)),
        destination: <DestinationBadge value={leadDestination(lead)} />,
        situation: situationTag(lead),
      })),
    [dashboard.visibleLeads],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const visibleLeadById = useMemo(() => new Map(dashboard.visibleLeads.map((lead) => [lead.id, lead])), [dashboard.visibleLeads]);
  const selectedLeads = useMemo(
    () => selectedRows.map((rowIndex) => visibleLeadById.get(pagedRows[rowIndex]?.id)).filter((lead): lead is ImportLead => Boolean(lead)),
    [pagedRows, selectedRows, visibleLeadById],
  );
  const selectedIds = selectedLeads.map((lead) => lead.id);
  const canBulkApprove = selectedLeads.length > 0 && selectedLeads.every((lead) => permissionsFor('import', lead.status).canApprove() && !isStatusGroup(lead.status, 'approved'));
  const canBulkUnapprove = selectedLeads.length > 0 && selectedLeads.every((lead) => isStatusGroup(lead.status, 'approved'));
  const canBulkInvalidate = selectedLeads.length > 0 && selectedLeads.every((lead) =>
    permissionsFor('import', lead.status).canInvalidate() &&
    !isStatusGroup(lead.status, 'approved') &&
    !isStatusGroup(lead.status, 'invalid')
  );
  const canBulkArchive = selectedLeads.length > 0 && selectedLeads.every((lead) => permissionsFor('import', lead.status).canArchive());
  const hasBulkAction = canBulkApprove || canBulkUnapprove || canBulkInvalidate || canBulkArchive;

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const updateFilter = <K extends keyof HomeFilters>(key: K, value: HomeFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setSelectedRows([]);
  };

  const findLead = (row: DashboardRow) => visibleLeadById.get(row.id);

  const openLeadDrawer = (lead: ImportLead, mode: 'view' | 'edit' = 'view') => {
    setActiveLead(lead);
    setDrawerMode(mode);
    setLeadForm({
      empresa: lead.empresa,
      ramo: lead.ramo,
      destino: leadDestination(lead) as ImportLeadDestination,
      whatsapp: lead.whatsapp ?? '',
      instagram: lead.instagram_url ?? lead.instagram ?? '',
      site: lead.site ?? '',
      cidade: lead.cidade ?? '',
      estado: lead.estado ?? '',
    });
  };

  const updateLeadForm = (key: keyof typeof leadForm, value: string) => {
    setLeadForm((current) => ({ ...current, [key]: value }));
  };

  const saveLead = async () => {
    if (!activeLead) return;
    try {
      await dashboard.updateLead(activeLead, {
        empresa: leadForm.empresa,
        ramo: leadForm.ramo,
        destino: leadForm.destino,
        destination: leadForm.destino,
        whatsapp: leadForm.whatsapp,
        instagram: leadForm.instagram,
        instagram_url: leadForm.instagram,
        site: leadForm.site,
        cidade: leadForm.cidade,
        estado: leadForm.estado,
      });
      pushToast({ title: 'Lead atualizado', description: 'Alteracao salva na camada de importacao.', tone: 'success' });
      setDrawerMode('view');
    } catch (err) {
      pushToast({ title: 'Nao foi possivel salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const runBulkAction = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
      pushToast({ title: 'Acao em massa concluida', description: `${selectedIds.length} lead(s): ${label}.`, tone: 'success' });
      setSelectedRows([]);
    } catch (err) {
      pushToast({ title: 'Acao em massa bloqueada', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleAction = async (action: TableAction, row: DashboardRow) => {
    const lead = findLead(row);
    if (!lead) return;

    if (action === 'view') {
      openLeadDrawer(lead, 'view');
      return;
    }

    try {
      if (action === 'whatsapp') {
        await dashboard.updateDestination(lead, 'WhatsApp');
        pushToast({ title: 'Destino atualizado', description: `${lead.empresa} voltou para o fluxo original.`, tone: 'success' });
        return;
      }

      if (action === 'instagram') {
        await dashboard.updateDestination(lead, 'Instagram');
        pushToast({ title: 'Destino atualizado', description: `${lead.empresa} foi marcado para Instagram.`, tone: 'success' });
        return;
      }

      if (action === 'approve') {
        await dashboard.approveLead(lead);
        pushToast({ title: 'Lead aprovado', description: `${lead.empresa} entrou como aprovado.`, tone: 'success' });
        return;
      }

      if (action === 'unapprove') {
        await dashboard.unapproveLead(lead);
        pushToast({ title: 'Aprovacao removida', description: `${lead.empresa} voltou para em aguarde.`, tone: 'info' });
        return;
      }

      if (action === 'archive') {
        await dashboard.archiveLead(lead);
        pushToast({ title: 'Lead arquivado', description: `${lead.empresa} saiu da lista operacional.`, tone: 'warning' });
        return;
      }

      if (action === 'invalidate') {
        await dashboard.invalidateLead(lead);
        pushToast({ title: 'Lead invalidado', description: `${lead.empresa} saiu da lista operacional. Motivo: Outros.`, tone: 'warning' });
      }
    } catch (err) {
      pushToast({ title: 'Acao bloqueada', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  return (
    <div className="dashboard-table-page lead-list-page lead-list-page--home">
      <PageHeader
        title="Inicio"
        action={
          <Button variant="secondary" iconLeft={RefreshCcw} disabled={dashboard.loading} onClick={dashboard.refresh}>
            Atualizar
          </Button>
        }
      />

      <section className="metric-grid metric-grid--5">
        <MetricCard icon={Users} value={`${dashboard.metrics.total.approved}/${dashboard.metrics.total.total}`} label="Total" />
        <MetricCard icon={MessageCircle} value={`${dashboard.metrics.whatsapp.approved}/${dashboard.metrics.whatsapp.total}`} label="WhatsApp" tone="success" />
        <MetricCard icon={Globe2} value={`${dashboard.metrics.ownSite.approved}/${dashboard.metrics.ownSite.total}`} label="Com site" />
        <MetricCard icon={Link2} value={`${dashboard.metrics.aggregators.approved}/${dashboard.metrics.aggregators.total}`} label="Agregadores" tone="warning" />
        <MetricCard icon={Instagram} value={`${dashboard.metrics.instagram.approved}/${dashboard.metrics.instagram.total}`} label="Instagram" />
      </section>

      <FiltersBar>
        <SelectField value={filters.branch} options={dashboard.options.branches} placeholder="Ramo" onChange={(value) => updateFilter('branch', value)} />
        <SelectField value={filters.state} options={dashboard.options.states} placeholder="Estado" onChange={(value) => updateFilter('state', value)} />
        <SelectField value={filters.destination} options={dashboard.options.destinations} placeholder="Destino" onChange={(value) => updateFilter('destination', value)} />
        <SelectField value={filters.instagram} options={dashboard.options.instagram} placeholder="Instagram" onChange={(value) => updateFilter('instagram', value)} />
        <SelectField value={filters.situation} options={dashboard.options.situations} placeholder="Status" onChange={(value) => updateFilter('situation', value as HomeFilters['situation'])} />
        <SearchInput value={filters.search} onChange={(value) => updateFilter('search', value)} placeholder="Buscar" />
      </FiltersBar>

      <TableCard
        title="Listagem de leads"
        footerText={dashboard.loading ? 'Carregando leads...' : `Mostrando ${pagedRows.length} de ${rows.length} lead(s). ${selectedLeads.length} selecionado(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); setSelectedRows([]); }} />}
        page={currentPage}
        totalPages={totalPages}
        onPageChange={(nextPage) => { setPage(nextPage); setSelectedRows([]); }}
      >
        {selectedLeads.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedLeads.length} selecionado(s)</span>
            {canBulkApprove ? <Button size="sm" iconLeft={Check} onClick={() => runBulkAction('aprovados', () => dashboard.approveMany(selectedIds))}>Aprovar</Button> : null}
            {canBulkUnapprove ? <Button size="sm" variant="secondary" iconLeft={RotateCcw} onClick={() => runBulkAction('voltaram para em aguarde', () => dashboard.unapproveMany(selectedIds))}>Desaprovar</Button> : null}
            {canBulkInvalidate ? <Button size="sm" variant="secondary" iconLeft={X} onClick={() => runBulkAction('invalidados com motivo Outros', () => dashboard.invalidateMany(selectedIds))}>Invalidar</Button> : null}
            {canBulkArchive ? <Button size="sm" variant="danger" iconLeft={Archive} onClick={() => runBulkAction('arquivados', () => dashboard.archiveMany(selectedIds))}>Arquivar</Button> : null}
            {!hasBulkAction ? <small>Nenhuma acao em massa disponivel para a selecao atual.</small> : null}
          </div>
        ) : null}
        {dashboard.error ? <div className="table-message">{dashboard.error}</div> : null}
        {!dashboard.error && dashboard.loading ? <div className="table-message">Carregando leads da importacao...</div> : null}
        {!dashboard.error && !dashboard.loading && !pagedRows.length ? <div className="table-message">Nenhum lead em aguarde para atribuicao.</div> : null}
        {!dashboard.error && !dashboard.loading && pagedRows.length ? (
          <DataTable
            columns={columns}
            rows={pagedRows}
            actions={['view', 'whatsapp', 'instagram', 'approve', 'unapprove', 'invalidate', 'archive']}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            getRowActions={(row) => {
              const lead = findLead(row);
              if (!lead) return [];
              const channel = leadChannel(lead);
              return [
                'view' as TableAction,
                ...(channel === 'WhatsApp' && hasInstagram(lead) ? ['instagram' as TableAction] : []),
                ...(channel === 'Instagram' && hasPhone(lead) ? ['whatsapp' as TableAction] : []),
                ...(permissionsFor('import', lead.status).canApprove() && !isStatusGroup(lead.status, 'approved') ? ['approve' as TableAction] : []),
                ...(isStatusGroup(lead.status, 'approved') ? ['unapprove' as TableAction] : []),
                ...(permissionsFor('import', lead.status).canInvalidate() ? ['invalidate' as TableAction] : []),
                'archive' as TableAction,
              ];
            }}
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={Boolean(activeLead)}
        title={drawerMode === 'edit' ? 'Editar lead' : 'Detalhes do lead'}
        description={activeLead?.empresa ?? ''}
        onClose={() => { setActiveLead(null); setDrawerMode('view'); }}
        footer={
          drawerMode === 'edit' ? (
            <>
              <Button variant="secondary" onClick={() => setDrawerMode('view')}>Cancelar</Button>
              <Button onClick={saveLead}>Salvar</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { setActiveLead(null); setDrawerMode('view'); }}>Fechar</Button>
              {activeLead && permissionsFor('import', activeLead.status).canEdit() ? (
                <Button onClick={() => openLeadDrawer(activeLead, 'edit')}>Editar</Button>
              ) : null}
            </>
          )
        }
      >
        {activeLead ? (
          <div className={`drawer-form ${drawerMode === 'view' ? 'drawer-form--readonly' : ''}`}>
            <Field label="Nome da empresa" value={leadForm.empresa} readOnly={drawerMode === 'view'} onChange={(value) => updateLeadForm('empresa', value)} />
            <Field label="Ramo" value={leadForm.ramo} readOnly={drawerMode === 'view'} onChange={(value) => updateLeadForm('ramo', value)} />
            <div className="drawer-grid drawer-grid--2">
              <Field label="Estado" value={leadForm.estado} readOnly={drawerMode === 'view'} onChange={(value) => updateLeadForm('estado', value)} />
              <Field label="Cidade" value={leadForm.cidade} readOnly={drawerMode === 'view'} onChange={(value) => updateLeadForm('cidade', value)} />
            </div>
            <Field label="Telefone" value={leadForm.whatsapp} readOnly={drawerMode === 'view'} onChange={(value) => updateLeadForm('whatsapp', value)} />
            <Field label="Instagram" value={leadForm.instagram} readOnly={drawerMode === 'view'} onChange={(value) => updateLeadForm('instagram', value)} />
            <Field label="Site" value={leadForm.site} readOnly={drawerMode === 'view'} onChange={(value) => updateLeadForm('site', value)} />
            <div className="drawer-grid drawer-grid--2">
              <Field label="Destino original" value={activeLead.original_destination ?? activeLead.destino} readOnly />
              {drawerMode === 'view' ? (
                <Field label="Destino operacional" value={leadForm.destino} readOnly />
              ) : (
                <label className="drawer-field">
                  <span>Destino operacional</span>
                  <SelectField value={leadForm.destino} options={destinationOptions} onChange={(value) => updateLeadForm('destino', value)} />
                </label>
              )}
            </div>
            <Field label="Situacao" value={statusLabel(activeLead.status)} readOnly />
            {activeLead.motivo ? <Field label="Observacao" value={activeLead.motivo} readOnly /> : null}
          </div>
        ) : null}
      </Drawer>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
