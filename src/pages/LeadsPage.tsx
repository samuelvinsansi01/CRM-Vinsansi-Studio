import { Plus, RefreshCcw, Users, List, Send, X, ClipboardCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { useCrmLeads } from '../hooks/useCrmLeads';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { configService } from '../services/config/config.service';
import type { BranchConfigRecord } from '../services/config/types';
import { BRAZIL_STATE_OPTIONS } from '../services/geo/brazilState';
import { importService } from '../services/import/import.service';
import type { ImportLeadDestination } from '../services/import/types';
import { normalizeInstagramUsername } from '../services/instagram/instagram.utils';
import { COMMERCIAL_STAGE_LABELS, type CommercialStage, type CrmLead } from '../services/leads/crmLead.types';
import { statusLabel, statusTone } from '../services/status/status.mapper';
import { externalHttpHref, instagramHref, mapsHref, whatsappHref } from '../utils/externalLinks';

type Row = Record<string, ReactNode> & { id: string };
type ManualLeadForm = {
  company: string;
  branchId: string;
  state: string;
  city: string;
  whatsapp: string;
  instagram: string;
  website: string;
  mapsUrl: string;
};

const EMPTY_MANUAL: ManualLeadForm = { company: '', branchId: '', state: '', city: '', whatsapp: '', instagram: '', website: '', mapsUrl: '' };
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
  if (lead.statusId !== 5 || !lead.commercialStage) return '—';
  const tone = lead.commercialStage === 'fechado' ? 'success' : lead.commercialStage === 'recusado' ? 'danger' : lead.commercialStage === 'aguardando_design' ? 'warning' : lead.commercialStage === 'design_enviado' ? 'primary' : 'neutral';
  return <Tag tone={tone}>{COMMERCIAL_STAGE_LABELS[lead.commercialStage]}</Tag>;
}

function operationalTag(lead: CrmLead) {
  return <Tag tone={statusTone(lead.statusId)}>{statusLabel(lead.statusId)}</Tag>;
}

export function LeadsPage() {
  const { hasPermission } = useOrganizationContext();
  const canCreate = hasPermission('leads.create');
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
  const [insertOpen, setInsertOpen] = useState(false);
  const [manual, setManual] = useState<ManualLeadForm>(EMPTY_MANUAL);
  const [branches, setBranches] = useState<BranchConfigRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    window.sessionStorage.removeItem('crm:leads:status-id');
    void configService.list('branches').then((records) => {
      setBranches(records.filter((record): record is BranchConfigRecord => record.kind === 'branches' && record.active));
    }).catch(() => setBranches([]));
  }, []);

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

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [{ id, ...toast }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3600);
  };

  const resetPage = () => setPage(1);
  const branchOptions = useMemo(() => [
    { label: 'Todos', value: '' },
    ...branches.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((branch) => ({ label: branch.name, value: branch.id })),
  ], [branches]);
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
    company: lead.company,
    branch: lead.branch || '—',
    state: lead.state || '—',
    city: lead.city || '—',
    channel: <Tag tone={lead.channel === 'WhatsApp' ? 'success' : lead.channel === 'Instagram' ? 'primary' : 'neutral'}>{lead.channel}</Tag>,
    instagram: lead.instagram ? contactLink(`@${lead.instagram.replace(/^@/, '')}`, instagramHref(lead.instagram)) : '—',
    whatsapp: lead.phone ? contactLink(lead.phone, whatsappHref(lead.phone) ?? '') : '—',
    status: operationalTag(lead),
    commercial: stageTag(lead),
  })), [items]);

  const handleAction = (action: TableAction, row: Row) => {
    if (action !== 'view') return;
    const lead = items.find((item) => item.id === row.id);
    if (lead) setViewingLead(lead);
  };

  const addManualLead = async () => {
    if (!canCreate || saving) return;
    const company = manual.company.trim();
    const branch = branches.find((item) => item.id === manual.branchId) ?? null;
    const whatsapp = manual.whatsapp.trim();
    const instagram = normalizeInstagramUsername(manual.instagram);
    if (!company) return pushToast({ title: 'Nome obrigatório', description: 'Informe o nome da empresa.', tone: 'danger' });
    if (!branch) return pushToast({ title: 'Ramo obrigatório', description: 'Selecione um ramo ativo.', tone: 'danger' });
    if (!whatsapp && !instagram) return pushToast({ title: 'Contato obrigatório', description: 'Informe pelo menos WhatsApp ou Instagram.', tone: 'danger' });
    if (manual.instagram.trim() && !instagram) return pushToast({ title: 'Instagram inválido', description: 'Informe um @, username ou URL de perfil válido.', tone: 'danger' });

    const destination: ImportLeadDestination = whatsapp && instagram ? 'Sem destino' : instagram ? 'Instagram' : 'WhatsApp';
    setSaving(true);
    try {
      const result = await importService.createFromImport({
        empresa: company,
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
        cidade: manual.city.trim(),
        estado: manual.state,
        normalizedMapsUrl: manual.mapsUrl.trim(),
        motivo: '',
      });
      if (result.simulation) {
        pushToast({ title: 'Simulação ativa', description: 'O cadastro manual está bloqueado enquanto a simulação de importação estiver ativa.', tone: 'warning' });
        return;
      }
      setManual(EMPTY_MANUAL);
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
        description="Base consolidada das empresas do CRM, independentemente do estágio operacional."
        action={(
          <div className="page-header-actions">
            <Button variant="secondary" iconLeft={RefreshCcw} loading={refreshing} disabled={loading} onClick={() => void refresh()}>Atualizar</Button>
            {canCreate ? <Button iconLeft={Plus} onClick={() => setInsertOpen(true)}>Inserir lead</Button> : null}
          </div>
        )}
      />

      <section className="metric-grid metric-grid--5">
        <MetricCard icon={Users} value={String(summary.total)} label="Total" onClick={() => { setStatusId(''); resetPage(); }} />
        <MetricCard icon={ClipboardCheck} value={String(summary.imported)} label="Importados" onClick={() => { setStatusId('1'); resetPage(); }} />
        <MetricCard icon={List} value={String(summary.queued)} label="Em fila" tone="primary" onClick={() => { setStatusId('4'); resetPage(); }} />
        <MetricCard icon={Send} value={String(summary.sent)} label="Enviados" tone="success" onClick={() => { setStatusId('5'); resetPage(); }} />
        <MetricCard icon={X} value={String(summary.invalid + summary.duplicates + summary.noContact)} label="Inválidos / sem contato" tone="danger" />
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
        {!error && !loading && rows.length ? <DataTable columns={columns} rows={rows} selectable={false} actions={['view']} onAction={handleAction} /> : null}
      </TableCard>

      <Drawer
        open={insertOpen}
        title="Inserir lead"
        description="Cadastro manual. O lead entra como Importado e segue as mesmas regras canônicas da base."
        onClose={() => { if (!saving) { setInsertOpen(false); setManual(EMPTY_MANUAL); } }}
        footer={<><Button variant="secondary" disabled={saving} onClick={() => { setInsertOpen(false); setManual(EMPTY_MANUAL); }}>Cancelar</Button><Button loading={saving} onClick={() => void addManualLead()}>Inserir lead</Button></>}
      >
        <div className="drawer-form">
          <Field label="Empresa" value={manual.company} onChange={(company) => setManual((current) => ({ ...current, company }))} />
          <label className="drawer-field"><span>Ramo</span><SelectField value={manual.branchId} searchable searchPlaceholder="Buscar ramo..." options={branchOptions.filter((item) => item.value)} placeholder="Selecione o ramo" onChange={(value) => setManual((current) => ({ ...current, branchId: value }))} /></label>
          <label className="drawer-field"><span>Estado</span><SelectField value={manual.state} searchable searchPlaceholder="Buscar estado..." options={BRAZIL_STATE_OPTIONS} placeholder="Selecione o estado" onChange={(value) => setManual((current) => ({ ...current, state: value }))} /></label>
          <Field label="Cidade" value={manual.city} onChange={(city) => setManual((current) => ({ ...current, city }))} />
          <Field label="WhatsApp" value={manual.whatsapp} placeholder="5511999999999" onChange={(whatsapp) => setManual((current) => ({ ...current, whatsapp }))} />
          <Field label="Instagram" value={manual.instagram} placeholder="@empresa" onChange={(instagram) => setManual((current) => ({ ...current, instagram }))} />
          <Field label="Site" value={manual.website} placeholder="https://empresa.com.br" onChange={(website) => setManual((current) => ({ ...current, website }))} />
          <Field label="Google Maps" value={manual.mapsUrl} placeholder="https://maps.google.com/..." onChange={(mapsUrl) => setManual((current) => ({ ...current, mapsUrl }))} />
        </div>
      </Drawer>

      <Drawer open={viewingLead !== null} title="Detalhes do lead" description="Consulta do registro canônico da empresa." onClose={() => setViewingLead(null)} footer={<Button variant="secondary" onClick={() => setViewingLead(null)}>Fechar</Button>}>
        {viewingLead ? <div className="drawer-form drawer-form--readonly">
          <Field label="Empresa" value={viewingLead.company} readOnly />
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

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
