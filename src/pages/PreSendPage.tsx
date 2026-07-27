import { Archive, Check, PhoneCall, RefreshCcw, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  MetricCard,
  TableCard,
  Tag,
  ToastViewport,
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useLeadCycle } from '../hooks/useLeadCycle';

type Row = Record<string, ReactNode> & { id: string };
const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Nome da empresa', width: '30%' },
  { key: 'branch', label: 'Ramo', width: '20%' },
  { key: 'state', label: 'Estado', width: '12%' },
  { key: 'city', label: 'Cidade', width: '14%' },
  { key: 'phone', label: 'WhatsApp', width: '14%' },
  { key: 'status', label: 'Status', width: '10%' },
];

export function PreSendPage() {
  const { records, loading, saving, error, refresh, update } = useLeadCycle('pre-send');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const rows = useMemo<Row[]>(() => records.map((lead) => ({
    id: lead.id,
    company: lead.company,
    branch: lead.branch || '-',
    state: lead.state || '-',
    city: lead.city || '-',
    phone: lead.phone || '-',
    status: <Tag tone="warning">Pré-Envio</Tag>,
  })), [records]);
  const selectedIds = selectedRows.map((index) => rows[index]?.id).filter(Boolean);

  const toast = (title: string, description: string, tone: ToastItem['tone'] = 'success') => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, title, description, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const updateStatuses = async (ids: string[], statusId: 2 | 6 | 8, title: string) => {
    try {
      await update(ids, { lead_status_id: statusId }, [3]);
      setSelectedRows([]);
      toast(title, `${ids.length} lead(s) atualizado(s).`, statusId === 2 ? 'success' : 'warning');
    } catch (err) {
      toast('Não foi possível concluir', err instanceof Error ? err.message : 'Tente novamente.', 'danger');
    }
  };

  const handleAction = async (action: TableAction, row: Row) => {
    if (action === 'approve') await updateStatuses([row.id], 2, 'Lead validado');
    if (action === 'invalidate') await updateStatuses([row.id], 6, 'Lead invalidado');
    if (action === 'archive') await updateStatuses([row.id], 8, 'Lead arquivado');
  };

  return (
    <div className="dashboard-table-page lead-list-page">
      <PageHeader
        title="Pré-Envio"
        description="Validação exclusiva de WhatsApp: status pré-envio e canal WhatsApp."
        action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || saving} onClick={() => void refresh()}>Atualizar</Button>}
      />
      <section className="metric-grid metric-grid--1">
        <MetricCard icon={PhoneCall} value={String(records.length)} label="WhatsApp para validar" tone="success" />
      </section>
      <TableCard title="Leads aguardando validação" footerText={loading ? 'Carregando...' : `${rows.length} lead(s).`}>
        {selectedIds.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedIds.length} selecionado(s)</span>
            <Button size="sm" iconLeft={Check} disabled={saving} onClick={() => void updateStatuses(selectedIds, 2, 'Leads validados')}>Validar</Button>
            <Button size="sm" variant="secondary" iconLeft={X} disabled={saving} onClick={() => void updateStatuses(selectedIds, 6, 'Leads invalidados')}>Invalidar</Button>
            <Button size="sm" variant="secondary" iconLeft={Archive} disabled={saving} onClick={() => void updateStatuses(selectedIds, 8, 'Leads arquivados')}>Arquivar</Button>
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando Pré-Envio...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum WhatsApp aguardando validação.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable columns={columns} rows={rows} actions={['approve', 'invalidate', 'archive']} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onAction={handleAction} />
        ) : null}
      </TableCard>
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
