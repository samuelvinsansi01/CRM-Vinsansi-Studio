import { Send } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  Drawer,
  MetricCard,
  RowsPerPageControl,
  SelectField,
  TableCard,
  Tag,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { useClientPagination } from '../hooks/useClientPagination';
import { useQueuePreparation } from '../hooks/useQueuePreparation';
import type { QueuePreparationChannel, QueuePreparationResult } from '../services/queue-preparation';

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

export function ApprovedLeadsQueueDrawer({
  open,
  channel,
  scheduledDate,
  preferredResourceId = '',
  onClose,
  onPrepared,
  onToast,
}: {
  open: boolean;
  channel: QueuePreparationChannel;
  scheduledDate: string;
  preferredResourceId?: string;
  onClose: () => void;
  onPrepared: () => void;
  onToast: (title: string, description: string, tone?: ToastItem['tone']) => void;
}) {
  const [resourceId, setResourceId] = useState('');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const { snapshot, loading, refreshing, saving, error, refresh, enqueue } = useQueuePreparation(channel, scheduledDate, resourceId);

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
    if (!open) return;
    setSelectedRows([]);
    setResourceId('');
    resetPage();
  }, [channel, open, preferredResourceId, scheduledDate, resetPage]);

  useEffect(() => {
    if (!open) return;
    const preferred = snapshot?.resources.find((resource) =>
      resource.id === preferredResourceId || resource.label === preferredResourceId || resource.aliases?.includes(preferredResourceId)
    )?.id;
    const currentIsValid = snapshot?.resources.some((resource) => resource.id === resourceId);
    if (preferred && resourceId !== preferred) setResourceId(preferred);
    else if (!currentIsValid) setResourceId(snapshot?.selectedResource?.id ?? '');
  }, [open, preferredResourceId, resourceId, snapshot?.resources, snapshot?.selectedResource?.id]);

  const selectedIds = selectedRows.map((index) => pageItems[index]?.id).filter(Boolean);
  const selectedReadyIds = selectedRows
    .map((index) => pageItems[index])
    .filter((row): row is Row => Boolean(row?.ready))
    .map((row) => row.id);
  const selectedBlocked = selectedIds.length - selectedReadyIds.length;
  const selectedResource = snapshot?.resources.find((resource) => resource.id === resourceId) ?? snapshot?.selectedResource;
  const capacity = selectedResource?.available ?? 0;
  const canPrepare = Boolean(selectedReadyIds.length && resourceId && capacity > 0 && !saving);
  const readyToCapacityIds = (snapshot?.leads ?? [])
    .filter((lead) => lead.ready)
    .slice(0, Math.max(0, capacity))
    .map((lead) => lead.id);
  const canPrepareToCapacity = Boolean(readyToCapacityIds.length && resourceId && capacity > 0 && !saving);

  const prepareIds = async (ids: string[], closeWhenClean = true) => {
    if (!ids.length) {
      onToast('Nada para puxar', 'Não há leads aprovados e prontos dentro da capacidade disponível.', 'warning');
      return;
    }

    try {
      const result = await enqueue(ids);
      setSelectedRows([]);
      onPrepared();
      onToast(
        result.failed || result.conflicts || result.auditWarnings.length ? 'Inclusão concluída com pendências' : 'Leads adicionados à fila',
        resultDescription(result),
        result.failed || result.conflicts || result.auditWarnings.length ? 'warning' : 'success',
      );
      if (closeWhenClean && result.queued > 0 && !result.failed && !result.conflicts) onClose();
    } catch (cause) {
      onToast('Não foi possível puxar os aprovados', cause instanceof Error ? cause.message : 'Tente novamente.', 'danger');
    }
  };

  const prepare = async () => {
    if (!selectedReadyIds.length) {
      onToast('Nada para puxar', 'Selecione pelo menos um lead aprovado marcado como Pronto.', 'warning');
      return;
    }

    await prepareIds(selectedReadyIds);
  };

  const prepareToCapacity = async () => {
    await prepareIds(readyToCapacityIds);
  };

  return (
    <Drawer
      open={open}
      size="wide"
      title={`Puxar aprovados para a fila ${channel}`}
      description={`Apenas leads com status Validado e destino ${channel} aparecem aqui. A data operacional será ${snapshot?.effectiveDate ?? scheduledDate}.`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="secondary" iconLeft={Send} loading={saving} disabled={!canPrepareToCapacity} onClick={() => void prepareToCapacity()}>
            Adicionar até {capacity} vaga(s)
          </Button>
          <Button iconLeft={Send} loading={saving} disabled={!canPrepare} onClick={() => void prepare()}>
            Adicionar selecionados
          </Button>
        </>
      )}
    >
      <div className="queue-approved-drawer">
        <div className="queue-approved-drawer__resource">
          <span className="field__label">{channel === 'WhatsApp' ? 'Chip' : 'Perfil Instagram'}</span>
          <SelectField
            value={resourceId}
            placeholder={channel === 'WhatsApp' ? 'Selecionar chip' : 'Selecionar perfil'}
            options={(snapshot?.resources ?? []).map((resource) => ({
              value: resource.id,
              label: `${resource.label} — ${resource.used}/${resource.dailyLimit} • lote ${resource.batchSize}`,
            }))}
            onChange={(value) => { setResourceId(value); setSelectedRows([]); resetPage(); }}
          />
        </div>

        <div className="metric-grid metric-grid--4 queue-approved-drawer__metrics">
          <MetricCard value={String(rows.length)} label="Aprovados" />
          <MetricCard value={String(snapshot?.ready ?? 0)} label="Prontos" tone="success" />
          <MetricCard value={String(snapshot?.blocked ?? 0)} label="Bloqueados" tone="warning" />
          <MetricCard value={String(capacity)} label="Vagas" tone="primary" />
        </div>

        <TableCard
          title={`Leads aprovados — ${snapshot?.effectiveDate ?? scheduledDate}`}
          footerText={loading ? 'Carregando...' : `Mostrando ${pageItems.length} de ${rows.length} lead(s).`}
          footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setSelectedRows([]); }} />}
          page={page}
          totalPages={totalPages}
          onPageChange={(nextPage) => { setPage(nextPage); setSelectedRows([]); }}
        >
          {selectedIds.length ? (
            <div className="lead-bulk-actions">
              <span>{selectedReadyIds.length} pronto(s) selecionado(s){selectedBlocked ? `; ${selectedBlocked} bloqueado(s) ignorado(s)` : ''}</span>
            </div>
          ) : null}
          {refreshing && rows.length ? <div className="queue-refresh-indicator">Atualizando capacidade...</div> : null}
          {error ? <div className="table-message">{error}</div> : null}
          {!error && loading && !rows.length ? <div className="table-message">Carregando leads aprovados...</div> : null}
          {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead aprovado disponível para {channel}.</div> : null}
          {!error && pageItems.length ? (
            <DataTable
              columns={columns}
              rows={pageItems}
              actions={[]}
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
            />
          ) : null}
        </TableCard>

        <Button variant="secondary" size="sm" disabled={loading || saving} onClick={refresh}>Atualizar aprovados</Button>
      </div>
    </Drawer>
  );
}
