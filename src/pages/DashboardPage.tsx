import { CircleDollarSign, Clock3, FileImage, List, Send, Unplug, UserCheck, Users, X } from 'lucide-react';
import { MetricCard, Panel } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useCrmLeads } from '../hooks/useCrmLeads';
import type { PageId } from './pageRegistry';

type DashboardPageProps = { onNavigate: (page: PageId) => void };

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const { summary, loading, error } = useCrmLeads({}, 1, 10);

  const goLeads = (statusId?: number) => {
    if (statusId) window.sessionStorage.setItem('crm:leads:status-id', String(statusId));
    else window.sessionStorage.removeItem('crm:leads:status-id');
    onNavigate('leads');
  };

  const goCommercial = (stage: string) => {
    window.sessionStorage.setItem('crm:commercial:stage', stage);
    onNavigate('commercial');
  };

  const goSends = () => onNavigate('whatsapp');

  return (
    <div className="dashboard-page">
      <PageHeader
        title="Dashboard"
        description="Visão geral da base, dos envios e do andamento comercial da operação."
      />

      {error ? <div className="table-message">{error}</div> : null}

      <Panel title="Operação" className="dashboard-section-card">
        <section className="metric-grid metric-grid--5">
          <MetricCard icon={Users} value={loading ? '—' : String(summary.imported)} label="Leads disponíveis" onClick={() => goLeads(1)} />
          <MetricCard icon={List} value={loading ? '—' : String(summary.queued)} label="Em fila" tone="primary" onClick={goSends} />
          <MetricCard icon={Send} value={loading ? '—' : String(summary.sent)} label="Enviados" tone="success" onClick={() => goLeads(5)} />
          <MetricCard icon={X} value={loading ? '—' : String(summary.invalid)} label="Inválidos" tone="danger" onClick={() => goLeads(6)} />
          <MetricCard icon={Unplug} value={loading ? '—' : String(summary.noContact)} label="Sem contato" tone="warning" onClick={() => goLeads(3)} />
        </section>
      </Panel>

      <Panel title="Comercial" className="dashboard-section-card">
        <section className="metric-grid metric-grid--5">
          <MetricCard icon={Clock3} value={loading ? '—' : String(summary.commercial.aguardandoResposta)} label="Aguardando resposta" onClick={() => goCommercial('aguardando_resposta')} />
          <MetricCard icon={FileImage} value={loading ? '—' : String(summary.commercial.aguardandoDesign)} label="Aguardando design" tone="warning" onClick={() => goCommercial('aguardando_design')} />
          <MetricCard icon={Send} value={loading ? '—' : String(summary.commercial.designEnviado)} label="Design enviado" tone="primary" onClick={() => goCommercial('design_enviado')} />
          <MetricCard icon={CircleDollarSign} value={loading ? '—' : String(summary.commercial.fechado)} label="Fechados" tone="success" onClick={() => goCommercial('fechado')} />
          <MetricCard icon={UserCheck} value={loading ? '—' : String(summary.commercial.recusado)} label="Recusados" tone="danger" onClick={() => goCommercial('recusado')} />
        </section>
      </Panel>
    </div>
  );
}
