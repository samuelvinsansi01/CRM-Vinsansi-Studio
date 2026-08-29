import { CheckCircle2, CircleX, RefreshCcw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, MetricCard, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { getHomologationSnapshot, getProductionReadiness, type HomologationCheck, type HomologationSnapshot } from '../repositories/release/homologation.repository';

function tone(status: HomologationCheck['status']) { return status === 'passed' ? 'success' : status === 'failed' ? 'danger' : 'warning'; }
function label(status: HomologationCheck['status']) { return status === 'passed' ? 'Aprovado' : status === 'failed' ? 'Falhou' : status === 'not_applicable' ? 'N/A' : 'Pendente'; }

export function HomologationPage() {
  const [snapshot, setSnapshot] = useState<HomologationSnapshot | null>(null);
  const [readiness, setReadiness] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await getHomologationSnapshot();
      setSnapshot(next);
      setReadiness(await getProductionReadiness());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao executar a homologação.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const checks = snapshot?.checks ?? [];
  const summary = useMemo(() => ({
    passed: checks.filter((item) => item.status === 'passed').length,
    failed: checks.filter((item) => item.status === 'failed').length,
    total: checks.length,
  }), [checks]);
  const sections = useMemo(() => {
    const map = new Map<string, HomologationCheck[]>();
    for (const item of checks) map.set(item.section, [...(map.get(item.section) ?? []), item]);
    return [...map.entries()];
  }, [checks]);
  const ready = readiness?.ok === true;

  return <div className="dashboard-table-page">
    <PageHeader
      title="Homologação final"
      description="Verificação automática e somente leitura do contrato final. Não depende de tabelas de homologação nem de promoção de release no banco."
      action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading} onClick={() => void refresh()}>Atualizar</Button>}
    />
    <section className="metric-grid metric-grid--4">
      <MetricCard icon={ShieldCheck} value={snapshot?.run.releaseVersion || '2.4.0-R59'} label="Release alvo" tone="primary" />
      <MetricCard icon={CheckCircle2} value={String(summary.passed)} label="Aprovados" tone="success" />
      <MetricCard icon={CircleX} value={String(summary.failed)} label="Falhas" tone={summary.failed ? 'danger' : 'neutral'} />
      <MetricCard icon={ShieldCheck} value={ready ? 'PRONTO' : 'REVISAR'} label="Readiness" tone={ready ? 'success' : 'warning'} />
    </section>
    {error ? <div className="table-message table-message--error">{error}</div> : null}
    {loading && !snapshot ? <div className="table-message">Executando verificações...</div> : null}
    {sections.map(([section, items]) => <Panel key={section} title={section}>
      <div className="homologation-checks">
        {items.map((item) => <div className="homologation-check" key={item.key}>
          <div className="homologation-check__body">
            <div><strong>{item.label}</strong> <Tag tone={tone(item.status)}>{label(item.status)}</Tag></div>
            <span>{item.evidence || 'Sem evidência.'}</span>
          </div>
        </div>)}
      </div>
    </Panel>)}
  </div>;
}
