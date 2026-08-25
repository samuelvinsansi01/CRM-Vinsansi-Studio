import { Archive, Instagram, MessageCircle, RefreshCcw, Send, Users, X } from 'lucide-react';
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
import { useBaseRecords } from '../hooks/useBaseRecords';
import { useClientPagination } from '../hooks/useClientPagination';
import type { BaseLead } from '../services/base/types';

const STATUS_LABEL = { 5: 'Enviado', 6: 'Inválido', 7: 'Duplicado', 8: 'Arquivado' } as const;

type Row = Record<string, ReactNode> & { id: string };
const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Nome da empresa', width: '22%' },
  { key: 'branch', label: 'Ramo', width: '14%' },
  { key: 'state', label: 'Estado', width: '8%' },
  { key: 'city', label: 'Cidade', width: '12%' },
  { key: 'channel', label: 'Canal final', width: '10%' },
  { key: 'contact', label: 'Contato', width: '14%' },
  { key: 'history', label: 'Histórico', width: '10%' },
  { key: 'lastSent', label: 'Último envio', width: '12%' },
  { key: 'status', label: 'Status final', width: '10%' },
];

function statusTag(lead: BaseLead) {
  const tone = lead.statusId === 5 ? 'success' : lead.statusId === 8 ? 'neutral' : 'danger';
  return <Tag tone={tone}>{STATUS_LABEL[lead.statusId]}</Tag>;
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function BasePage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [channel, setChannel] = useState('Todos');
  const filters = useMemo(() => ({
    search,
    status: status === 'Todos' ? 'Todos' : ({ Enviado: 'enviado', Inválido: 'invalido', Duplicado: 'duplicado', Arquivado: 'arquivado' } as Record<string, string>)[status],
    origin: channel,
  }), [search, status, channel]);
  const { records, summary, loading, error, refresh } = useBaseRecords(filters);

  const rows = useMemo<Row[]>(() => records.map((lead) => ({
    id: lead.id,
    company: lead.company,
    branch: lead.branch || '—',
    state: lead.state || '—',
    city: lead.city || '—',
    channel: <Tag tone={lead.origin === 'Instagram' ? 'primary' : 'success'}>{lead.origin}</Tag>,
    contact: lead.origin === 'Instagram' ? (lead.instagram || '—') : (lead.phone || '—'),
    history: <span>{lead.totalLeads ?? 1} lead(s) · {lead.totalDispatches ?? 0} envio(s)</span>,
    lastSent: formatDateTime(lead.lastSentAt),
    status: statusTag(lead),
  })), [records]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);

  return (
    <div className="dashboard-table-page lead-list-page">
      <PageHeader
        title="Base Permanente"
        description="Destino final dos leads processados. Registros somente para consulta e bloqueio definitivo de nova prospecção."
        action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading} onClick={refresh}>Atualizar</Button>}
      />

      <section className="metric-grid metric-grid--6">
        <MetricCard icon={Users} value={String(summary.total)} label="Total final" />
        <MetricCard icon={Send} value={String(summary.sent)} label="Enviados" tone="success" />
        <MetricCard icon={MessageCircle} value={String(summary.sentWhatsApp)} label="WhatsApp enviados" tone="success" />
        <MetricCard icon={Instagram} value={String(summary.sentInstagram)} label="Instagram enviados" tone="primary" />
        <MetricCard icon={X} value={String(summary.invalid + summary.duplicates)} label="Inválidos e duplicados" tone="danger" />
        <MetricCard icon={Archive} value={String(summary.archived)} label="Arquivados" />
      </section>

      <FiltersBar>
        <SelectField value={status} options={['Todos', 'Enviado', 'Inválido', 'Duplicado', 'Arquivado']} placeholder="Status final" onChange={(value) => { setStatus(value); resetPage(); }} />
        <SelectField value={channel} options={['Todos', 'WhatsApp', 'Instagram']} placeholder="Canal final" onChange={(value) => { setChannel(value); resetPage(); }} />
        <SearchInput value={search} onChange={(value) => { setSearch(value); resetPage(); }} placeholder="Buscar empresa ou contato" />
      </FiltersBar>

      <TableCard
        title="Empresas finalizadas"
        footerText={loading ? 'Carregando...' : `Mostrando ${pageItems.length} de ${rows.length} empresa(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando Base Permanente...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead finalizado.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable columns={columns} rows={pageItems} selectable={false} />
        ) : null}
      </TableCard>
    </div>
  );
}
