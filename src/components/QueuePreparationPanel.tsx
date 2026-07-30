import { CalendarClock, CheckCircle2, ListChecks, RefreshCcw, Send, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  Field,
  MetricCard,
  RowsPerPageControl,
  SegmentedControl,
  SelectField,
  TableCard,
  Tag,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { useClientPagination } from '../hooks/useClientPagination';
import { useQueuePreparation } from '../hooks/useQueuePreparation';
import type { QueuePreparationChannel, QueuePreparationResult } from '../services/queue-preparation';
import { toLocalDateInputValue } from '../utils/date';

type Row = Record<string, ReactNode> & {
  id: string;
  ready: boolean;
  blockReason?: string;
};

const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Empresa', width: '25%' },
  { key: 'branch', label: 'Ramo', width: '18%' },
  { key: 'location', label: 'Localização', width: '15%' },
  { key: 'contact', label: 'Destino', width: '18%' },
  { key: 'template', label: 'Template', width: '10%' },
  { key: 'readiness', label: 'Prontidão', width: '14%' },
];

function resultDescription(result: QueuePreparationResult) {
  const parts = [`${result.queued} incluído(s) na fila`];
  if (result.conflicts) parts.push(`${result.conflicts} conflito(s)`);
  if (result.failed) parts.push(`${result.failed} não preparado(s)`);
  let description = `${parts.join(', ')}. Data operacional: ${result.effectiveDate}.`;
  if (result.failures[0]) description += ` ${result.failures[0].reason}`;
  if (result.auditWarnings.length) description += ' Houve aviso ao registrar auditoria.';
  return description;
}

export function QueuePreparationPanel({
  onToast,
}: {
  onToast: (title: string, description: string, tone?: ToastItem['tone']) => void;
}) {
  const [channel, setChannel] = useState<QueuePreparationChannel>('WhatsApp');
  const [requestedDate, setRequestedDate] = useState(toLocalDateInputValue());
  const [resourceId, setResourceId] = useState('');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const { snapshot, loading, refreshing, saving, error, refresh, enqueue } = useQueuePreparation(channel, requestedDate, resourceId);

  useEffect(() => {
    const valid = snapshot?.resources.some((resource) => resource.id === resourceId);
    if (!valid) setResourceId(snapshot?.selectedResource?.id ?? '');
  }, [snapshot?.resources, snapshot?.selectedResource?.id, resourceId]);

  const rows = useMemo<Row[]>(() => (snapshot?.leads ?? []).map((lead) => ({
    id: lead.id,
    ready: lead.ready,
    blockReason: lead.blockReason,
    company: lead.company,
    branch: lead.branch || '-',
    location: [lead.city, lead.state].filter(Boolean).join(' / ') || '-',
    contact: lead.channel === 'Instagram' ? `@${lead.contact}` : lead.contact,
    template: lead.templateType === 'com-site' ? 'Com site' : 'Sem site',
    readiness: lead.ready
      ? <Tag tone="success">Pronto</Tag>
      : <span title={lead.blockReason}><Tag tone="warning">Bloqueado</Tag></span>,
  })), [snapshot?.leads]);

  const {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    totalPages,
    pageItems,
    resetPage,
  } = useClientPagination(rows, 20);

  useEffect(() => {
    setSelectedRows([]);
    setResourceId('');
    resetPage();
  }, [channel, resetPage]);

  const selectedIds = selectedRows.map((index) => pageItems[index]?.id).filter(Boolean);
  const selectedReadyIds = selectedRows
    .map((index) => pageItems[index])
    .filter((row): row is Row => Boolean(row?.ready))
    .map((row) => row.id);
  const selectedBlocked = selectedIds.length - selectedReadyIds.length;
  const capacity = snapshot?.selectedResource?.available ?? 0;
  const canPrepare = Boolean(selectedReadyIds.length && resourceId && capacity > 0 && !saving);

  const prepare = async () => {
    if (!selectedReadyIds.length) {
      onToast('Nada para preparar', 'Selecione pelo menos um lead marcado como Pronto.', 'warning');
      return;
    }
    try {
      const result = await enqueue(selectedReadyIds);
      setSelectedRows([]);
      onToast(
        result.failed || result.conflicts || result.auditWarnings.length ? 'Preparação concluída com pendências' : 'Fila preparada',
        resultDescription(result),
        result.failed || result.conflicts || result.auditWarnings.length ? 'warning' : 'success',
      );
    } catch (err) {
      onToast('Não foi possível preparar a fila', err instanceof Error ? err.message : 'Tente novamente.', 'danger');
    }
  };

  return (
    <section className="queue-preparation">
      <div className="queue-preparation__header">
        <div>
          <h2>Preparação operacional das filas</h2>
          <p>Somente leads validados são alocados. Mensagens, template, mídia, recurso e data ficam congelados no item da fila.</p>
        </div>
        <Button variant="secondary" size="sm" iconLeft={RefreshCcw} disabled={loading || saving} onClick={refresh}>
          Atualizar
        </Button>
      </div>

      <div className="queue-preparation__controls">
        <SegmentedControl items={['WhatsApp', 'Instagram']} active={channel} onChange={(value) => setChannel(value as QueuePreparationChannel)} />
        <Field label="Data solicitada" type="date" value={requestedDate} min={toLocalDateInputValue()} onChange={setRequestedDate} />
        <div className="queue-preparation__resource">
          <span className="field__label">{channel === 'WhatsApp' ? 'Chip' : 'Perfil Instagram'}</span>
          <SelectField
            value={resourceId}
            placeholder={channel === 'WhatsApp' ? 'Selecionar chip' : 'Selecionar perfil'}
            options={(snapshot?.resources ?? []).map((resource) => ({
              value: resource.id,
              label: `${resource.label} — ${resource.used}/${resource.dailyLimit} • lote ${resource.batchSize}`,
            }))}
            onChange={setResourceId}
          />
        </div>
      </div>

      {snapshot?.cutoffApplied || snapshot?.activeDayAdjusted ? (
        <div className="queue-preparation__notice">
          <CalendarClock size={17} />
          {snapshot.cutoffApplied ? 'A virada das 22h foi aplicada. ' : ''}
          {snapshot.activeDayAdjusted ? 'A data foi movida para o próximo dia ativo do canal. ' : ''}
          Os itens serão programados para {snapshot.effectiveDate}.
        </div>
      ) : null}

      <div className="metric-grid metric-grid--4">
        <MetricCard icon={ListChecks} value={String(snapshot?.leads.length ?? 0)} label="Validados disponíveis" tone="neutral" />
        <MetricCard icon={CheckCircle2} value={String(snapshot?.ready ?? 0)} label="Prontos" tone="success" />
        <MetricCard icon={ShieldAlert} value={String(snapshot?.blocked ?? 0)} label="Bloqueados" tone="warning" />
        <MetricCard icon={Send} value={String(capacity)} label="Vagas disponíveis" tone="primary" />
      </div>

      <TableCard
        title={`${channel} — ${snapshot?.effectiveDate ?? requestedDate}`}
        footerText={loading ? 'Carregando...' : `Mostrando ${pageItems.length} de ${rows.length} lead(s); ${capacity} vaga(s) no recurso selecionado.`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setSelectedRows([]); }} />}
        page={page}
        totalPages={totalPages}
        onPageChange={(nextPage) => { setPage(nextPage); setSelectedRows([]); }}
      >
        {selectedIds.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedReadyIds.length} pronto(s) selecionado(s){selectedBlocked ? `; ${selectedBlocked} bloqueado(s) ignorado(s)` : ''}</span>
            <Button size="sm" iconLeft={Send} loading={saving} disabled={!canPrepare} onClick={() => void prepare()}>
              Preparar fila
            </Button>
          </div>
        ) : null}
        {refreshing && rows.length ? <div className="queue-refresh-indicator">Atualizando capacidade...</div> : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading && !rows.length ? <div className="table-message">Carregando leads validados...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead validado disponível para {channel}.</div> : null}
        {!error && rows.length ? (
          <DataTable
            columns={columns}
            rows={pageItems}
            actions={[]}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
          />
        ) : null}
      </TableCard>
    </section>
  );
}
