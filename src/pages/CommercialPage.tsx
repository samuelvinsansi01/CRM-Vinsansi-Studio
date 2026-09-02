import { CalendarDays, Clock3, FileImage, RefreshCcw, Send, UserCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  Drawer,
  Field,
  FiltersBar,
  MetricCard,
  RowsPerPageControl,
  SearchInput,
  SelectField,
  TableCard,
  Tag,
  ToastViewport,
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useCrmLeads } from '../hooks/useCrmLeads';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { COMMERCIAL_STAGE_LABELS, commercialStageOptions, type CommercialStage, type CrmLead } from '../services/leads/crmLead.types';
import { statusLabel } from '../services/status/status.mapper';
import { externalHttpHref, instagramHref, mapsHref, whatsappHref } from '../utils/externalLinks';

type Row = Record<string, ReactNode> & { id: string };
const STAGES = Object.entries(COMMERCIAL_STAGE_LABELS).map(([value, label]) => ({ value, label }));

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function StageControl({ value, disabled, onChange }: { value: CommercialStage; disabled: boolean; onChange: (value: CommercialStage) => void }) {
  const options = commercialStageOptions(value);
  return (
    <SelectField
      className="commercial-stage-select"
      value={value}
      options={options}
      disabled={disabled || options.length <= 1}
      onChange={(next) => onChange(next as CommercialStage)}
    />
  );
}

function formatDateOnly(value?: string) {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '—';
  return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day));
}

function todayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function designDateState(value?: string) {
  if (!value) return 'empty' as const;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const target = new Date(year, month - 1, day);
  if (target.getTime() < today.getTime()) return 'late' as const;
  if (target.getTime() === today.getTime()) return 'today' as const;
  return 'future' as const;
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
  const [viewingLead, setViewingLead] = useState<CrmLead | null>(null);
  const [scheduleLead, setScheduleLead] = useState<CrmLead | null>(null);
  const [designDueDate, setDesignDueDateDraft] = useState('');
  const [savingDesignDate, setSavingDesignDate] = useState(false);

  useEffect(() => { window.sessionStorage.removeItem('crm:commercial:stage'); }, []);

  const filters = useMemo(() => ({
    search: debouncedSearch,
    statusId: 5,
    channel,
    commercialStage: stage as CommercialStage | '',
  }), [channel, debouncedSearch, stage]);
  const { items, total, summary, loading, refreshing, error, refresh, setCommercialStage, setDesignDueDate } = useCrmLeads(filters, page, rowsPerPage);
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
      const original = items.find((item) => item.id === leadId) ?? null;
      await setCommercialStage(leadId, nextStage);
      await refresh();
      toast({ title: 'Estágio atualizado', description: `Lead movido para ${COMMERCIAL_STAGE_LABELS[nextStage]}.`, tone: 'success' });
      if (nextStage === 'aguardando_design' && original) {
        setScheduleLead({ ...original, commercialStage: nextStage });
        setDesignDueDateDraft(original.designDueDate || '');
      }
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
    { key: 'sentAt', label: 'Enviado em', width: '11%' },
    { key: 'stage', label: 'Estágio comercial', width: '16%' },
    { key: 'designDue', label: 'Envio previsto', width: '12%' },
    { key: 'updatedAt', label: 'Alterado em', width: '10%' },
  ];

  const rows = useMemo<Row[]>(() => items.map((lead) => ({
    id: lead.id,
    company: lead.alternativeName ? <span title={`Nome original: ${lead.company}`}><strong>{lead.alternativeName}</strong></span> : lead.company,
    branch: lead.branch || '—',
    location: [lead.city, lead.state].filter(Boolean).join(' · ') || '—',
    channel: <Tag tone={lead.channel === 'WhatsApp' ? 'success' : lead.channel === 'Instagram' ? 'primary' : 'neutral'}>{lead.channel}</Tag>,
    sentAt: formatDate(lead.lastSentAt),
    stage: <StageControl value={lead.commercialStage ?? 'aguardando_resposta'} disabled={!canEdit || savingLeadId === lead.id} onChange={(next) => void changeStage(lead.id, next)} />,
    designDue: (() => {
      const state = designDateState(lead.designDueDate);
      if ((lead.commercialStage ?? 'aguardando_resposta') === 'aguardando_design' && canEdit) {
        return <button className={`commercial-design-date commercial-design-date--${state}`} type="button" onClick={() => { setScheduleLead(lead); setDesignDueDateDraft(lead.designDueDate || ''); }}><CalendarDays size={14} strokeWidth={1.8} />{lead.designDueDate ? formatDateOnly(lead.designDueDate) : 'Definir data'}</button>;
      }
      return lead.designDueDate ? <span className={`commercial-design-date-text commercial-design-date-text--${state}`}>{formatDateOnly(lead.designDueDate)}</span> : '—';
    })(),
    updatedAt: lead.commercialUpdatedAt ? formatDate(lead.commercialUpdatedAt) : '—',
  })), [canEdit, items, savingLeadId]);

  const selectStage = (value: CommercialStage | '') => { setStage(value); setPage(1); };

  const handleAction = (action: TableAction, row: Row) => {
    const lead = items.find((item) => item.id === row.id);
    if (!lead) return;
    if (action === 'view') setViewingLead(lead);
    if (action === 'edit' && canEdit) {
      setScheduleLead(lead);
      setDesignDueDateDraft(lead.designDueDate || '');
    }
  };

  const saveDesignDate = async () => {
    if (!scheduleLead || (scheduleLead.commercialStage ?? 'aguardando_resposta') !== 'aguardando_design') return;
    setSavingDesignDate(true);
    try {
      await setDesignDueDate(scheduleLead.id, designDueDate || null);
      await refresh();
      toast({ title: 'Data do design atualizada', description: designDueDate ? `Envio previsto para ${formatDateOnly(designDueDate)}.` : 'A data prevista foi removida.', tone: 'success' });
      setScheduleLead(null);
    } catch (err) {
      toast({ title: 'Não foi possível salvar a data', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSavingDesignDate(false);
    }
  };

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
        {!error && !loading && rows.length ? <DataTable columns={columns} rows={rows} selectable={false} actions={canEdit ? ['view', 'edit'] : ['view']} onAction={handleAction} /> : null}
      </TableCard>

      <Drawer open={viewingLead !== null} title="Detalhes comerciais" description="O estágio é manual. As mensagens permanecem na Central de Conversas e não alteram esta classificação." onClose={() => setViewingLead(null)} footer={<Button variant="secondary" onClick={() => setViewingLead(null)}>Fechar</Button>}>
        {viewingLead ? <div className="drawer-form drawer-form--readonly">
          <Field label="Empresa original" value={viewingLead.company} readOnly />
          <Field label="Nome alternativo" value={viewingLead.alternativeName || '—'} readOnly />
          <Field label="Ramo" value={viewingLead.branch || '—'} readOnly />
          <Field label="Localidade" value={[viewingLead.city, viewingLead.state].filter(Boolean).join(' · ') || '—'} readOnly />
          <Field label="Canal" value={viewingLead.channel} readOnly />
          <Field label="WhatsApp" value={viewingLead.phone || '—'} readOnly />
          {viewingLead.phone ? <a className="drawer-external-link" href={whatsappHref(viewingLead.phone)} target="_blank" rel="noreferrer">Abrir WhatsApp</a> : null}
          <Field label="Instagram" value={viewingLead.instagram ? `@${viewingLead.instagram.replace(/^@/, '')}` : '—'} readOnly />
          {viewingLead.instagram ? <a className="drawer-external-link" href={instagramHref(viewingLead.instagram)} target="_blank" rel="noreferrer">Abrir Instagram</a> : null}
          <Field label="Site" value={viewingLead.website || '—'} readOnly />
          {viewingLead.website ? <a className="drawer-external-link" href={externalHttpHref(viewingLead.website)} target="_blank" rel="noreferrer">Abrir site</a> : null}
          <Field label="Google Maps" value={viewingLead.mapsUrl || '—'} readOnly />
          {viewingLead.mapsUrl ? <a className="drawer-external-link" href={mapsHref(viewingLead.mapsUrl)} target="_blank" rel="noreferrer">Abrir Google Maps</a> : null}
          <Field label="Status operacional" value={statusLabel(viewingLead.statusId)} readOnly />
          <Field label="Estágio comercial" value={COMMERCIAL_STAGE_LABELS[viewingLead.commercialStage ?? 'aguardando_resposta']} readOnly />
          <Field label="Envio previsto do design" value={viewingLead.designDueDate ? formatDateOnly(viewingLead.designDueDate) : '—'} readOnly />
          <Field label="Alterado em" value={viewingLead.commercialUpdatedAt ? formatDate(viewingLead.commercialUpdatedAt) : '—'} readOnly />
        </div> : null}
      </Drawer>

      <Drawer
        open={scheduleLead !== null}
        title="Planejamento do design"
        description={scheduleLead && (scheduleLead.commercialStage ?? 'aguardando_resposta') === 'aguardando_design'
          ? 'Defina a data em que a prévia deve ser enviada. O estágio comercial continua sendo alterado somente por você.'
          : 'A data planejada permanece como referência do processo comercial.'}
        onClose={() => { if (!savingDesignDate) setScheduleLead(null); }}
        footer={scheduleLead && (scheduleLead.commercialStage ?? 'aguardando_resposta') === 'aguardando_design' ? <>
          <Button variant="secondary" disabled={savingDesignDate} onClick={() => setScheduleLead(null)}>Cancelar</Button>
          <Button iconLeft={CalendarDays} loading={savingDesignDate} onClick={() => void saveDesignDate()}>Salvar data</Button>
        </> : <Button variant="secondary" onClick={() => setScheduleLead(null)}>Fechar</Button>}
      >
        {scheduleLead ? <div className="drawer-form">
          <Field label="Empresa" value={scheduleLead.alternativeName || scheduleLead.company} readOnly />
          <Field label="Estágio atual" value={COMMERCIAL_STAGE_LABELS[scheduleLead.commercialStage ?? 'aguardando_resposta']} readOnly />
          {(scheduleLead.commercialStage ?? 'aguardando_resposta') === 'aguardando_design' ? <>
            <Field label="Enviar design até" type="date" value={designDueDate} onChange={setDesignDueDateDraft} min={todayInputValue()} />
            <div className="drawer-help-text">A data é opcional. Se não quiser agendar agora, deixe em branco e defina depois pela coluna Envio previsto ou pelo ícone de edição.</div>
          </> : <Field label="Envio previsto do design" value={scheduleLead.designDueDate ? formatDateOnly(scheduleLead.designDueDate) : '—'} readOnly />}
        </div> : null}
      </Drawer>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
