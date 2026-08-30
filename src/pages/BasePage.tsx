import { Instagram, MessageCircle, RefreshCcw, Send, Unplug, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { BaseLead } from '../services/base/types';

const STATUS_LABEL = { 3: 'Sem contato', 5: 'Enviado', 6: 'Inválido', 7: 'Duplicado' } as const;

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
  const tone = lead.statusId === 5 ? 'success' : lead.statusId === 3 ? 'neutral' : 'danger';
  return <Tag tone={tone}>{STATUS_LABEL[lead.statusId]}</Tag>;
}

function channelTag(lead: BaseLead) {
  const tone = lead.origin === 'Instagram' ? 'primary' : lead.origin === 'WhatsApp' ? 'success' : 'neutral';
  return <Tag tone={tone}>{lead.origin}</Tag>;
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
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState('Todos');
  const [channel, setChannel] = useState('Todos');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [viewingLead, setViewingLead] = useState<BaseLead | null>(null);
  const filters = useMemo(() => ({
    search: debouncedSearch,
    status: status === 'Todos' ? 'Todos' : ({ 'Sem contato': 'sem_contato', Enviado: 'enviado', Inválido: 'invalido', Duplicado: 'duplicado' } as Record<string, string>)[status],
    origin: channel,
  }), [debouncedSearch, status, channel]);
  const { records, total, summary, loading, refreshing, error, refresh } = useBaseRecords(filters, { page, pageSize: rowsPerPage });

  const rows = useMemo<Row[]>(() => records.map((lead) => ({
    id: lead.id,
    company: lead.company,
    branch: lead.branch || '—',
    state: lead.state || '—',
    city: lead.city || '—',
    channel: channelTag(lead),
    instagram: instagramContact(lead),
    whatsapp: whatsappContact(lead),
    sentAt: lead.statusId === 5 ? formatDateTime(lead.lastSentAt) : '—',
    status: statusTag(lead),
  })), [records]);

  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const resetPage = () => setPage(1);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const handleAction = (action: TableAction, row: Row) => {
    if (action !== 'view') return;
    const lead = records.find((item) => item.id === row.id);
    if (lead) setViewingLead(lead);
  };

  return (
    <div className="dashboard-table-page lead-list-page">
      <PageHeader
        title="Base Permanente"
        description="Visão dos próprios leads que já encerraram o fluxo: enviados, inválidos, duplicados ou sem contato."
        action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading} onClick={refresh}>Atualizar</Button>}
      />

      <section className="metric-grid metric-grid--6">
        <MetricCard icon={Users} value={String(summary.total)} label="Total final" />
        <MetricCard icon={Send} value={String(summary.sent)} label="Enviados" tone="success" />
        <MetricCard icon={MessageCircle} value={String(summary.sentWhatsApp)} label="WhatsApp enviados" tone="success" />
        <MetricCard icon={Instagram} value={String(summary.sentInstagram)} label="Instagram enviados" tone="primary" />
        <MetricCard icon={X} value={String(summary.invalid + summary.duplicates)} label="Inválidos e duplicados" tone="danger" />
        <MetricCard icon={Unplug} value={String(summary.noContact)} label="Sem contato" />
      </section>

      <FiltersBar>
        <SelectField value={status} options={['Todos', 'Enviado', 'Inválido', 'Duplicado', 'Sem contato']} placeholder="Status" onChange={(value) => { setStatus(value); resetPage(); }} />
        <SelectField value={channel} options={['Todos', 'WhatsApp', 'Instagram', 'Sem canal']} placeholder="Canal de envio" onChange={(value) => { setChannel(value); resetPage(); }} />
        <SearchInput value={search} onChange={(value) => { setSearch(value); resetPage(); }} placeholder="Buscar empresa ou contato" />
      </FiltersBar>

      <TableCard
        title="Empresas finalizadas"
        footerText={loading ? 'Carregando...' : `${refreshing ? 'Atualizando · ' : ''}Mostrando ${rows.length} de ${total} empresa(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); }} />}
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
            rows={rows}
            selectable={false}
            actions={['view']}
           
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={viewingLead !== null}
        title="Lead finalizado"
        description="Consulta somente leitura do lead na própria tabela principal."
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
            <Field label="Data de envio" value={viewingLead.statusId === 5 ? formatDateTime(viewingLead.lastSentAt) : '—'} readOnly />
            <Field label="Status" value={STATUS_LABEL[viewingLead.statusId]} readOnly />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
