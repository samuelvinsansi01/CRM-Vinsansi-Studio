import { Activity, AlertTriangle, CheckCircle2, RefreshCcw, RotateCcw, Server, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, MetricCard, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useNotificationContext } from '../providers/NotificationProvider';
import { getOperationalHealth, listOperationalAlerts, requestOperationalRecovery, type OperationalHealth } from '../repositories/monitoring/operationalHealth.repository';

function dateTime(value: unknown) {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

export function MonitoringPage() {
  const { push } = useNotificationContext();
  const [health, setHealth] = useState<OperationalHealth | null>(null);
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [nextHealth, nextAlerts] = await Promise.all([getOperationalHealth(), listOperationalAlerts()]);
      setHealth(nextHealth); setAlerts(nextAlerts);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao carregar monitoramento.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); const id=window.setInterval(() => void refresh(), 60_000); return () => window.clearInterval(id); }, [refresh]);

  const recover = async () => {
    setRecovering(true);
    try { const id=await requestOperationalRecovery('all'); push({ type:'success', message:`Recuperação ${id} solicitada. O Worker executará de forma controlada.` }); await refresh(); }
    catch (err) { push({ type:'error', message: err instanceof Error ? err.message : 'Falha ao solicitar recuperação.' }); }
    finally { setRecovering(false); }
  };

  const healthy = Boolean(health && health.workers.online > 0 && health.workers.stale === 0 && health.queues.staleProcessing === 0 && health.alerts.critical === 0);
  return (
    <div className="monitoring-page">
      <PageHeader title="Monitoramento" description="Acompanhe Workers, filas travadas, reconciliações e solicitações de recuperação."
        action={<div className="audit-page__actions"><Button variant="secondary" iconLeft={RefreshCcw} loading={loading} onClick={() => void refresh()}>Atualizar</Button><Button iconLeft={RotateCcw} loading={recovering} onClick={() => void recover()}>Solicitar recuperação</Button></div>} />
      {error ? <div className="audit-state audit-state--error">{error}</div> : null}
      <div className="metric-grid metric-grid--5">
        <MetricCard icon={healthy ? CheckCircle2 : TriangleAlert} value={healthy ? 'Íntegro' : 'Atenção'} label="Estado geral" tone={healthy ? 'success' : 'warning'} />
        <MetricCard icon={Server} value={String(health?.workers.online ?? 0)} label="Workers online" tone={(health?.workers.online ?? 0) ? 'success' : 'danger'} />
        <MetricCard icon={Activity} value={String(health?.queues.processing ?? 0)} label="Itens processando" tone="primary" />
        <MetricCard icon={AlertTriangle} value={String(health?.queues.staleProcessing ?? 0)} label="Itens travados" tone={(health?.queues.staleProcessing ?? 0) ? 'danger' : 'neutral'} />
        <MetricCard icon={TriangleAlert} value={String((health?.reconciliation.whatsapp ?? 0)+(health?.reconciliation.instagram ?? 0))} label="Reconciliações" tone="warning" />
      </div>
      <Panel title="Resumo operacional">
        <div className="settings-summary-grid">
          <div><strong>Filas</strong><span>Pendentes: {health?.queues.pending ?? 0} · Erros: {health?.queues.errors ?? 0}</span></div>
          <div><strong>Lotes</strong><span>Ativos: {health?.batches.active ?? 0} · Travados: {health?.batches.stale ?? 0}</span></div>
          <div><strong>Worker</strong><span>Online: {health?.workers.online ?? 0} · Sem heartbeat: {health?.workers.stale ?? 0}</span></div>
          <div><strong>Última leitura</strong><span>{dateTime(health?.checkedAt)}</span></div>
        </div>
      </Panel>
      <Panel title="Alertas abertos">
        {!alerts.length ? <div className="audit-state audit-state--success"><CheckCircle2 size={22}/><strong>Nenhum alerta aberto.</strong></div> : (
          <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Severidade</th><th>Alerta</th><th>Origem</th><th>Detectado</th></tr></thead><tbody>{alerts.map((alert) => <tr key={String(alert.operational_alerts_id)}><td><Tag tone={alert.severity==='critical'?'danger':alert.severity==='warning'?'warning':'neutral'}>{String(alert.severity)}</Tag></td><td><strong>{String(alert.title)}</strong><span>{String(alert.message)}</span></td><td>{String(alert.source)}</td><td>{dateTime(alert.last_detected_at)}</td></tr>)}</tbody></table></div>
        )}
      </Panel>
    </div>
  );
}
