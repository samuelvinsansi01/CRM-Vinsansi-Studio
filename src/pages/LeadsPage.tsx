import { ClipboardCheck, List, Plus, RefreshCcw, Send, Unplug, Users, X } from 'lucide-react';
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
import { useCrmLeads } from '../hooks/useCrmLeads';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { configService } from '../services/config/config.service';
import type { BranchConfigRecord } from '../services/config/types';
import { BRAZIL_STATE_OPTIONS } from '../services/geo/brazilState';
import { cityCatalogService, type CityOption } from '../services/geo/cityCatalog.service';
import { importService } from '../services/import/import.service';
import type { ImportLeadDestination } from '../services/import/types';
import { normalizeInstagramUsername } from '../services/instagram/instagram.utils';
import { leadCycleService } from '../services/lead-cycle/leadCycle.service';
import type { LeadCycleDetailsInput, LeadCycleLead } from '../services/lead-cycle/types';
import { COMMERCIAL_STAGE_LABELS, type CommercialStage, type CrmLead } from '../services/leads/crmLead.types';
import { LEAD_STATUS } from '../services/status/leadStatus';
import { statusLabel, statusTone } from '../services/status/status.mapper';
import { externalHttpHref, instagramHref, mapsHref, whatsappHref } from '../utils/externalLinks';

type Row = Record<string, ReactNode> & { id: string };
type ManualLeadForm = {
  company: string;
  alternativeName: string;
  branchId: string;
  state: string;
  city: string;
  whatsapp: string;
  instagram: string;
  website: string;
  mapsUrl: string;
};

const EMPTY_MANUAL: ManualLeadForm = {
  company: '',
  alternativeName: '',
  branchId: '',
  state: '',
  city: '',
  whatsapp: '',
  instagram: '',
  website: '',
  mapsUrl: '',
};
const EMPTY_EDIT: LeadCycleDetailsInput = {
  company: '',
  alternativeName: '',
  branchId: '',
  rawPhone: '',
  whatsapp: '',
  instagram: '',
  website: '',
  mapsUrl: '',
};
const STATUS_OPTIONS = [
  { label: 'Todos', value: '' },
  { label: 'Importado', value: '1' },
  { label: 'Em revisão', value: '2' },
  { label: 'Sem contato', value: '3' },
  { label: 'Em fila', value: '4' },
  { label: 'Enviado', value: '5' },
  { label: 'Inválido', value: '6' },
  { label: 'Duplicado', value: '7' },
];
const COMMERCIAL_OPTIONS = [
  { label: 'Todos', value: '' },
  ...Object.entries(COMMERCIAL_STAGE_LABELS).map(([value, label]) => ({ value, label })),
];

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function contactLink(label: string, href?: string) {
  if (!href) return label || '—';
  return <a className="silent-link" href={href} target="_blank" rel="noreferrer">{label}</a>;
}

function stageTag(lead: CrmLead) {
  if (lead.statusId !== LEAD_STATUS.SENT || !lead.commercialStage) return '—';
  const tone = lead.commercialStage === 'fechado'
    ? 'success'
    : lead.commercialStage === 'recusado'
      ? 'danger'
      : lead.commercialStage === 'aguardando_design'
        ? 'warning'
        : lead.commercialStage === 'design_enviado'
          ? 'primary'
          : 'neutral';
  return <Tag tone={tone}>{COMMERCIAL_STAGE_LABELS[lead.commercialStage]}</Tag>;
}

function operationalTag(lead: CrmLead) {
  return <Tag tone={statusTone(lead.statusId)}>{statusLabel(lead.statusId)}</Tag>;
}

function toEditForm(lead: LeadCycleLead): LeadCycleDetailsInput {
  return {
    company: lead.company,
    alternativeName: lead.alternativeName,
    branchId: lead.branchId,
    channel: lead.channel ?? undefined,
    rawPhone: lead.rawPhone,
    whatsapp: lead.whatsapp,
    instagram: lead.instagram,
    website: lead.website,
    mapsUrl: lead.mapsUrl,
  };
}

export function LeadsPage() {
  const { hasPermission } = useOrganizationContext();
  const canCreate = hasPermission('leads.create');
  const canEdit = hasPermission('leads.edit');
  const canInvalidate = hasPermission('leads.delete');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const initialStatus = window.sessionStorage.getItem('crm:leads:status-id') ?? '';
  const [statusId, setStatusId] = useState(initialStatus);
  const [channel, setChannel] = useState('Todos');
  const [commercialStage, setCommercialStage] = useState('');
  const [branchId, setBranchId] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [viewingLead, setViewingLead] = useState<CrmLead | null>(null);
  const [editingLead, setEditingLead] = useState<LeadCycleLead | null>(null);
  const [editForm, setEditForm] = useState<LeadCycleDetailsInput>(EMPTY_EDIT);
  const [editLoading, setEditLoading] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [manual, setManual] = useState<ManualLeadForm>(EMPTY_MANUAL);
  const [cityOptions, setCityOptions] = useState<CityOption[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [branches, setBranches] = useState<BranchConfigRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [invalidatingLead, setInvalidatingLead] = useState<CrmLead | null>(null);
  const [returningLead, setReturningLead] = useState<CrmLead | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [{ id, ...toast }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3600);
  };

  useEffect(() => {
    window.sessionStorage.removeItem('crm:leads:status-id');
    void configService.list('branches').then((records) => {
      setBranches(records.filter((record): record is BranchConfigRecord => record.kind === 'branches' && record.active));
    }).catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    let active = true;
    if (!manual.state) {
      setCityOptions([]);
      setCitiesLoading(false);
      return undefined;
    }
    setCitiesLoading(true);
    void cityCatalogService.listCitiesByStateCode(manual.state)
      .then((options) => { if (active) setCityOptions(options); })
      .catch((err) => {
        if (!active) return;
        setCityOptions([]);
        pushToast({ title: 'Não foi possível carregar as cidades', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
      })
      .finally(() => { if (active) setCitiesLoading(false); });
    return () => { active = false; };
    // pushToast é estável o suficiente para este carregamento derivado do estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual.state]);

  const filters = useMemo(() => ({
    search: debouncedSearch,
    statusId: statusId ? Number(statusId) : null,
    channel,
    commercialStage: commercialStage as CommercialStage | '',
    branchId,
    state,
  }), [branchId, channel, commercialStage, debouncedSearch, state, statusId]);

  const { items, total, summary, loading, refreshing, error, refresh } = useCrmLeads(filters, page, rowsPerPage);
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const resetPage = () => setPage(1);
  const branchOptions = useMemo(() => [
    { label: 'Todos', value: '' },
    ...branches.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((branch) => ({ label: branch.name, value: branch.id })),
  ], [branches]);
  const editBranchOptions = branchOptions.filter((item) => item.value);
  const stateOptions = [{ label: 'Todos', value: '' }, ...BRAZIL_STATE_OPTIONS];

  const columns: TableColumn<Row>[] = [
    { key: 'company', label: 'Empresa', width: '18%' },
    { key: 'branch', label: 'Ramo', width: '12%' },
    { key: 'state', label: 'Estado', width: '6%' },
    { key: 'city', label: 'Cidade', width: '10%' },
    { key: 'channel', label: 'Canal', width: '9%' },
    { key: 'instagram', label: 'Instagram', width: '11%' },
    { key: 'whatsapp', label: 'WhatsApp', width: '12%' },
    { key: 'status', label: 'Status', width: '10%' },
    { key: 'commercial', label: 'Comercial', width: '12%' },
  ];

  const rows = useMemo<Row[]>(() => items.map((lead) => ({
    id: lead.id,
    company: lead.alternativeName ? <span title={`Nome original: ${lead.company}`}><strong>{lead.alternativeName}</strong></span> : lead.company,
    branch: lead.branch || '—',
    state: lead.state || '—',
    city: lead.city || '—',
    channel: <Tag tone={lead.channel === 'WhatsApp' ? 'success' : lead.channel === 'Instagram' ? 'primary' : 'neutral'}>{lead.channel}</Tag>,
    instagram: lead.instagram ? contactLink(`@${lead.instagram.replace(/^@/, '')}`, instagramHref(lead.instagram)) : '—',
    whatsapp: lead.phone ? contactLink(lead.phone, whatsappHref(lead.phone) ?? '') : '—',
    status: operationalTag(lead),
    commercial: stageTag(lead),
  })), [items]);

  const openEdit = async (lead: CrmLead) => {
    if (!canEdit || editLoading) return;
    setEditLoading(true);
    try {
      const canonical = await leadCycleService.getById(lead.id);
      setEditingLead(canonical);
      setEditForm(toEditForm(canonical));
    } catch (err) {
      pushToast({ title: 'Não foi possível abrir a edição', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setEditLoading(false);
    }
  };

  const closeEdit = () => {
    if (saving) return;
    setEditingLead(null);
    setEditForm(EMPTY_EDIT);
  };

  const saveEdit = async () => {
    if (!editingLead || !canEdit || saving) return;
    setSaving(true);
    try {
      const wasNoContact = editingLead.statusId === LEAD_STATUS.NO_CONTACT;
      await leadCycleService.updateDetails(editingLead, editForm);
      setEditingLead(null);
      setEditForm(EMPTY_EDIT);
      setPage(1);
      await refresh();
      pushToast({
        title: wasNoContact ? 'Lead recuperado' : 'Lead atualizado',
        description: wasNoContact
          ? 'O contato foi salvo e o lead voltou para Importado, pronto para entrar novamente na operação.'
          : 'Os dados canônicos do lead foram atualizados.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Não foi possível salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const confirmInvalidate = async () => {
    if (!invalidatingLead || !canInvalidate || saving) return;
    setSaving(true);
    try {
      await leadCycleService.invalidateLead(invalidatingLead.id);
      setInvalidatingLead(null);
      setPage(1);
      await refresh();
      pushToast({ title: 'Lead invalidado', description: 'O lead foi separado dos leads sem contato e não será puxado para uma nova fila.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível invalidar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const confirmReturn = async () => {
    if (!returningLead || !canEdit || saving) return;
    setSaving(true);
    try {
      await leadCycleService.restoreInvalidToImported(returningLead.id);
      setReturningLead(null);
      setPage(1);
      await refresh();
      pushToast({ title: 'Lead retornado', description: 'O lead voltou para Importado e pode entrar novamente na operação.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível retornar', description: err instanceof Error ? err.message : 'Edite o contato antes de tentar novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const getRowActions = (row: Row): TableAction[] => {
    const lead = items.find((item) => item.id === row.id);
    if (!lead) return [];
    const actions: TableAction[] = ['view'];
    if (canEdit && [LEAD_STATUS.IMPORTED, LEAD_STATUS.NO_CONTACT, LEAD_STATUS.SENT, LEAD_STATUS.INVALID].includes(lead.statusId as 1 | 3 | 5 | 6)) actions.push('edit');
    if (canInvalidate && [LEAD_STATUS.IMPORTED, LEAD_STATUS.NO_CONTACT].includes(lead.statusId as 1 | 3)) actions.push('invalidate');
    if (canEdit && lead.statusId === LEAD_STATUS.INVALID) actions.push('return');
    return actions;
  };

  const handleAction = (action: TableAction, row: Row) => {
    const lead = items.find((item) => item.id === row.id);
    if (!lead) return;
    if (action === 'view') setViewingLead(lead);
    if (action === 'edit') void openEdit(lead);
    if (action === 'invalidate') setInvalidatingLead(lead);
    if (action === 'return') setReturningLead(lead);
  };

  const addManualLead = async () => {
    if (!canCreate || saving) return;
    const company = manual.company.trim();
    const branch = branches.find((item) => item.id === manual.branchId) ?? null;
    const whatsapp = manual.whatsapp.trim();
    const instagram = normalizeInstagramUsername(manual.instagram);
    if (!company) return pushToast({ title: 'Nome obrigatório', description: 'Informe o nome da empresa.', tone: 'danger' });
    if (!branch) return pushToast({ title: 'Ramo obrigatório', description: 'Selecione um ramo ativo.', tone: 'danger' });
    if (!manual.state) return pushToast({ title: 'Estado obrigatório', description: 'Selecione o estado.', tone: 'danger' });
    if (!manual.city) return pushToast({ title: 'Cidade obrigatória', description: 'Selecione uma cidade do estado escolhido.', tone: 'danger' });
    if (!whatsapp && !instagram) return pushToast({ title: 'Contato obrigatório', description: 'Informe pelo menos WhatsApp ou Instagram.', tone: 'danger' });
    if (manual.instagram.trim() && !instagram) return pushToast({ title: 'Instagram inválido', description: 'Informe um @, username ou URL de perfil válido.', tone: 'danger' });

    const destination: ImportLeadDestination = whatsapp && instagram ? 'Sem destino' : instagram ? 'Instagram' : 'WhatsApp';
    setSaving(true);
    try {
      const result = await importService.createFromImport({
        empresa: company,
        alternative_name: manual.alternativeName.trim(),
        branch_id: branch.id,
        ramo: branch.name,
        destino: destination,
        original_destination: whatsapp ? 'WhatsApp' : 'Instagram',
        destination,
        destination_override: undefined,
        send_instagram: false,
        instagram_url: instagram,
        status: 'pending',
        whatsapp,
        instagram,
        site: manual.website.trim(),
        cidade: manual.city,
        estado: manual.state,
        normalizedMapsUrl: manual.mapsUrl.trim(),
        motivo: '',
      });
      if (result.simulation) {
        pushToast({ title: 'Simulação ativa', description: 'O cadastro manual está bloqueado enquanto a simulação de importação estiver ativa.', tone: 'warning' });
        return;
      }
      setManual(EMPTY_MANUAL);
      setCityOptions([]);
      setInsertOpen(false);
      setPage(1);
      await refresh();
      pushToast({ title: 'Lead inserido', description: 'O lead entrou na base como Importado e já pode ser preparado para envio.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível inserir', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dashboard-table-page lead-list-page crm-leads-page">
      <PageHeader
        title="Leads"
        description="Base canônica das empresas do CRM. Leads e Comercial usam estes mesmos registros; Comercial é apenas uma visão de gestão dos enviados."
        action={(
          <div className="page-header-actions">
            <Button variant="secondary" iconLeft={RefreshCcw} loading={refreshing} disabled={loading} onClick={() => void refresh()}>Atualizar</Button>
            {canCreate ? <Button iconLeft={Plus} onClick={() => setInsertOpen(true)}>Inserir lead</Button> : null}
          </div>
        )}
      />

      <section className="metric-grid metric-grid--6">
        <MetricCard icon={Users} value={String(summary.total)} label="Total" active={!statusId} onClick={() => { setStatusId(''); resetPage(); }} />
        <MetricCard icon={ClipboardCheck} value={String(summary.imported)} label="Importados" active={statusId === '1'} onClick={() => { setStatusId('1'); resetPage(); }} />
        <MetricCard icon={List} value={String(summary.queued)} label="Em fila" tone="primary" active={statusId === '4'} onClick={() => { setStatusId('4'); resetPage(); }} />
        <MetricCard icon={Send} value={String(summary.sent)} label="Enviados" tone="success" active={statusId === '5'} onClick={() => { setStatusId('5'); resetPage(); }} />
        <MetricCard icon={X} value={String(summary.invalid)} label="Inválidos" tone="danger" active={statusId === '6'} onClick={() => { setStatusId('6'); resetPage(); }} />
        <MetricCard icon={Unplug} value={String(summary.noContact)} label="Sem contato" tone="warning" active={statusId === '3'} onClick={() => { setStatusId('3'); resetPage(); }} />
      </section>

      <FiltersBar>
        <SelectField value={statusId} options={STATUS_OPTIONS} placeholder="Status" onChange={(value) => { setStatusId(value); resetPage(); }} />
        <SelectField value={channel} options={['Todos', 'WhatsApp', 'Instagram', 'Sem destino', 'Sem canal']} placeholder="Canal" onChange={(value) => { setChannel(value); resetPage(); }} />
        <SelectField value={commercialStage} options={COMMERCIAL_OPTIONS} placeholder="Comercial" onChange={(value) => { setCommercialStage(value); resetPage(); }} />
        <SelectField value={branchId} options={branchOptions} searchable searchPlaceholder="Buscar ramo..." placeholder="Ramo" onChange={(value) => { setBranchId(value); resetPage(); }} />
        <SelectField value={state} options={stateOptions} searchable searchPlaceholder="Buscar estado..." placeholder="Estado" onChange={(value) => { setState(value); resetPage(); }} />
        <SearchInput value={search} onChange={(value) => { setSearch(value); resetPage(); }} placeholder="Buscar empresa ou contato" />
      </FiltersBar>

      <TableCard
        title="Base de leads"
        footerText={loading ? 'Carregando...' : `${refreshing ? 'Atualizando · ' : ''}Mostrando ${rows.length} de ${total} lead(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); }} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando leads...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead encontrado.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable
            columns={columns}
            rows={rows}
            selectable={false}
            actions={['view', 'edit', 'invalidate', 'return']}
            getRowActions={getRowActions}
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={insertOpen}
        title="Inserir lead"
        description="Cadastro manual. Estado e cidade usam os catálogos canônicos do CRM e o lead entra como Importado."
        onClose={() => { if (!saving) { setInsertOpen(false); setManual(EMPTY_MANUAL); setCityOptions([]); } }}
        footer={<><Button variant="secondary" disabled={saving} onClick={() => { setInsertOpen(false); setManual(EMPTY_MANUAL); setCityOptions([]); }}>Cancelar</Button><Button loading={saving} onClick={() => void addManualLead()}>Inserir lead</Button></>}
      >
        <div className="drawer-form">
          <Field label="Empresa" value={manual.company} onChange={(company) => setManual((current) => ({ ...current, company }))} />
          <Field label="Nome alternativo (opcional)" value={manual.alternativeName} maxLength={160} placeholder="Nome curto usado nos envios" onChange={(alternativeName) => setManual((current) => ({ ...current, alternativeName }))} />
          <label className="drawer-field"><span>Ramo</span><SelectField value={manual.branchId} searchable searchPlaceholder="Buscar ramo..." options={editBranchOptions} placeholder="Selecione o ramo" onChange={(value) => setManual((current) => ({ ...current, branchId: value }))} /></label>
          <label className="drawer-field"><span>Estado</span><SelectField value={manual.state} searchable searchPlaceholder="Buscar estado..." options={BRAZIL_STATE_OPTIONS} placeholder="Selecione o estado" onChange={(value) => setManual((current) => ({ ...current, state: value, city: '' }))} /></label>
          <label className="drawer-field"><span>Cidade</span><SelectField value={manual.city} searchable searchPlaceholder="Buscar cidade..." options={cityOptions} placeholder={!manual.state ? 'Selecione o estado primeiro' : citiesLoading ? 'Carregando cidades...' : 'Selecione a cidade'} disabled={!manual.state || citiesLoading} onChange={(value) => setManual((current) => ({ ...current, city: value }))} /></label>
          <Field label="WhatsApp" value={manual.whatsapp} placeholder="5511999999999" onChange={(whatsapp) => setManual((current) => ({ ...current, whatsapp }))} />
          <Field label="Instagram" value={manual.instagram} placeholder="@empresa" onChange={(instagram) => setManual((current) => ({ ...current, instagram }))} />
          <Field label="Site" value={manual.website} placeholder="https://empresa.com.br" onChange={(website) => setManual((current) => ({ ...current, website }))} />
          <Field label="Google Maps" value={manual.mapsUrl} placeholder="https://maps.google.com/..." onChange={(mapsUrl) => setManual((current) => ({ ...current, mapsUrl }))} />
        </div>
      </Drawer>

      <Drawer
        open={editingLead !== null}
        title="Editar lead"
        description={editingLead?.statusId === LEAD_STATUS.NO_CONTACT
          ? 'Ao salvar um contato válido, este lead sai de Sem contato e volta automaticamente para Importado.'
          : editingLead?.statusId === LEAD_STATUS.INVALID
            ? 'Editar não reativa um lead inválido. Depois de corrigir os dados, use Retornar para Importado.'
            : 'Atualize os dados canônicos do lead. Itens em revisão/fila continuam sendo controlados em Fila de Disparo.'}
        onClose={closeEdit}
        footer={<><Button variant="secondary" disabled={saving} onClick={closeEdit}>Cancelar</Button><Button loading={saving} disabled={!canEdit} onClick={() => void saveEdit()}>Salvar</Button></>}
      >
        {editingLead ? (
          <div className="drawer-form">
            <Field label="Empresa original" value={editForm.company} onChange={(value) => setEditForm((current) => ({ ...current, company: value }))} />
            <Field label="Nome alternativo (opcional)" value={editForm.alternativeName} maxLength={160} placeholder="Nome curto usado nos envios" onChange={(value) => setEditForm((current) => ({ ...current, alternativeName: value }))} />
            <label className="drawer-field"><span>Ramo</span><SelectField value={editForm.branchId} options={editBranchOptions} searchable searchPlaceholder="Buscar ramo..." placeholder="Selecione o ramo" onChange={(value) => setEditForm((current) => ({ ...current, branchId: value }))} /></label>
            <Field label="Estado" value={editingLead.state || '—'} readOnly />
            <Field label="Cidade" value={editingLead.city || '—'} readOnly />
            <Field label="Telefone" value={editForm.rawPhone} onChange={(value) => setEditForm((current) => ({ ...current, rawPhone: value }))} />
            <Field label="WhatsApp" value={editForm.whatsapp} onChange={(value) => setEditForm((current) => ({ ...current, whatsapp: value }))} />
            <Field label="Instagram" value={editForm.instagram} onChange={(value) => setEditForm((current) => ({ ...current, instagram: value }))} />
            <Field label="Site" value={editForm.website} onChange={(value) => setEditForm((current) => ({ ...current, website: value }))} />
            <Field label="Google Maps" value={editForm.mapsUrl} onChange={(value) => setEditForm((current) => ({ ...current, mapsUrl: value }))} />
            <Field label="Status atual" value={statusLabel(editingLead.statusId)} readOnly />
          </div>
        ) : null}
      </Drawer>

      <Drawer open={viewingLead !== null} title="Detalhes do lead" description="Consulta do registro canônico da empresa." onClose={() => setViewingLead(null)} footer={<Button variant="secondary" onClick={() => setViewingLead(null)}>Fechar</Button>}>
        {viewingLead ? <div className="drawer-form drawer-form--readonly">
          <Field label="Empresa original" value={viewingLead.company} readOnly />
          <Field label="Nome alternativo" value={viewingLead.alternativeName || '—'} readOnly />
          <Field label="Ramo" value={viewingLead.branch || '—'} readOnly />
          <Field label="Estado" value={viewingLead.state || '—'} readOnly />
          <Field label="Cidade" value={viewingLead.city || '—'} readOnly />
          <Field label="Canal" value={viewingLead.channel} readOnly />
          <Field label="WhatsApp" value={viewingLead.phone || '—'} readOnly />
          {viewingLead.phone ? <a className="drawer-external-link" href={whatsappHref(viewingLead.phone)} target="_blank" rel="noreferrer">Abrir WhatsApp</a> : null}
          <Field label="Instagram" value={viewingLead.instagram ? `@${viewingLead.instagram.replace(/^@/, '')}` : '—'} readOnly />
          {viewingLead.instagram ? <a className="drawer-external-link" href={instagramHref(viewingLead.instagram)} target="_blank" rel="noreferrer">Abrir Instagram</a> : null}
          <Field label="Site" value={viewingLead.website || '—'} readOnly />
          {viewingLead.website ? <a className="drawer-external-link" href={externalHttpHref(viewingLead.website)} target="_blank" rel="noreferrer">Abrir site</a> : null}
          <Field label="Google Maps" value={viewingLead.mapsUrl || '—'} readOnly />
          {viewingLead.mapsUrl ? <a className="drawer-external-link" href={mapsHref(viewingLead.mapsUrl)} target="_blank" rel="noreferrer">Abrir Google Maps</a> : null}
          <Field label="Status operacional" value={statusLabel(viewingLead.statusId)} readOnly />
          <Field label="Estágio comercial" value={viewingLead.commercialStage ? COMMERCIAL_STAGE_LABELS[viewingLead.commercialStage] : '—'} readOnly />
          <Field label="Último envio" value={formatDate(viewingLead.lastSentAt)} readOnly />
        </div> : null}
      </Drawer>

      <ConfirmDialog
        open={invalidatingLead !== null}
        title="Invalidar lead?"
        description="O lead será marcado como Inválido e ficará separado de Sem contato."
        confirmLabel="Invalidar"
        danger
        onClose={() => { if (!saving) setInvalidatingLead(null); }}
        onConfirm={() => void confirmInvalidate()}
      >
        {invalidatingLead ? <strong>{invalidatingLead.company}</strong> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={returningLead !== null}
        title="Retornar para Importado?"
        description="O lead voltará para a operação. O canal será recalculado com base nos contatos atuais."
        confirmLabel="Retornar"
        onClose={() => { if (!saving) setReturningLead(null); }}
        onConfirm={() => void confirmReturn()}
      >
        {returningLead ? <strong>{returningLead.company}</strong> : null}
      </ConfirmDialog>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
