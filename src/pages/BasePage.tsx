import { Archive, Instagram, MessageCircle, RefreshCcw, Send, Users, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  FiltersBar,
  MetricCard,
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
import { useLeadCycle } from '../hooks/useLeadCycle';
import type { LeadCycleLead } from '../services/lead-cycle/types';

const STATUS_LABEL: Record<number, string> = { 5: 'Enviado', 6: 'Inválido', 7: 'Duplicado', 8: 'Arquivado' };

type Row = Record<string, ReactNode> & { id: string };
const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Nome da empresa', width: '24%' },
  { key: 'branch', label: 'Ramo', width: '15%' },
  { key: 'state', label: 'Estado', width: '9%' },
  { key: 'city', label: 'Cidade', width: '12%' },
  { key: 'channel', label: 'Canal', width: '10%' },
  { key: 'source', label: 'Fonte', width: '14%' },
  { key: 'status', label: 'Status final', width: '12%' },
];

function statusTag(lead: LeadCycleLead) {
  const tone = lead.statusId === 5 ? 'success' : lead.statusId === 8 ? 'neutral' : 'danger';
  return <Tag tone={tone}>{STATUS_LABEL[lead.statusId] ?? lead.status}</Tag>;
}

export function BasePage() {
  const { records, loading, saving, error, refresh, update } = useLeadCycle('permanent');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [channel, setChannel] = useState('Todos');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const visible = useMemo(() => records.filter((lead) => {
    const query = search.trim().toLowerCase();
    return (!query || lead.company.toLowerCase().includes(query))
      && (status === 'Todos' || STATUS_LABEL[lead.statusId] === status)
      && (channel === 'Todos' || lead.channel === channel);
  }), [records, search, status, channel]);

  const rows = useMemo<Row[]>(() => visible.map((lead) => ({
    id: lead.id,
    company: lead.company,
    branch: lead.branch || '-',
    state: lead.state || '-',
    city: lead.city || '-',
    channel: <Tag tone={lead.channelId === 2 ? 'primary' : 'success'}>{lead.channel}</Tag>,
    source: lead.contactSource || '-',
    status: statusTag(lead),
  })), [visible]);

  const selectedIds = selectedRows.map((index) => rows[index]?.id).filter(Boolean);
  const toast = (title: string, description: string, tone: ToastItem['tone'] = 'success') => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, title, description, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const archive = async (ids: string[]) => {
    try {
      await update(ids, { lead_status_id: 8 }, [5, 6, 7, 8]);
      setSelectedRows([]);
      toast('Leads arquivados', `${ids.length} lead(s) atualizados.`);
    } catch (err) {
      toast('Não foi possível arquivar', err instanceof Error ? err.message : 'Tente novamente.', 'danger');
    }
  };

  const handleAction = async (action: TableAction, row: Row) => {
    if (action === 'archive') await archive([row.id]);
  };

  const sent = records.filter((lead) => lead.statusId === 5);
  const sentWhatsApp = sent.filter((lead) => lead.channelId === 1).length;
  const sentInstagram = sent.filter((lead) => lead.channelId === 2).length;
  const invalid = records.filter((lead) => lead.statusId === 6).length;
  const duplicates = records.filter((lead) => lead.statusId === 7).length;
  const archived = records.filter((lead) => lead.statusId === 8).length;

  return (
    <div className="dashboard-table-page lead-list-page">
      <PageHeader
        title="Base Permanente"
        description="Somente leads finalizados: enviados, inválidos, duplicados e arquivados."
        action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || saving} onClick={() => void refresh()}>Atualizar</Button>}
      />

      <section className="metric-grid metric-grid--6">
        <MetricCard icon={Users} value={String(records.length)} label="Total final" />
        <MetricCard icon={Send} value={String(sent.length)} label="Enviados" tone="success" />
        <MetricCard icon={MessageCircle} value={String(sentWhatsApp)} label="WhatsApp enviados" tone="success" />
        <MetricCard icon={Instagram} value={String(sentInstagram)} label="Instagram enviados" tone="primary" />
        <MetricCard icon={X} value={String(invalid + duplicates)} label="Inválidos e duplicados" tone="danger" />
        <MetricCard icon={Archive} value={String(archived)} label="Arquivados" />
      </section>

      <FiltersBar>
        <SelectField value={status} options={['Todos', 'Enviado', 'Inválido', 'Duplicado', 'Arquivado']} placeholder="Status final" onChange={setStatus} />
        <SelectField value={channel} options={['Todos', 'WhatsApp', 'Instagram']} placeholder="Canal" onChange={setChannel} />
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar empresa" />
      </FiltersBar>

      <TableCard title="Leads finalizados" footerText={loading ? 'Carregando...' : `${rows.length} lead(s).`}>
        {selectedIds.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedIds.length} selecionado(s)</span>
            <Button size="sm" variant="secondary" iconLeft={Archive} disabled={saving} onClick={() => void archive(selectedIds)}>Arquivar</Button>
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando Base Permanente...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead finalizado.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable columns={columns} rows={rows} actions={['archive']} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onAction={handleAction} />
        ) : null}
      </TableCard>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
