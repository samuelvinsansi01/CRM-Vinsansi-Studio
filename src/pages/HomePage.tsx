import { Instagram, MessageCircle, RefreshCcw, Users } from 'lucide-react';
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
import { useClientPagination } from '../hooks/useClientPagination';
import { useLeadCycle } from '../hooks/useLeadCycle';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { configService } from '../services/config/config.service';
import type { BranchConfigRecord } from '../services/config/types';
import type { LeadCycleLead } from '../services/lead-cycle/types';
import { queueReviewService } from '../services/queue-review';
import { toLocalDateInputValue } from '../utils/date';

type Row = Record<string, ReactNode> & { id: string };

type LeadEditForm = {
  company: string;
  branchId: string;
  rawPhone: string;
  whatsapp: string;
  instagram: string;
  website: string;
  mapsUrl: string;
};

const emptyEditForm: LeadEditForm = {
  company: '',
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
  { key: 'instagram', label: 'Instagram', width: '8%' },
  { key: 'status', label: 'Status', width: '9%' },
];

function availabilityTag(available: boolean) {
  return <Tag tone={available ? 'success' : 'neutral'}>{available ? 'Sim' : 'Não'}</Tag>;
}

function toEditForm(lead: LeadCycleLead): LeadEditForm {
  return {
    company: lead.company,
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
  const [pulling, setPulling] = useState<'WhatsApp' | 'Instagram' | ''>('');
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
      toast('Não foi possível carregar os ramos', error instanceof Error ? error.message : 'Tente novamente.', 'danger');
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
  const stateFilters = useMemo(() => ['Todos', ...Array.from(new Set(sorted.map((lead) => lead.state).filter(Boolean))).sort()], [sorted]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((lead) =>
      (!q || lead.company.toLowerCase().includes(q) || lead.phone.toLowerCase().includes(q) || lead.instagram.toLowerCase().includes(q))
      && (branch === 'Todos' || lead.branch === branch)
      && (state === 'Todos' || lead.state === state)
    );
  }, [branch, search, sorted, state]);

  const rows = useMemo<Row[]>(() => visible.map((lead) => ({
    id: lead.id,
    company: <strong>{lead.company}</strong>,
    branch: lead.branch || '—',
    state: lead.state || '—',
    city: lead.city || '—',
    rating: lead.rating.toFixed(1),
    reviews: lead.reviews.toLocaleString('pt-BR'),
    number: availabilityTag(Boolean((lead.whatsapp || lead.rawPhone).replace(/\D/g, ''))),
    instagram: availabilityTag(Boolean(lead.instagram.trim())),
    status: <Tag tone="neutral">Importado</Tag>,
  })), [visible]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);

  const pull = async (channel: 'WhatsApp' | 'Instagram') => {
    if (!canPrepare) return;
    setPulling(channel);
    try {
      const result = await queueReviewService.pullToCapacity(channel, toLocalDateInputValue());
      await imported.refresh();
      resetPage();
      const details = `${result.batch.openCount}/${result.batch.targetCount} lead(s) prontos para revisão em ${result.resource.label}.`;
      toast(`Fila ${channel} preparada`, details + (result.exhausted ? ' A base elegível acabou antes do limite.' : ''), result.errors ? 'warning' : 'success');
    } catch (error) {
      toast(`Não foi possível puxar ${channel}`, error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    } finally {
      setPulling('');
    }
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
      toast('Lead atualizado', 'Os dados foram atualizados sem definir destino.');
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

  const whatsappCount = sorted.filter((lead) => (lead.whatsapp || lead.rawPhone).replace(/\D/g, '').length >= 10).length;
  const instagramCount = sorted.filter((lead) => Boolean(lead.instagram.trim())).length;

  return (
    <div className="dashboard-table-page lead-list-page home-leads-page">
      <PageHeader
        title="Início"
        description="Leads importados aguardando seleção. Os melhores avaliados são puxados primeiro, independentemente da data de entrada."
        action={(
          <div className="home-leads-actions">
            <Button variant="secondary" iconLeft={RefreshCcw} disabled={imported.loading || Boolean(pulling)} onClick={() => void imported.refresh()}>Atualizar</Button>
            {canPrepare ? <Button iconLeft={MessageCircle} loading={pulling === 'WhatsApp'} disabled={Boolean(pulling)} onClick={() => void pull('WhatsApp')}>Puxar WhatsApp</Button> : null}
            {canPrepare ? <Button iconLeft={Instagram} loading={pulling === 'Instagram'} disabled={Boolean(pulling)} onClick={() => void pull('Instagram')}>Puxar Instagram</Button> : null}
          </div>
        )}
      />

      <section className="metric-grid metric-grid--3">
        <MetricCard icon={Users} value={String(sorted.length)} label="Importados" tone="neutral" />
        <MetricCard icon={MessageCircle} value={String(whatsappCount)} label="Com número" tone="success" />
        <MetricCard icon={Instagram} value={String(instagramCount)} label="Com Instagram" tone="primary" />
      </section>

      <FiltersBar>
        <SelectField value={branch} options={branchFilters} placeholder="Ramo" onChange={(value) => { setBranch(value); resetPage(); }} />
        <SelectField value={state} options={stateFilters} placeholder="Estado" onChange={(value) => { setState(value); resetPage(); }} />
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
        description="O lead continua Importado e sem destino. O canal só será definido quando você puxar a fila."
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
            <Field label="Empresa" value={editForm.company} onChange={(value) => setEditForm((current) => ({ ...current, company: value }))} />
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

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toastItem) => toastItem.id !== id))} />
    </div>
  );
}
