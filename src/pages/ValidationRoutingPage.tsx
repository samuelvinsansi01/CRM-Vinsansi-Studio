import { Globe2, Instagram, MessageCircle, RefreshCcw, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  FiltersBar,
  MetricCard,
  SearchInput,
  SelectField,
  RowsPerPageControl,
  TableCard,
  Tag,
  type TableColumn,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useClientPagination } from '../hooks/useClientPagination';
import { useLeadCycle } from '../hooks/useLeadCycle';
import type { LeadCycleLead } from '../services/lead-cycle/types';

const SOURCE_NO_SITE = 1;
const SOURCE_OWN_SITE = 2;
const SOURCE_AGGREGATOR = 3;
const SOURCE_INSTAGRAM = 4;

type StatusFilter = 'Todos' | 'Importado' | 'Validado';
type SourceFilter = 'Todos' | 'Sem site' | 'Domínio próprio' | 'Agregador' | 'Instagram';
type Row = Record<string, ReactNode> & { id: string };

type SourceDefinition = {
  id: number;
  label: Exclude<SourceFilter, 'Todos'>;
  icon?: typeof Users;
};

const sourceDefinitions: SourceDefinition[] = [
  { id: SOURCE_NO_SITE, label: 'Sem site', icon: MessageCircle },
  { id: SOURCE_OWN_SITE, label: 'Domínio próprio', icon: Globe2 },
  { id: SOURCE_AGGREGATOR, label: 'Agregador' },
  { id: SOURCE_INSTAGRAM, label: 'Instagram', icon: Instagram },
];

const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Empresa', width: '21%' },
  { key: 'source', label: 'Origem', width: '14%' },
  { key: 'status', label: 'Status', width: '11%' },
  { key: 'branch', label: 'Ramo', width: '14%' },
  { key: 'location', label: 'Localização', width: '14%' },
  { key: 'phone', label: 'WhatsApp', width: '9%' },
  { key: 'instagram', label: 'Instagram', width: '9%' },
  { key: 'channel', label: 'Destino', width: '10%' },
];

function sourceName(lead: LeadCycleLead): Exclude<SourceFilter, 'Todos'> {
  if (lead.contactSourceId === SOURCE_OWN_SITE) return 'Domínio próprio';
  if (lead.contactSourceId === SOURCE_AGGREGATOR) return 'Agregador';
  if (lead.contactSourceId === SOURCE_INSTAGRAM) return 'Instagram';
  return 'Sem site';
}

function statusTag(lead: LeadCycleLead) {
  const isValid = lead.statusId === 2;
  return <Tag tone={isValid ? 'success' : 'warning'}>{isValid ? 'Validado' : 'Importado'}</Tag>;
}

function channelTag(lead: LeadCycleLead) {
  return <Tag tone={lead.channelId === 2 ? 'primary' : 'success'}>{lead.channel}</Tag>;
}

function contactValue(value: string) {
  return value.trim() ? 'Sim' : 'Não';
}

export function ValidationRoutingPage() {
  const imported = useLeadCycle('imported');
  const valid = useLeadCycle('valid');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('Importado');
  const [source, setSource] = useState<SourceFilter>('Todos');
  const [branch, setBranch] = useState('Todos');
  const [state, setState] = useState('Todos');

  const allRecords = useMemo(() => [...imported.records, ...valid.records], [imported.records, valid.records]);
  const loading = imported.loading || valid.loading;
  const error = imported.error || valid.error;

  const refresh = async () => {
    await Promise.all([imported.refresh(), valid.refresh()]);
  };

  const branches = useMemo(
    () => ['Todos', ...Array.from(new Set(allRecords.map((lead) => lead.branch).filter(Boolean))).sort()],
    [allRecords],
  );
  const states = useMemo(
    () => ['Todos', ...Array.from(new Set(allRecords.map((lead) => lead.state).filter(Boolean))).sort()],
    [allRecords],
  );

  const sourceMetrics = useMemo(() => sourceDefinitions.map((definition) => {
    const sourceRecords = allRecords.filter((lead) => lead.contactSourceId === definition.id);
    const validCount = sourceRecords.filter((lead) => lead.statusId === 2).length;
    return { ...definition, total: sourceRecords.length, valid: validCount };
  }), [allRecords]);

  const totalValid = valid.records.length;
  const totalRecords = allRecords.length;

  const visible = useMemo(() => allRecords.filter((lead) => {
    const query = search.trim().toLowerCase();
    const matchesStatus = status === 'Todos'
      || (status === 'Importado' && lead.statusId === 1)
      || (status === 'Validado' && lead.statusId === 2);
    const matchesSource = source === 'Todos' || sourceName(lead) === source;
    const matchesSearch = !query
      || lead.company.toLowerCase().includes(query)
      || lead.phone.toLowerCase().includes(query)
      || lead.instagram.toLowerCase().includes(query);

    return matchesStatus
      && matchesSource
      && matchesSearch
      && (branch === 'Todos' || lead.branch === branch)
      && (state === 'Todos' || lead.state === state);
  }), [allRecords, branch, search, source, state, status]);

  const rows = useMemo<Row[]>(() => visible.map((lead) => ({
    id: lead.id,
    company: lead.company,
    source: sourceName(lead),
    status: statusTag(lead),
    branch: lead.branch || '-',
    location: [lead.city, lead.state].filter(Boolean).join(' / ') || '-',
    phone: contactValue(lead.phone),
    instagram: contactValue(lead.instagram),
    channel: channelTag(lead),
  })), [visible]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);

  return (
    <div className="dashboard-table-page lead-list-page validation-routing-page">
      <PageHeader
        title="Validação e roteamento"
        description="Consulte leads importados e validados. A validação por capacidade do chip será adicionada nesta tela na próxima etapa."
        action={(
          <Button variant="secondary" iconLeft={RefreshCcw} disabled={loading} onClick={() => void refresh()}>
            Atualizar
          </Button>
        )}
      />

      <section className="metric-grid metric-grid--5">
        <MetricCard icon={Users} value={`${totalValid} / ${totalRecords}`} label="Válidos / Total" tone="neutral" />
        {sourceMetrics.map((metric) => (
          <MetricCard
            icon={metric.icon}
            key={metric.id}
            value={`${metric.valid} / ${metric.total}`}
            label={`Válidos / Total — ${metric.label}`}
            tone={metric.id === SOURCE_INSTAGRAM ? 'primary' : metric.id === SOURCE_NO_SITE ? 'success' : 'neutral'}
          />
        ))}
      </section>

      <FiltersBar>
        <SelectField value={status} options={['Todos', 'Importado', 'Validado']} placeholder="Status" onChange={(value) => { setStatus(value as StatusFilter); resetPage(); }} />
        <SelectField value={source} options={['Todos', 'Sem site', 'Domínio próprio', 'Agregador', 'Instagram']} placeholder="Origem" onChange={(value) => { setSource(value as SourceFilter); resetPage(); }} />
        <SelectField value={branch} options={branches} placeholder="Ramo" onChange={(value) => { setBranch(value); resetPage(); }} />
        <SelectField value={state} options={states} placeholder="Estado" onChange={(value) => { setState(value); resetPage(); }} />
        <SearchInput value={search} placeholder="Buscar empresa ou contato" onChange={(value) => { setSearch(value); resetPage(); }} />
      </FiltersBar>

      <TableCard
        title="Leads disponíveis"
        footerText={`Mostrando ${pageItems.length} de ${rows.length} lead(s)`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando leads...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead encontrado para os filtros selecionados.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable columns={columns} rows={pageItems} actions={[]} selectable={false} />
        ) : null}
      </TableCard>
    </div>
  );
}
