import { Instagram, ListPlus, MessageCircle, Unplug, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { QueuePullDrawer } from '../components/QueuePullDrawer';
import { useClientPagination } from '../hooks/useClientPagination';
import { useLeadCycle } from '../hooks/useLeadCycle';
import { useOperationalQueueDate } from '../hooks/useOperationalQueueDate';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { configService } from '../services/config/config.service';
import type { BranchConfigRecord } from '../services/config/types';
import type { LeadCycleLead } from '../services/lead-cycle/types';
import { externalHttpHref, instagramHref, mapsHref, phoneHref } from '../utils/externalLinks';
import { normalizeBrazilState } from '../services/geo/brazilState';
import type { QueueReviewChannel, QueueReviewPullResult } from '../services/queue-review';

type Row = Record<string, ReactNode> & { id: string };

type LeadEditForm = {
  company: string;
  alternativeName: string;
  branchId: string;
  rawPhone: string;
  whatsapp: string;
  instagram: string;
  website: string;
  mapsUrl: string;
};

const emptyEditForm: LeadEditForm = {
  company: '',
  alternativeName: '',
  branchId: '',
  rawPhone: '',
  whatsapp: '',
  instagram: '',
  website: '',
  mapsUrl: '',
};

const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Empresa', width: '20%' },
  { key: 'branch', label: 'Ramo', width: '14%' },
  { key: 'state', label: 'Estado', width: '7%' },
  { key: 'city', label: 'Cidade', width: '11%' },
  { key: 'rating', label: 'Nota', width: '6%' },
  { key: 'reviews', label: 'Avaliações', width: '8%' },
  { key: 'number', label: 'Número', width: '8%' },
  { key: 'instagram', label: 'Instagram', width: '7%' },
  { key: 'site', label: 'Site', width: '7%' },
  { key: 'status', label: 'Status', width: '8%' },
];

function availabilityTag(available: boolean, href?: string, title?: string) {
  const tag = <Tag tone={available ? 'success' : 'neutral'}>{available ? 'Sim' : 'Não'}</Tag>;
  if (!available || !href) return tag;
  return <a className="availability-link" href={href} target="_blank" rel="noreferrer" title={title}>{tag}</a>;
}

function companyCell(lead: LeadCycleLead) {
  const href = mapsHref(lead.mapsUrl);
  if (!href) return <strong title={lead.displayCompany}>{lead.displayCompany}</strong>;
  return <a className="company-map-link" href={href} target="_blank" rel="noreferrer" title={`Abrir ${lead.displayCompany} no Google Maps`}><strong>{lead.displayCompany}</strong></a>;
}


function toEditForm(lead: LeadCycleLead): LeadEditForm {
  return {
    company: lead.company,
    alternativeName: lead.alternativeName,
    branchId: lead.branchId,
    rawPhone: lead.rawPhone,
    whatsapp: lead.whatsapp,
    instagram: lead.instagram,
    website: lead.website,
    mapsUrl: lead.mapsUrl,
  };
}

export function HomePage() {
  const { hasPermission } = useOrganizationContext();
  const canPrepare = hasPermission('queues.prepare');
  const canEdit = hasPermission('leads.edit');
  const canInvalidate = hasPermission('leads.delete');
  const imported = useLeadCycle('imported');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('Todos');
  const [state, setState] = useState('Todos');
  const [siteFilter, setSiteFilter] = useState('Todos');
  const [instagramFilter, setInstagramFilter] = useState('Todos');
  const [pullDrawerOpen, setPullDrawerOpen] = useState(false);
  const [scheduledDate, setScheduledDate] = useOperationalQueueDate();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [branches, setBranches] = useState<BranchConfigRecord[]>([]);
  const [editingLead, setEditingLead] = useState<LeadCycleLead | null>(null);
  const [editForm, setEditForm] = useState<LeadEditForm>(emptyEditForm);
  const [invalidatingLead, setInvalidatingLead] = useState<LeadCycleLead | null>(null);

  const toast = (title: string, description: string, tone: ToastItem['tone'] = 'success') => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, title, description, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  };

  useEffect(() => {
    void configService.list('branches').then((records) => {
      setBranches(records.filter((record): record is BranchConfigRecord => record.kind === 'branches' && record.active));
    }).catch((error) => {
      toast('Não foi possível carregar os dados operacionais', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const branchOptions = useMemo(() => {
    const unique = new Map<string, BranchConfigRecord>();
    branches.forEach((item) => {
      const key = item.name.trim().toLocaleLowerCase('pt-BR');
      if (key && !unique.has(key)) unique.set(key, item);
    });
    return Array.from(unique.values())
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
      .map((item) => ({ label: item.name, value: item.id }));
  }, [branches]);

  const sorted = useMemo(() => [...imported.records].sort((a, b) =>
    b.rating - a.rating || b.reviews - a.reviews || Number(a.id) - Number(b.id)
  ), [imported.records]);

  const branchFilters = useMemo(() => ['Todos', ...Array.from(new Set(sorted.map((lead) => lead.branch).filter(Boolean))).sort()], [sorted]);
  const stateFilters = useMemo(() => {
    const states = Array.from(new Set(sorted.map((lead) => lead.state).filter(Boolean)));
    return [
      { label: 'Todos', value: 'Todos' },
      ...states
        .map((code) => ({ label: normalizeBrazilState(code), value: code }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' })),
    ];
  }, [sorted]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((lead) =>
      (!q || lead.displayCompany.toLowerCase().includes(q) || lead.company.toLowerCase().includes(q) || lead.phone.toLowerCase().includes(q) || lead.instagram.toLowerCase().includes(q))
      && (branch === 'Todos' || lead.branch === branch)
      && (state === 'Todos' || lead.state === state)
      && (siteFilter === 'Todos' || (siteFilter === 'Com site' ? Boolean(lead.website.trim()) : !lead.website.trim()))
      && (instagramFilter === 'Todos' || (instagramFilter === 'Com Instagram' ? Boolean(lead.instagram.trim()) : !lead.instagram.trim()))
    );
  }, [branch, instagramFilter, search, siteFilter, sorted, state]);

  const rows = useMemo<Row[]>(() => visible.map((lead) => {
    const phone = lead.rawPhone || lead.phone;
    const instagram = instagramHref(lead.instagram);
    const website = externalHttpHref(lead.website);
    return {
      id: lead.id,
      company: companyCell(lead),
      branch: lead.branch || '—',
      state: lead.state || '—',
      city: lead.city || '—',
      rating: lead.rating.toFixed(1),
      reviews: lead.reviews.toLocaleString('pt-BR'),
      number: availabilityTag(Boolean(String(phone).replace(/\D/g, '')), phoneHref(phone), 'Abrir contato'),
      instagram: availabilityTag(Boolean(lead.instagram.trim()), instagram, 'Abrir Instagram'),
      site: availabilityTag(Boolean(lead.website.trim()), website, 'Abrir site'),
      status: <Tag tone="neutral">Importado</Tag>,
    };
  }), [visible]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);

  const handlePulled = (channel: QueueReviewChannel, result: QueueReviewPullResult) => {
    setScheduledDate(result.scheduledDate);
    imported.removeLocally(result.movedLeadIds);
    imported.patchChannelLocally(result.redirectedLeadIds, 'Instagram');
    resetPage();
    const formattedDate = new Date(`${result.scheduledDate}T12:00:00`).toLocaleDateString('pt-BR');
    const details = `${result.ready} pronto(s) para revisão · ${result.reserved} reservado(s) · ${result.resource.label} · ${formattedDate}.`;
    const redirected = result.redirectedToInstagram ? ` ${result.redirectedToInstagram} telefone(s) não confirmado(s) no WhatsApp e direcionado(s) ao Instagram.` : '';
    const technical = result.technicalStop
      ? ` Houve erro técnico; os afetados foram liberados sem retry automático.${result.technicalReasons.length ? ` Motivo: ${result.technicalReasons.join(' | ')}` : ''}`
      : '';
    toast(`Fila ${channel} preparada`, details + redirected + technical + (result.exhausted ? ` Não havia leads elegíveis suficientes para preencher as ${result.capacityToFill} vaga(s) disponíveis.` : ''), result.errors ? 'warning' : 'success');
  };

  const openEdit = (lead: LeadCycleLead) => {
    setEditingLead(lead);
    setEditForm(toEditForm(lead));
  };

  const closeEdit = () => {
    setEditingLead(null);
    setEditForm(emptyEditForm);
  };

  const saveEdit = async () => {
    if (!editingLead || !canEdit) return;
    try {
      await imported.updateDetails(editingLead, editForm);
      closeEdit();
      toast('Lead atualizado', 'Os dados foram atualizados e o destino do Importado foi recalculado pelos contatos.');
    } catch (error) {
      toast('Não foi possível salvar', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    }
  };

  const confirmInvalidate = async () => {
    if (!invalidatingLead || !canInvalidate) return;
    try {
      const result = await imported.executeRoutingCommand('invalidate-imported', [invalidatingLead.id]);
      if (result.failed) throw new Error(result.failures[0]?.reason || 'Não foi possível invalidar o lead.');
      setInvalidatingLead(null);
      resetPage();
      toast('Lead invalidado', `${invalidatingLead.company} saiu dos Importados.`);
    } catch (error) {
      toast('Não foi possível invalidar', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    }
  };

  const handleAction = (action: TableAction, row: Row) => {
    const lead = imported.records.find((item) => item.id === row.id);
    if (!lead) return;
    if (action === 'edit') openEdit(lead);
    if (action === 'invalidate') setInvalidatingLead(lead);
  };

  const noDestinationCount = sorted.filter((lead) => lead.channel === 'Sem destino').length;
  const whatsappCount = sorted.filter((lead) => lead.channel === 'WhatsApp').length;
  const instagramCount = sorted.filter((lead) => lead.channel === 'Instagram').length;


  return (
    <div className="dashboard-table-page lead-list-page home-leads-page">
      <PageHeader
        title="Início"
        description="Leads importados aguardando seleção. Os melhores avaliados são puxados primeiro, independentemente da data de entrada."
        action={canPrepare ? <div className="home-leads-actions home-leads-actions--compact"><Button iconLeft={ListPlus} onClick={() => setPullDrawerOpen(true)}>Puxar leads</Button></div> : undefined}
      />

      <section className="metric-grid metric-grid--4">
        <MetricCard icon={Users} value={String(sorted.length)} label="Importados" tone="neutral" />
        <MetricCard icon={Unplug} value={String(noDestinationCount)} label="Sem destino" tone="warning" />
        <MetricCard icon={MessageCircle} value={String(whatsappCount)} label="WhatsApp" tone="success" />
        <MetricCard icon={Instagram} value={String(instagramCount)} label="Instagram" tone="primary" />
      </section>

      <FiltersBar>
        <SelectField value={branch} options={branchFilters} placeholder="Ramo" onChange={(value) => { setBranch(value); resetPage(); }} />
        <SelectField value={state} options={stateFilters} placeholder="Estado" onChange={(value) => { setState(value); resetPage(); }} />
        <SelectField value={siteFilter} options={['Todos', 'Sem site', 'Com site']} placeholder="Site" onChange={(value) => { setSiteFilter(value); resetPage(); }} />
        <SelectField value={instagramFilter} options={['Todos', 'Sem Instagram', 'Com Instagram']} placeholder="Instagram" onChange={(value) => { setInstagramFilter(value); resetPage(); }} />
        <SearchInput value={search} placeholder="Buscar empresa ou contato" onChange={(value) => { setSearch(value); resetPage(); }} />
      </FiltersBar>

      <TableCard
        title="Leads importados"
        footerText={`Mostrando ${pageItems.length} de ${rows.length} lead(s) · ordenação por nota e avaliações`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {imported.error ? <div className="table-message">{imported.error}</div> : null}
        {!imported.error && imported.loading ? <div className="table-message">Carregando leads importados...</div> : null}
        {!imported.error && !imported.loading && !rows.length ? <div className="table-message">Nenhum lead importado disponível.</div> : null}
        {!imported.error && !imported.loading && pageItems.length ? (
          <DataTable
            columns={columns}
            rows={pageItems}
            actionsLabel="Ações"
            getRowActions={() => [
              ...(canEdit ? ['edit' as const] : []),
              ...(canInvalidate ? ['invalidate' as const] : []),
            ]}
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={editingLead !== null}
        title="Editar lead"
        description="O lead continua Importado. O destino é recalculado pelos contatos: WhatsApp, Instagram ou Sem destino."
        onClose={closeEdit}
        footer={(
          <>
            <Button variant="secondary" onClick={closeEdit}>Cancelar</Button>
            <Button loading={imported.saving} disabled={!canEdit} onClick={() => void saveEdit()}>Salvar</Button>
          </>
        )}
      >
        {editingLead ? (
          <div className="drawer-form">
            <Field label="Empresa original" value={editForm.company} onChange={(value) => setEditForm((current) => ({ ...current, company: value }))} />
            <Field label="Nome alternativo (opcional)" value={editForm.alternativeName} maxLength={160} placeholder="Nome curto usado nos envios" onChange={(value) => setEditForm((current) => ({ ...current, alternativeName: value }))} />
            <label className="drawer-field">
              <span>Ramo</span>
              <SelectField value={editForm.branchId} options={branchOptions} placeholder="Selecione o ramo" onChange={(value) => setEditForm((current) => ({ ...current, branchId: value }))} />
            </label>
            <Field label="Estado" value={editingLead.state || '—'} readOnly />
            <Field label="Cidade" value={editingLead.city || '—'} readOnly />
            <Field label="Telefone" value={editForm.rawPhone} onChange={(value) => setEditForm((current) => ({ ...current, rawPhone: value }))} />
            <Field label="WhatsApp" value={editForm.whatsapp} onChange={(value) => setEditForm((current) => ({ ...current, whatsapp: value }))} />
            <Field label="Instagram" value={editForm.instagram} onChange={(value) => setEditForm((current) => ({ ...current, instagram: value }))} />
            <Field label="Site" value={editForm.website} onChange={(value) => setEditForm((current) => ({ ...current, website: value }))} />
            <Field label="Google Maps" value={editForm.mapsUrl} onChange={(value) => setEditForm((current) => ({ ...current, mapsUrl: value }))} />
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={invalidatingLead !== null}
        title="Invalidar lead?"
        description="O lead será removido da base de Importados e não será selecionado para uma fila futura."
        confirmLabel="Invalidar"
        danger
        onClose={() => setInvalidatingLead(null)}
        onConfirm={() => void confirmInvalidate()}
      >
        {invalidatingLead ? <strong>{invalidatingLead.company}</strong> : null}
      </ConfirmDialog>

      <QueuePullDrawer open={pullDrawerOpen} initialDate={scheduledDate} onClose={() => setPullDrawerOpen(false)} onPulled={handlePulled} onError={(title, description) => toast(title, description, 'danger')} />
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toastItem) => toastItem.id !== id))} />
    </div>
  );
}
