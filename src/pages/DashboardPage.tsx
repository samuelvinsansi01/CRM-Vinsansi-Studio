import { CalendarDays, Clock3, FileImage, List, Send, Unplug, UserCheck, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Field, FiltersBar, MetricCard, Panel, SegmentedControl } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { leadsRepository } from '../repositories/leads';
import type { CrmDashboardSummary } from '../services/leads/crmLead.types';
import type { PageId } from './pageRegistry';

type DashboardPageProps = { onNavigate: (page: PageId) => void };
type PeriodPreset = 'Hoje' | 'Semana' | 'Mês' | 'Personalizado';

const EMPTY_SUMMARY: CrmDashboardSummary = {
  newLeads: 0,
  queued: 0,
  sent: 0,
  invalid: 0,
  noContact: 0,
  designsDue: 0,
  commercial: { aguardandoResposta: 0, aguardandoDesign: 0, designEnviado: 0, fechado: 0, recusado: 0 },
};

function localDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function rangeForPreset(preset: Exclude<PeriodPreset, 'Personalizado'>) {
  const now = new Date();
  if (preset === 'Hoje') {
    const from = startOfLocalDay(now);
    return { from, toExclusive: addDays(from, 1) };
  }
  if (preset === 'Semana') {
    const from = startOfLocalDay(now);
    const day = from.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    from.setDate(from.getDate() + mondayOffset);
    return { from, toExclusive: addDays(from, 7) };
  }
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const toExclusive = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from, toExclusive };
}

function customRange(fromValue: string, toValue: string) {
  const from = new Date(`${fromValue}T00:00:00`);
  const inclusiveTo = new Date(`${toValue}T00:00:00`);
  return { from, toExclusive: addDays(inclusiveTo, 1) };
}

function formatRange(from: Date, toExclusive: Date) {
  const formatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${formatter.format(from)} – ${formatter.format(addDays(toExclusive, -1))}`;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const initialWeek = useMemo(() => rangeForPreset('Semana'), []);
  const [preset, setPreset] = useState<PeriodPreset>('Semana');
  const [customFrom, setCustomFrom] = useState(localDateInput(initialWeek.from));
  const [customTo, setCustomTo] = useState(localDateInput(addDays(initialWeek.toExclusive, -1)));
  const [summary, setSummary] = useState<CrmDashboardSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset !== 'Personalizado') return rangeForPreset(preset);
    return customRange(customFrom, customTo);
  }, [customFrom, customTo, preset]);

  const rangeValid = Number.isFinite(range.from.getTime()) && Number.isFinite(range.toExclusive.getTime()) && range.toExclusive > range.from;

  useEffect(() => {
    let active = true;
    if (!rangeValid) {
      setError('Selecione um período válido. A data final não pode ser anterior à inicial.');
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    void leadsRepository.dashboardSummary(range.from.toISOString(), range.toExclusive.toISOString())
      .then((result) => { if (active) setSummary(result); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar o Dashboard.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from.getTime(), range.toExclusive.getTime(), rangeValid]);

  const goLeads = (statusId?: number) => {
    if (statusId) window.sessionStorage.setItem('crm:leads:status-id', String(statusId));
    else window.sessionStorage.removeItem('crm:leads:status-id');
    onNavigate('leads');
  };

  const goCommercial = (stage: string) => {
    window.sessionStorage.setItem('crm:commercial:stage', stage);
    onNavigate('commercial');
  };

  return (
    <div className="dashboard-page">
      <PageHeader
        title="Dashboard"
        description={rangeValid ? `Visão do período selecionado · ${formatRange(range.from, range.toExclusive)}. A semana atual é o padrão; períodos maiores só aparecem quando você filtra.` : 'Selecione um período válido para atualizar os indicadores.'}
      />

      <FiltersBar left={<SegmentedControl compact items={['Hoje', 'Semana', 'Mês', 'Personalizado']} active={preset} onChange={(value) => setPreset(value as PeriodPreset)} />}>
        {preset === 'Personalizado' ? <>
          <Field type="date" value={customFrom} aria-label="Data inicial" onChange={setCustomFrom} />
          <Field type="date" value={customTo} aria-label="Data final" onChange={setCustomTo} />
        </> : null}
      </FiltersBar>

      {error ? <div className="table-message">{error}</div> : null}

      <Panel title="Operação no período" className="dashboard-section-card">
        <section className="metric-grid metric-grid--5">
          <MetricCard icon={Users} value={loading ? '—' : String(summary.newLeads)} label="Novos leads" onClick={() => goLeads()} />
          <MetricCard icon={List} value={loading ? '—' : String(summary.queued)} label="Preparados em fila" tone="primary" onClick={() => onNavigate('whatsapp')} />
          <MetricCard icon={Send} value={loading ? '—' : String(summary.sent)} label="Enviados" tone="success" onClick={() => goLeads(5)} />
          <MetricCard icon={X} value={loading ? '—' : String(summary.invalid)} label="Inválidos" tone="danger" onClick={() => goLeads(6)} />
          <MetricCard icon={Unplug} value={loading ? '—' : String(summary.noContact)} label="Sem contato" tone="warning" onClick={() => goLeads(3)} />
        </section>
      </Panel>

      <Panel title="Comercial no período" className="dashboard-section-card">
        <section className="metric-grid metric-grid--6">
          <MetricCard icon={Clock3} value={loading ? '—' : String(summary.commercial.aguardandoResposta)} label="Aguardando resposta" onClick={() => goCommercial('aguardando_resposta')} />
          <MetricCard icon={FileImage} value={loading ? '—' : String(summary.commercial.aguardandoDesign)} label="Aguardando design" tone="warning" onClick={() => goCommercial('aguardando_design')} />
          <MetricCard icon={Send} value={loading ? '—' : String(summary.commercial.designEnviado)} label="Design enviado" tone="primary" onClick={() => goCommercial('design_enviado')} />
          <MetricCard icon={UserCheck} value={loading ? '—' : String(summary.commercial.fechado)} label="Fechados" tone="success" onClick={() => goCommercial('fechado')} />
          <MetricCard icon={X} value={loading ? '—' : String(summary.commercial.recusado)} label="Recusados" tone="danger" onClick={() => goCommercial('recusado')} />
          <MetricCard icon={CalendarDays} value={loading ? '—' : String(summary.designsDue)} label="Designs previstos" tone="warning" onClick={() => goCommercial('aguardando_design')} />
        </section>
      </Panel>
    </div>
  );
}
