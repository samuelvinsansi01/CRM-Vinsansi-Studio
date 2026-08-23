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
  ToastViewport,
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { useBaseRecords } from '../hooks/useBaseRecords';
import { useClientPagination } from '../hooks/useClientPagination';
import type { BaseLead } from '../services/base/types';

const STATUS_LABEL = { 5: 'Enviado', 6: 'Inválido', 7: 'Duplicado', 8: 'Arquivado' } as const;

type Row = Record<string, ReactNode> & { id: string };
const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Nome da empresa', width: '24%' },
  { key: 'branch', label: 'Ramo', width: '15%' },
  { key: 'state', label: 'Estado', width: '9%' },
  { key: 'city', label: 'Cidade', width: '12%' },
  { key: 'channel', label: 'Canal final', width: '10%' },
  { key: 'contact', label: 'Contato', width: '14%' },
  { key: 'history', label: 'Histórico', width: '10%' },
  { key: 'outcome', label: 'Resultado', width: '12%' },
  { key: 'status', label: 'Status final', width: '12%' },
];

function statusTag(lead: BaseLead) {
  const tone = lead.statusId === 5 ? 'success' : lead.statusId === 8 ? 'neutral' : 'danger';
  return <Tag tone={tone}>{STATUS_LABEL[lead.statusId]}</Tag>;
}

export function BasePage() {
  const { hasPermission } = useOrganizationContext();
  const canArchive = hasPermission('leads.delete');
  const canEdit = hasPermission('leads.edit');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [channel, setChannel] = useState('Todos');
  const [outcome, setOutcome] = useState('Todos');
  const filters = useMemo(() => ({
    search,
    status: status === 'Todos' ? 'Todos' : ({ Enviado: 'enviado', Inválido: 'invalido', Duplicado: 'duplicado', Arquivado: 'arquivado' } as Record<string, string>)[status],
    origin: channel, outcome,
  }), [search, status, channel, outcome]);
  const { records, summary, options, loading, saving, error, refresh, archiveMany, updateMetadata } = useBaseRecords(filters);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const rows = useMemo<Row[]>(() => records.map((lead) => ({
    id: lead.id,
    company: lead.company,
    branch: lead.branch || '-',
    state: lead.state || '-',
    city: lead.city || '-',
    channel: <Tag tone={lead.origin === 'Instagram' ? 'primary' : 'success'}>{lead.origin}</Tag>,
    contact: lead.origin === 'Instagram' ? (lead.instagram || '-') : (lead.phone || '-'),
    history: <span>{lead.totalLeads ?? 1} lead(s) · {lead.totalDispatches ?? 0} envio(s){lead.suppressed ? ' · suprimido' : ''}</span>,
    outcome: canEdit ? <div className="base-outcome-editor"><select className="base-outcome-select" value={lead.commercialOutcome || ''} disabled={saving} onChange={(event) => void updateMetadata(lead.id,event.target.value,lead.operatorNotes || '')}><option value="">Sem resultado</option><option value="no_response">Sem resposta</option><option value="responded">Respondeu</option><option value="interested">Interessado</option><option value="not_interested">Não interessado</option><option value="client">Cliente</option><option value="wrong_contact">Contato incorreto</option><option value="closed_business">Empresa fechada</option><option value="do_not_contact">Não contatar</option></select><button type="button" className="base-notes-button" title={lead.operatorNotes || 'Adicionar observação'} onClick={() => { const notes=window.prompt('Observações comerciais desta empresa:',lead.operatorNotes || ''); if(notes!==null) void updateMetadata(lead.id,lead.commercialOutcome || '',notes); }}>Notas</button></div> : <span>{lead.commercialOutcome || 'Sem resultado'}{lead.operatorNotes ? ` · ${lead.operatorNotes}` : ''}</span>,
    status: statusTag(lead),
  })), [canEdit, records, saving, updateMetadata]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);
  const selectedIds = selectedRows.map((index) => pageItems[index]?.id).filter(Boolean);
  const toast = (title: string, description: string, tone: ToastItem['tone'] = 'success') => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, title, description, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3600);
  };

  const archive = async (ids: string[]) => {
    if (!canArchive) return;
    try {
      const result = await archiveMany(ids);
      setSelectedRows([]);
      const detail = [
        result.succeeded ? `${result.succeeded} arquivado(s)` : '',
        result.unchanged ? `${result.unchanged} já arquivado(s)` : '',
        result.failed ? `${result.failed} falha(s)` : '',
      ].filter(Boolean).join(', ');
      toast(
        result.failed ? 'Arquivamento concluído com ressalvas' : 'Base Permanente atualizada',
        detail || 'Nenhuma alteração necessária.',
        result.failed ? 'warning' : 'success',
      );
    } catch (err) {
      toast('Não foi possível arquivar', err instanceof Error ? err.message : 'Tente novamente.', 'danger');
    }
  };

  const handleAction = async (action: TableAction, row: Row) => {
    if (action === 'archive') await archive([row.id]);
  };

  return (
    <div className="dashboard-table-page lead-list-page">
      <PageHeader
        title="Base Permanente"
        description="Memória consolidada por identidade canônica, com histórico de contatos, supressão e prova de envio."
        action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || saving} onClick={refresh}>Atualizar</Button>}
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
        <SelectField value={status} options={['Todos', 'Enviado', 'Inválido', 'Duplicado', 'Arquivado']} placeholder="Status final" onChange={(value) => { setStatus(value); resetPage(); setSelectedRows([]); }} />
        <SelectField value={channel} options={['Todos', 'WhatsApp', 'Instagram']} placeholder="Canal final" onChange={(value) => { setChannel(value); resetPage(); setSelectedRows([]); }} />
        <SelectField value={outcome} options={options.outcomes} placeholder="Resultado comercial" onChange={(value) => { setOutcome(value); resetPage(); setSelectedRows([]); }} />
        <SearchInput value={search} onChange={(value) => { setSearch(value); resetPage(); setSelectedRows([]); }} placeholder="Buscar empresa ou contato" />
      </FiltersBar>

      <TableCard
        title="Empresas consolidadas"
        footerText={loading ? 'Carregando...' : `Mostrando ${pageItems.length} de ${rows.length} empresa(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setSelectedRows([]); }} />}
        page={page}
        totalPages={totalPages}
        onPageChange={(nextPage) => { setPage(nextPage); setSelectedRows([]); }}
      >
        {canArchive && selectedIds.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedIds.length} selecionado(s)</span>
            <Button size="sm" variant="secondary" iconLeft={Archive} disabled={saving} onClick={() => void archive(selectedIds)}>Arquivar</Button>
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando Base Permanente...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead finalizado.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable columns={columns} rows={pageItems} actions={canArchive ? ['archive'] : []} selectable={canArchive} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onAction={canArchive ? handleAction : undefined} />
        ) : null}
      </TableCard>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
