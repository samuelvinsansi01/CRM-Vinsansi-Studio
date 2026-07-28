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
import { QueuePreparationPanel } from '../components/QueuePreparationPanel';
import { useLeadCycle } from '../hooks/useLeadCycle';
import type { LeadRoutingCommand, LeadRoutingResult } from '../services/lead-cycle/types';
import type { WhatsAppValidationBatchResult } from '../services/whatsapp-validation/types';

type Row = Record<string, ReactNode> & { id: string };
const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Nome da empresa', width: '30%' },
  { key: 'branch', label: 'Ramo', width: '20%' },
  { key: 'state', label: 'Estado', width: '12%' },
  { key: 'city', label: 'Cidade', width: '14%' },
  { key: 'phone', label: 'WhatsApp', width: '14%' },
  { key: 'status', label: 'Status', width: '10%' },
];

function validationDescription(result: WhatsAppValidationBatchResult) {
  const parts: string[] = [];
  if (result.approved) parts.push(`${result.approved} aprovado(s)`);
  if (result.redirectedToInstagram) parts.push(`${result.redirectedToInstagram} redirecionado(s) ao Instagram`);
  if (result.invalidated) parts.push(`${result.invalidated} invalidado(s) sem fallback`);
  if (result.errors) parts.push(`${result.errors} mantido(s) no Pré-Envio por erro`);
  if (result.conflicts) parts.push(`${result.conflicts} conflito(s) concorrente(s)`);
  if (result.failed && !result.conflicts) parts.push(`${result.failed} não processado(s)`);
  let description = `${parts.length ? parts.join(', ') : 'Nenhum lead alterado'}.`;
  if (result.failures[0]) description += ` ${result.failures[0].reason}`;
  if (result.auditWarnings.length) description += ' Houve aviso ao registrar auditoria.';
  return description;
}

function routingDescription(result: LeadRoutingResult) {
  const parts = [`${result.succeeded} atualizado(s)`];
  if (result.unchanged) parts.push(`${result.unchanged} inalterado(s)`);
  if (result.failed) parts.push(`${result.failed} não processado(s)`);
  let description = `${parts.join(', ')}.`;
  if (result.failures[0]) description += ` ${result.failures[0].reason}`;
  if (result.auditWarnings.length) description += ' Houve aviso ao registrar auditoria.';
  return description;
}

export function PreSendPage() {
  const {
    records,
    loading,
    saving,
    error,
    refresh,
    executeRoutingCommand,
    validateWhatsApp,
  } = useLeadCycle('pre-send');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const rows = useMemo<Row[]>(() => records.map((lead) => ({
    id: lead.id,
    company: lead.company,
    branch: lead.branch || '-',
    state: lead.state || '-',
    city: lead.city || '-',
    phone: lead.phone || '-',
    status: <Tag tone="warning">Aguardando validação</Tag>,
  })), [records]);
  const selectedIds = selectedRows.map((index) => rows[index]?.id).filter(Boolean);

  const toast = (title: string, description: string, tone: ToastItem['tone'] = 'success') => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, title, description, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4800);
  };

  const runValidation = async (ids: string[]) => {
    try {
      const result = await validateWhatsApp(ids);
      const changed = result.approved + result.redirectedToInstagram + result.invalidated;
      if (changed) setSelectedRows([]);

      if (result.failed && !changed) {
        toast('Validação não iniciada', validationDescription(result), 'danger');
      } else if (result.errors || result.conflicts || result.auditWarnings.length) {
        toast('Validação concluída com pendências', validationDescription(result), 'warning');
      } else {
        toast('Validação concluída', validationDescription(result), 'success');
      }
    } catch (err) {
      toast(
        'Validação indisponível',
        err instanceof Error ? err.message : 'O provedor não respondeu. Nenhum lead foi alterado.',
        'danger',
      );
    }
  };

  const runRoutingCommand = async (command: LeadRoutingCommand, ids: string[], title: string) => {
    try {
      const result = await executeRoutingCommand(command, ids);
      if (result.succeeded || result.unchanged) setSelectedRows([]);
      toast(
        result.failed && !result.succeeded && !result.unchanged ? 'Não foi possível concluir' : title,
        routingDescription(result),
        result.failed || result.auditWarnings.length ? 'warning' : 'success',
      );
    } catch (err) {
      toast('Não foi possível concluir', err instanceof Error ? err.message : 'Tente novamente.', 'danger');
    }
  };

  const handleAction = async (action: TableAction, row: Row) => {
    if (action === 'approve') await runValidation([row.id]);
    if (action === 'invalidate') await runRoutingCommand('invalidate-pre-send', [row.id], 'Lead invalidado');
    if (action === 'archive') await runRoutingCommand('archive-pre-send', [row.id], 'Lead arquivado');
  };

  return (
    <div className="dashboard-table-page lead-list-page">
      <PageHeader
        title="Pré-Envio"
        description="Valide WhatsApps e prepare filas com capacidade, data, recurso, template e mídia congelados."
        action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || saving} onClick={() => void refresh()}>Atualizar</Button>}
      />
      <section className="metric-grid metric-grid--1">
        <MetricCard icon={PhoneCall} value={String(records.length)} label="WhatsApps aguardando validação" tone="success" />
      </section>
      <TableCard title="Leads aguardando confirmação do WhatsApp" footerText={loading ? 'Carregando...' : `${rows.length} lead(s).`}>
        {selectedIds.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedIds.length} selecionado(s)</span>
            <Button size="sm" iconLeft={Check} disabled={saving} onClick={() => void runValidation(selectedIds)}>Validar WhatsApp</Button>
            <Button size="sm" variant="secondary" iconLeft={X} disabled={saving} onClick={() => void runRoutingCommand('invalidate-pre-send', selectedIds, 'Leads invalidados')}>Invalidar</Button>
            <Button size="sm" variant="secondary" iconLeft={Archive} disabled={saving} onClick={() => void runRoutingCommand('archive-pre-send', selectedIds, 'Leads arquivados')}>Arquivar</Button>
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando Pré-Envio...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum WhatsApp aguardando validação.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable columns={columns} rows={rows} actions={['approve', 'invalidate', 'archive']} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onAction={handleAction} />
        ) : null}
      </TableCard>
      <QueuePreparationPanel onToast={toast} />
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
