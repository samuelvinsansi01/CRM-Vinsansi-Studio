import { Clock3, FileImage, RefreshCcw, Send, UserCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  FiltersBar,
  MetricCard,
  RowsPerPageControl,
  SearchInput,
  SelectField,
  TableCard,
  Tag,
  ToastViewport,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useCrmLeads } from '../hooks/useCrmLeads';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { COMMERCIAL_STAGE_LABELS, type CommercialStage } from '../services/leads/crmLead.types';

type Row = Record<string, ReactNode> & { id: string };
const STAGES = Object.entries(COMMERCIAL_STAGE_LABELS).map(([value, label]) => ({ value, label }));

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function StageControl({ value, disabled, onChange }: { value: CommercialStage; disabled: boolean; onChange: (value: CommercialStage) => void }) {
  return (
    <SelectField
      className="commercial-stage-select"
      value={value}
      options={STAGES}
      disabled={disabled}
      onChange={(next) => onChange(next as CommercialStage)}
    />
  );
}

export function CommercialPage() {
  const { hasPermission } = useOrganizationContext();
  const canEdit = hasPermission('leads.edit');
  const initialStage = window.sessionStorage.getItem('crm:commercial:stage') ?? '';
  const [stage, setStage] = useState(initialStage);
  const [channel, setChannel] = useState('Todos');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [savingLeadId, setSavingLeadId] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => { window.sessionStorage.removeItem('crm:commercial:stage'); }, []);

  const filters = useMemo(() => ({
    search: debouncedSearch,
    statusId: 5,
    channel,
    commercialStage: stage as CommercialStage | '',
  }), [channel, debouncedSearch, stage]);
  const { items, total, summary, loading, refreshing, error, refresh, setCommercialStage } = useCrmLeads(filters, page, rowsPerPage);
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const toast = (item: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [{ id, ...item }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 3400);
  };

  const changeStage = async (leadId: string, nextStage: CommercialStage) => {
    if (!canEdit || savingLeadId) return;
    setSavingLeadId(leadId);
    try {
      await setCommercialStage(leadId, nextStage);
      toast({ title: 'Estágio atualizado', description: `Lead movido para ${COMMERCIAL_STAGE_LABELS[nextStage]}.`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Não foi possível atualizar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSavingLeadId('');
    }
  };

  const columns: TableColumn<Row>[] = [
    { key: 'company', label: 'Empresa', width: '22%' },
    { key: 'branch', label: 'Ramo', width: '14%' },
    { key: 'location', label: 'Localidade', width: '14%' },
    { key: 'channel', label: 'Canal', width: '10%' },
    { key: 'sentAt', label: 'Enviado em', width: '13%' },
    { key: 'stage', label: 'Estágio comercial', width: '17%' },
    { key: 'updatedAt', label: 'Alterado em', width: '10%' },
  ];

  const rows = useMemo<Row[]>(() => items.map((lead) => ({
    id: lead.id,
    company: lead.company,
    branch: lead.branch || '—',
    location: [lead.city, lead.state].filter(Boolean).join(' · ') || '—',
    channel: <Tag tone={lead.channel === 'WhatsApp' ? 'success' : lead.channel === 'Instagram' ? 'primary' : 'neutral'}>{lead.channel}</Tag>,
    sentAt: formatDate(lead.lastSentAt),
    stage: <StageControl value={lead.commercialStage ?? 'aguardando_resposta'} disabled={!canEdit || savingLeadId === lead.id} onChange={(next) => void changeStage(lead.id, next)} />,
    updatedAt: lead.commercialUpdatedAt ? formatDate(lead.commercialUpdatedAt) : '—',
  })), [canEdit, items, savingLeadId]);

  const selectStage = (value: CommercialStage | '') => { setStage(value); setPage(1); };

  return (
    <div className="dashboard-table-page commercial-page">
      <PageHeader
        title="Comercial"
        description="Classificação manual do resultado comercial dos leads enviados. Nenhuma mensagem ou automação altera estes estágios."
        action={<Button variant="secondary" iconLeft={RefreshCcw} loading={refreshing} disabled={loading} onClick={() => void refresh()}>Atualizar</Button>}
      />

      <section className="metric-grid metric-grid--5">
        <MetricCard icon={Clock3} value={String(summary.commercial.aguardandoResposta)} label="Aguardando resposta" active={stage === 'aguardando_resposta'} onClick={() => selectStage('aguardando_resposta')} />
        <MetricCard icon={FileImage} value={String(summary.commercial.aguardandoDesign)} label="Aguardando design" tone="warning" active={stage === 'aguardando_design'} onClick={() => selectStage('aguardando_design')} />
        <MetricCard icon={Send} value={String(summary.commercial.designEnviado)} label="Design enviado" tone="primary" active={stage === 'design_enviado'} onClick={() => selectStage('design_enviado')} />
        <MetricCard icon={UserCheck} value={String(summary.commercial.fechado)} label="Fechados" tone="success" active={stage === 'fechado'} onClick={() => selectStage('fechado')} />
        <MetricCard icon={X} value={String(summary.commercial.recusado)} label="Recusados" tone="danger" active={stage === 'recusado'} onClick={() => selectStage('recusado')} />
      </section>

      <FiltersBar>
        <SelectField value={stage} options={[{ label: 'Todos os estágios', value: '' }, ...STAGES]} placeholder="Estágio" onChange={(value) => selectStage(value as CommercialStage | '')} />
        <SelectField value={channel} options={['Todos', 'WhatsApp', 'Instagram', 'Sem canal']} placeholder="Canal" onChange={(value) => { setChannel(value); setPage(1); }} />
        <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Buscar empresa ou contato" />
      </FiltersBar>

      <TableCard
        title="Gestão comercial"
        footerText={loading ? 'Carregando...' : `${refreshing ? 'Atualizando · ' : ''}Mostrando ${rows.length} de ${total} lead(s) enviado(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); }} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando gestão comercial...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead neste estágio.</div> : null}
        {!error && !loading && rows.length ? <DataTable columns={columns} rows={rows} selectable={false} /> : null}
      </TableCard>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
