import { AlertTriangle, CheckCircle2, Clock3, Eye, RefreshCcw, Search, ShieldAlert, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, MetricCard, Pagination, Panel, RowsPerPageControl, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useClientPagination } from '../hooks/useClientPagination';
import { useReconciliation } from '../hooks/useReconciliation';
import { useAuditEvents } from '../hooks/useAuditEvents';
import { useNotificationContext } from '../providers/NotificationProvider';
import type { ReconciliationIssue, ReconciliationRepairAction, ReconciliationSeverity } from '../services/reconciliation/types';

const severityLabel: Record<ReconciliationSeverity, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Informativo',
};

const severityTone: Record<ReconciliationSeverity, 'danger' | 'warning' | 'neutral'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'neutral',
};

const repairLabel: Record<ReconciliationRepairAction, string> = {
  'return-lead-to-valid': 'Retornar para Válidos',
  'sync-lead-queued': 'Sincronizar como Na fila',
  'sync-lead-sent': 'Sincronizar como Enviado',
  'sync-lead-invalid': 'Sincronizar como Inválido',
  'mark-queue-error': 'Bloquear item com erro',
};

function formatDateTime(value: string) {
  if (!value) return 'Ainda não executada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

function entityLabel(issue: ReconciliationIssue) {
  const channel = issue.channel === 'whatsapp' ? 'WhatsApp' : issue.channel === 'instagram' ? 'Instagram' : 'Lead';
  const parts = [channel];
  if (issue.leadId) parts.push(`Lead ${issue.leadId}`);
  if (issue.queueItemId) parts.push(`Fila ${issue.queueItemId}`);
  return parts.join(' · ');
}

export function AuditPage() {
  const { push } = useNotificationContext();
  const { scan, loading, refreshing, repairingId, repairingSafe, error, refresh, repair, repairSafe } = useReconciliation();
  const auditHistory = useAuditEvents(200);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<'all' | ReconciliationSeverity>('all');
  const [repairability, setRepairability] = useState<'all' | 'repairable' | 'manual'>('all');

  const visibleIssues = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scan.issues.filter((issue) => {
      if (severity !== 'all' && issue.severity !== severity) return false;
      if (repairability === 'repairable' && !issue.repairAction) return false;
      if (repairability === 'manual' && issue.repairAction) return false;
      if (!query) return true;
      return `${issue.title} ${issue.detail} ${issue.recommendation} ${issue.leadId ?? ''} ${issue.leadName ?? ''} ${issue.queueItemId ?? ''}`
        .toLowerCase()
        .includes(query);
    });
  }, [repairability, scan.issues, search, severity]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(visibleIssues, 20);

  const handleRepair = async (issue: ReconciliationIssue) => {
    try {
      const result = await repair(issue);
      push({ type: result.repaired ? 'success' : 'info', message: result.message });
      if (result.auditWarning) push({ type: 'warning', message: `Reparo concluído, mas a auditoria falhou: ${result.auditWarning}` });
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao reconciliar inconsistência.' });
    }
  };

  const handleRepairSafe = async () => {
    try {
      const result = await repairSafe();
      if (!result.requested) {
        push({ type: 'info', message: 'Não há correções seguras disponíveis nesta varredura.' });
        return;
      }
      const message = `${result.repaired} corrigido(s), ${result.unchanged} já ajustado(s) e ${result.failed} conflito(s).`;
      push({ type: result.failed ? 'warning' : 'success', message });
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao executar correções seguras.' });
    }
  };

  return (
    <div className="audit-page">
      <PageHeader
        title="Auditoria"
        description="Detecte inconsistências entre leads e filas e aplique reparos com proteção concorrente."
        action={(
          <div className="audit-page__actions">
            <Button iconLeft={RefreshCcw} variant="secondary" loading={refreshing} onClick={refresh}>Atualizar</Button>
            <Button iconLeft={Wrench} loading={repairingSafe} disabled={!scan.summary.safeBulk} onClick={() => void handleRepairSafe()}>
              Corrigir casos seguros ({scan.summary.safeBulk})
            </Button>
          </div>
        )}
      />

      <div className="metric-grid metric-grid--5">
        <MetricCard icon={ShieldAlert} value={String(scan.summary.total)} label="Inconsistências" tone={scan.summary.total ? 'warning' : 'success'} />
        <MetricCard icon={AlertTriangle} value={String(scan.summary.critical)} label="Críticas" tone={scan.summary.critical ? 'danger' : 'neutral'} />
        <MetricCard icon={Wrench} value={String(scan.summary.repairable)} label="Com reparo" tone="primary" />
        <MetricCard icon={Eye} value={String(scan.summary.manualReview)} label="Revisão manual" tone="warning" />
        <MetricCard icon={CheckCircle2} value={scan.summary.total ? 'Pendente' : 'Íntegro'} label="Estado atual" tone={scan.summary.total ? 'warning' : 'success'} />
      </div>

      <Panel className="audit-panel" title="Inconsistências detectadas" actions={<span className="audit-scan-time"><Clock3 size={14} /> Última varredura: {formatDateTime(scan.scannedAt)}</span>}>
        <div className="audit-filters">
          <label className="audit-search">
            <Search size={16} />
            <input value={search} onChange={(event: import('react').ChangeEvent<HTMLInputElement>) => { setSearch(event.target.value); resetPage(); }} placeholder="Buscar por lead, fila ou problema" />
          </label>
          <select value={severity} onChange={(event: import('react').ChangeEvent<HTMLSelectElement>) => { setSeverity(event.target.value as 'all' | ReconciliationSeverity); resetPage(); }}>
            <option value="all">Todas as severidades</option>
            <option value="critical">Críticas</option>
            <option value="warning">Atenção</option>
            <option value="info">Informativas</option>
          </select>
          <select value={repairability} onChange={(event: import('react').ChangeEvent<HTMLSelectElement>) => { setRepairability(event.target.value as typeof repairability); resetPage(); }}>
            <option value="all">Todos os tratamentos</option>
            <option value="repairable">Com reparo</option>
            <option value="manual">Revisão manual</option>
          </select>
        </div>

        {error ? <div className="audit-state audit-state--error">{error}</div> : null}
        {loading ? <div className="audit-state">Executando varredura...</div> : null}
        {!loading && !error && !visibleIssues.length ? (
          <div className="audit-state audit-state--success">
            <CheckCircle2 size={24} />
            <strong>Nenhuma inconsistência encontrada.</strong>
            <span>Os leads e as filas estão coerentes dentro das regras verificadas pelo F10.</span>
          </div>
        ) : null}

        {!loading && visibleIssues.length ? (
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Severidade</th>
                  <th>Problema</th>
                  <th>Entidade</th>
                  <th>Estado observado</th>
                  <th>Tratamento</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((issue) => (
                  <tr key={issue.id}>
                    <td><Tag tone={severityTone[issue.severity]}>{severityLabel[issue.severity]}</Tag></td>
                    <td>
                      <strong>{issue.title}</strong>
                      <span>{issue.detail}</span>
                      <small>{issue.recommendation}</small>
                    </td>
                    <td>
                      <strong>{issue.leadName || entityLabel(issue)}</strong>
                      <span>{entityLabel(issue)}</span>
                    </td>
                    <td>
                      {issue.leadStatusId ? <span>Lead: {issue.leadStatusId}</span> : null}
                      {issue.queueStatus ? <span>Fila: {issue.queueStatus}</span> : null}
                      {issue.ageMinutes !== undefined ? <small>{issue.ageMinutes} min sem atualização</small> : null}
                    </td>
                    <td>
                      {issue.repairAction ? (
                        <Button
                          size="sm"
                          variant={issue.safeForBulkRepair ? 'primary' : 'secondary'}
                          loading={repairingId === issue.id}
                          disabled={Boolean(repairingId && repairingId !== issue.id) || repairingSafe}
                          onClick={() => void handleRepair(issue)}
                        >
                          {repairLabel[issue.repairAction]}
                        </Button>
                      ) : <Tag tone="neutral">Revisão manual</Tag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!loading && visibleIssues.length ? (
          <div className="audit-pagination">
            <div className="audit-pagination__left">
              <RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />
              <small>Mostrando {pageItems.length} de {visibleIssues.length} inconsistência(s)</small>
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        ) : null}
      </Panel>

      <Panel
        className="audit-panel"
        title="Histórico persistente"
        actions={<Button iconLeft={RefreshCcw} variant="secondary" loading={auditHistory.loading} onClick={() => void auditHistory.refresh()}>Atualizar histórico</Button>}
      >
        {auditHistory.error ? <div className="audit-state audit-state--error">{auditHistory.error}</div> : null}
        {auditHistory.loading && !auditHistory.events.length ? <div className="audit-state">Carregando eventos persistentes...</div> : null}
        {!auditHistory.loading && !auditHistory.events.length ? <div className="audit-state">Nenhum evento persistente registrado.</div> : null}
        {auditHistory.events.length ? (
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead><tr><th>Data</th><th>Origem</th><th>Ação</th><th>Entidade</th><th>Transição</th><th>Detalhes</th></tr></thead>
              <tbody>
                {auditHistory.events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.created_at)}</td>
                    <td><Tag tone="neutral">{event.source}</Tag></td>
                    <td><strong>{event.action}</strong></td>
                    <td>{event.queueItemId ? `Fila ${event.queueItemId}` : event.leadId ? `Lead ${event.leadId}` : String(event.metadata?.entity_type ?? 'Sistema')}</td>
                    <td>{event.metadata?.previous_status_id ?? '—'} → {event.metadata?.target_status_id ?? event.status ?? '—'}</td>
                    <td><span>{event.message || String(event.metadata?.company_name ?? event.metadata?.reason ?? '') || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <p className="audit-footnote">
        Itens em processamento são considerados travados após {scan.staleAfterMinutes} minutos. Reparos em massa incluem apenas sincronizações determinísticas; bloqueios de fila e conflitos finais exigem ação individual.
      </p>
    </div>
  );
}
