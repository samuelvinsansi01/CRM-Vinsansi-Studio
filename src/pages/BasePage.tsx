import { Archive, Instagram, MessageCircle, RefreshCcw, Send, Users, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  Drawer,
  Field,
  FiltersBar,
  MetricCard,
  SearchInput,
  SelectField,
  RowsPerPageControl,
  TableCard,
  Tag,
  type TableAction,
  type TableColumn,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useBaseRecords } from '../hooks/useBaseRecords';
import { useClientPagination } from '../hooks/useClientPagination';
import type { BaseLead } from '../services/base/types';

const STATUS_LABEL = { 5: 'Enviado', 6: 'Inválido', 7: 'Duplicado', 8: 'Arquivado' } as const;

type Row = Record<string, ReactNode> & { id: string };
const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Nome da empresa', width: '18%' },
  { key: 'branch', label: 'Ramo', width: '13%' },
  { key: 'state', label: 'Estado', width: '6%' },
  { key: 'city', label: 'Cidade', width: '10%' },
  { key: 'channel', label: 'Canal de envio', width: '10%' },
  { key: 'instagram', label: 'Instagram', width: '11%' },
  { key: 'whatsapp', label: 'WhatsApp', width: '12%' },
  { key: 'sentAt', label: 'Data de envio', width: '12%' },
  { key: 'status', label: 'Status', width: '8%' },
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

function instagramContact(lead: BaseLead) {
  if (lead.origin !== 'Instagram' || !lead.instagram) return '—';
  return `@${lead.instagram.replace(/^@/, '')}`;
}

function whatsappContact(lead: BaseLead) {
  if (lead.origin !== 'WhatsApp') return '—';
  return lead.phone || lead.normalizedPhone || '—';
}

export function BasePage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [channel, setChannel] = useState('Todos');
  const [viewingLead, setViewingLead] = useState<BaseLead | null>(null);
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
    instagram: instagramContact(lead),
    whatsapp: whatsappContact(lead),
    sentAt: formatDateTime(lead.lastSentAt),
    status: statusTag(lead),
  })), [records]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);

  const handleAction = (action: TableAction, row: Row) => {
    if (action !== 'view') return;
    const lead = records.find((item) => item.id === row.id);
    if (lead) setViewingLead(lead);
  };

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
        <SelectField value={status} options={['Todos', 'Enviado', 'Inválido', 'Duplicado', 'Arquivado']} placeholder="Status" onChange={(value) => { setStatus(value); resetPage(); }} />
        <SelectField value={channel} options={['Todos', 'WhatsApp', 'Instagram']} placeholder="Canal de envio" onChange={(value) => { setChannel(value); resetPage(); }} />
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
          <DataTable
            columns={columns}
            rows={pageItems}
            selectable={false}
            actions={['view']}
            actionsLabel="Ações"
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={viewingLead !== null}
        title="Registro da Base Permanente"
        description="Consulta somente leitura. Este registro bloqueia definitivamente uma nova prospecção da empresa."
        onClose={() => setViewingLead(null)}
        footer={<Button variant="secondary" onClick={() => setViewingLead(null)}>Fechar</Button>}
      >
        {viewingLead ? (
          <div className="drawer-form drawer-form--readonly">
            <Field label="Nome da empresa" value={viewingLead.company} readOnly />
            <Field label="Ramo" value={viewingLead.branch || '—'} readOnly />
            <Field label="Estado" value={viewingLead.state || '—'} readOnly />
            <Field label="Cidade" value={viewingLead.city || '—'} readOnly />
            <Field label="Canal de envio" value={viewingLead.origin} readOnly />
            <Field label="Instagram" value={instagramContact(viewingLead)} readOnly />
            <Field label="WhatsApp" value={whatsappContact(viewingLead)} readOnly />
            <Field label="Data de envio" value={formatDateTime(viewingLead.lastSentAt)} readOnly />
            <Field label="Status" value={STATUS_LABEL[viewingLead.statusId]} readOnly />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
