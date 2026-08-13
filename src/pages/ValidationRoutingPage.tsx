import { CheckCircle2, Globe2, Instagram, MessageCircle, RefreshCcw, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  Drawer,
  Field,
  FiltersBar,
  MetricCard,
  SearchInput,
  SelectField,
  RowsPerPageControl,
  TableCard,
  Tag,
  ToastViewport,
  type TableColumn,
  type TableAction,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useClientPagination } from '../hooks/useClientPagination';
import { useLeadCycle } from '../hooks/useLeadCycle';
import { useQueuePreparation } from '../hooks/useQueuePreparation';
import type { LeadCycleLead } from '../services/lead-cycle/types';
import { whatsappCapacityValidationService } from '../services/whatsapp-validation/whatsappCapacityValidation.service';
import type { WhatsAppCapacityValidationResult } from '../services/whatsapp-validation/whatsappCapacityValidation.service';
import { toLocalDateInputValue } from '../utils/date';
import { isValidInstagram, normalizeInstagramUsername } from '../services/instagram/instagram.utils';

const SOURCE_NO_SITE = 1;
const SOURCE_OWN_SITE = 2;
const SOURCE_AGGREGATOR = 3;
const SOURCE_INSTAGRAM = 4;

type StatusFilter = 'Todos' | 'Importado' | 'Aguardando validação' | 'Validado';
type SourceFilter = 'Todos' | 'Sem site' | 'Domínio próprio' | 'Agregador' | 'Instagram';
type Row = Record<string, ReactNode> & { id: string };

type SourceDefinition = {
  id: number;
  label: Exclude<SourceFilter, 'Todos'>;
  icon?: typeof Users;
};

const sourceDefinitions: SourceDefinition[] = [
  { id: SOURCE_NO_SITE, label: 'Sem site', icon: MessageCircle },
  { id: SOURCE_OWN_SITE, label: 'Domínio próprio', icon: Globe2 },
  { id: SOURCE_AGGREGATOR, label: 'Agregador' },
  { id: SOURCE_INSTAGRAM, label: 'Instagram', icon: Instagram },
];

const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Empresa', width: '21%' },
  { key: 'source', label: 'Origem', width: '14%' },
  { key: 'status', label: 'Status', width: '11%' },
  { key: 'branch', label: 'Ramo', width: '14%' },
  { key: 'location', label: 'Localização', width: '14%' },
  { key: 'phone', label: 'WhatsApp', width: '9%' },
  { key: 'instagram', label: 'Instagram', width: '9%' },
  { key: 'channel', label: 'Destino', width: '10%' },
];

function sourceName(lead: LeadCycleLead): Exclude<SourceFilter, 'Todos'> {
  if (lead.contactSourceId === SOURCE_OWN_SITE) return 'Domínio próprio';
  if (lead.contactSourceId === SOURCE_AGGREGATOR) return 'Agregador';
  if (lead.contactSourceId === SOURCE_INSTAGRAM) return 'Instagram';
  return 'Sem site';
}

function statusTag(lead: LeadCycleLead) {
  if (lead.statusId === 2) return <Tag tone="success">Validado</Tag>;
  if (lead.statusId === 3) return <Tag tone="warning">Aguardando validação</Tag>;
  return <Tag tone="neutral">Importado</Tag>;
}

function channelTag(lead: LeadCycleLead) {
  return <Tag tone={lead.channelId === 2 ? 'primary' : 'success'}>{lead.channel}</Tag>;
}

function contactValue(value: string) {
  return value.trim() ? 'Sim' : 'Não';
}

function capacityValidationDescription(result: WhatsAppCapacityValidationResult) {
  const parts = [
    `${result.queued} lead(s) incluído(s) na fila`,
    `${result.approved} WhatsApp(s) confirmado(s)`,
  ];
  if (result.alreadyValidatedQueued) parts.push(`${result.alreadyValidatedQueued} já validado(s) aproveitado(s)`);
  if (result.invalidated) parts.push(`${result.invalidated} invalidado(s)`);
  if (result.redirectedToInstagram) parts.push(`${result.redirectedToInstagram} redirecionado(s) ao Instagram`);
  if (result.errors) parts.push(`${result.errors} erro(s) de validação`);
  if (result.queueFailures) parts.push(`${result.queueFailures} falha(s) de fila`);
  let description = `${parts.join(', ')}. ${result.remainingCapacity} vaga(s) restante(s) em ${result.effectiveDate}.`;
  if (result.exhaustedCandidates) description += ' A base elegível terminou antes de completar a capacidade.';
  if (result.failures[0]) description += ` ${result.failures[0].reason}`;
  return description;
}

export function ValidationRoutingPage() {
  const imported = useLeadCycle('imported');
  const valid = useLeadCycle('valid');
  const preSend = useLeadCycle('pre-send');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('Importado');
  const [source, setSource] = useState<SourceFilter>('Todos');
  const [branch, setBranch] = useState('Todos');
  const [state, setState] = useState('Todos');
  const [selectedChip, setSelectedChip] = useState('');
  const [validatingCapacity, setValidatingCapacity] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [editingInstagramLead, setEditingInstagramLead] = useState<LeadCycleLead | null>(null);
  const [instagramDraft, setInstagramDraft] = useState('');
  const operationalDate = toLocalDateInputValue();
  const chipCapacity = useQueuePreparation('WhatsApp', operationalDate, selectedChip);

  const allRecords = useMemo(() => [...imported.records, ...preSend.records, ...valid.records], [imported.records, preSend.records, valid.records]);
  const loading = imported.loading || preSend.loading || valid.loading;
  const error = imported.error || preSend.error || valid.error;

  const refresh = async () => {
    await Promise.all([imported.refresh(), preSend.refresh(), valid.refresh(), chipCapacity.refresh()]);
  };

  useEffect(() => {
    const resources = chipCapacity.snapshot?.resources ?? [];
    if (resources.some((resource) => resource.id === selectedChip)) return;
    setSelectedChip(resources[0]?.id ?? '');
  }, [chipCapacity.snapshot?.resources, selectedChip]);

  const toast = (title: string, description: string, tone: ToastItem['tone'] = 'success') => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, title, description, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5200);
  };

  const validateToCapacity = async () => {
    if (!selectedChip) {
      toast('Selecione um chip', 'Somente chips ativos e conectados podem validar e receber leads.', 'warning');
      return;
    }
    setValidatingCapacity(true);
    try {
      const result = await whatsappCapacityValidationService.validateAndFill(selectedChip, operationalDate);
      await refresh();
      const warning = result.errors || result.conflicts || result.queueFailures || result.remainingCapacity > 0;
      toast(
        warning ? 'Validação concluída com pendências' : 'Capacidade do chip preenchida',
        capacityValidationDescription(result),
        warning ? 'warning' : 'success',
      );
    } catch (err) {
      await refresh();
      toast('Não foi possível validar', err instanceof Error ? err.message : 'Tente novamente.', 'danger');
    } finally {
      setValidatingCapacity(false);
    }
  };

  const branches = useMemo(
    () => ['Todos', ...Array.from(new Set(allRecords.map((lead) => lead.branch).filter(Boolean))).sort()],
    [allRecords],
  );
  const states = useMemo(
    () => ['Todos', ...Array.from(new Set(allRecords.map((lead) => lead.state).filter(Boolean))).sort()],
    [allRecords],
  );

  const sourceMetrics = useMemo(() => sourceDefinitions.map((definition) => {
    const sourceRecords = allRecords.filter((lead) => lead.contactSourceId === definition.id);
    const validCount = sourceRecords.filter((lead) => lead.statusId === 2).length;
    return { ...definition, total: sourceRecords.length, valid: validCount };
  }), [allRecords]);

  const totalValid = valid.records.length;
  const totalRecords = allRecords.length;

  const visible = useMemo(() => allRecords.filter((lead) => {
    const query = search.trim().toLowerCase();
    const matchesStatus = status === 'Todos'
      || (status === 'Importado' && lead.statusId === 1)
      || (status === 'Aguardando validação' && lead.statusId === 3)
      || (status === 'Validado' && lead.statusId === 2);
    const matchesSource = source === 'Todos' || sourceName(lead) === source;
    const matchesSearch = !query
      || lead.company.toLowerCase().includes(query)
      || lead.phone.toLowerCase().includes(query)
      || lead.instagram.toLowerCase().includes(query);

    return matchesStatus
      && matchesSource
      && matchesSearch
      && (branch === 'Todos' || lead.branch === branch)
      && (state === 'Todos' || lead.state === state);
  }), [allRecords, branch, search, source, state, status]);

  const rows = useMemo<Row[]>(() => visible.map((lead) => ({
    id: lead.id,
    company: lead.company,
    source: sourceName(lead),
    status: statusTag(lead),
    branch: lead.branch || '-',
    location: [lead.city, lead.state].filter(Boolean).join(' / ') || '-',
    phone: contactValue(lead.phone),
    instagram: lead.channel === 'Instagram' && lead.statusId === 1
      ? (isValidInstagram(normalizeInstagramUsername(lead.instagram)) ? 'Pronto para aprovar' : lead.instagram.trim() ? 'Corrigir Instagram' : 'Adicionar Instagram')
      : contactValue(lead.instagram),
    channel: channelTag(lead),
  })), [visible]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);

  const rowActions = (row: Row): TableAction[] => {
    const lead = allRecords.find((item) => item.id === row.id);
    if (!lead || lead.statusId !== 1 || lead.channel !== 'Instagram') return [];
    return isValidInstagram(normalizeInstagramUsername(lead.instagram)) ? ['edit', 'approve'] : ['edit'];
  };

  const handleRowAction = async (action: TableAction, row: Row) => {
    const lead = allRecords.find((item) => item.id === row.id);
    if (!lead) return;
    if (action === 'edit') {
      setEditingInstagramLead(lead);
      setInstagramDraft(lead.instagram);
      return;
    }
    if (action === 'approve') {
      const result = await imported.executeRoutingCommand('route-imported-to-instagram', [lead.id]);
      if (result.succeeded === 1) toast('Lead aprovado', 'Instagram confirmado manualmente; o status avançou para Validado.');
      else toast('Aprovação não concluída', result.failures[0]?.reason || 'Atualize a página e tente novamente.', 'warning');
    }
  };

  const saveInstagram = async () => {
    if (!editingInstagramLead) return;
    try {
      await imported.updateImportedInstagram(editingInstagramLead.id, instagramDraft);
      setEditingInstagramLead(null);
      toast('Instagram atualizado', 'O formato foi validado. Use Aprovar para avançar o status.');
    } catch (err) { toast('Instagram inválido', err instanceof Error ? err.message : 'Revise o perfil informado.', 'danger'); }
  };

  return (
    <div className="dashboard-table-page lead-list-page validation-routing-page">
      <PageHeader
        title="Validação e roteamento"
        description="Consulte, roteie e valide leads respeitando a capacidade diária do chip selecionado."
        action={(
          <div className="validation-routing__header-actions">
            <Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || validatingCapacity} onClick={() => void refresh()}>
              Atualizar
            </Button>
            <SelectField
              className="validation-routing__chip-select"
              value={selectedChip}
              placeholder={chipCapacity.loading ? 'Carregando chips...' : 'Selecionar chip ativo'}
              options={(chipCapacity.snapshot?.resources ?? []).map((resource) => ({
                value: resource.id,
                label: `${resource.label} — ${resource.used}/${resource.dailyLimit} • ${resource.available} vagas`,
              }))}
              onChange={setSelectedChip}
            />
            <Button
              iconLeft={CheckCircle2}
              loading={validatingCapacity}
              disabled={loading || chipCapacity.loading || !selectedChip || (chipCapacity.snapshot?.selectedResource?.available ?? 0) <= 0}
              onClick={() => void validateToCapacity()}
            >
              Validar e preencher
            </Button>
          </div>
        )}
      />

      <section className="metric-grid metric-grid--5">
        <MetricCard icon={Users} value={`${totalValid} / ${totalRecords}`} label="Válidos / Total" tone="neutral" />
        {sourceMetrics.map((metric) => (
          <MetricCard
            icon={metric.icon}
            key={metric.id}
            value={`${metric.valid} / ${metric.total}`}
            label={`Válidos / Total — ${metric.label}`}
            tone={metric.id === SOURCE_INSTAGRAM ? 'primary' : metric.id === SOURCE_NO_SITE ? 'success' : 'neutral'}
          />
        ))}
      </section>

      <FiltersBar>
        <SelectField value={status} options={['Todos', 'Importado', 'Aguardando validação', 'Validado']} placeholder="Status" onChange={(value) => { setStatus(value as StatusFilter); resetPage(); }} />
        <SelectField value={source} options={['Todos', 'Sem site', 'Domínio próprio', 'Agregador', 'Instagram']} placeholder="Origem" onChange={(value) => { setSource(value as SourceFilter); resetPage(); }} />
        <SelectField value={branch} options={branches} placeholder="Ramo" onChange={(value) => { setBranch(value); resetPage(); }} />
        <SelectField value={state} options={states} placeholder="Estado" onChange={(value) => { setState(value); resetPage(); }} />
        <SearchInput value={search} placeholder="Buscar empresa ou contato" onChange={(value) => { setSearch(value); resetPage(); }} />
      </FiltersBar>

      <TableCard
        title="Leads disponíveis"
        footerText={`Mostrando ${pageItems.length} de ${rows.length} lead(s)`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando leads...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead encontrado para os filtros selecionados.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable columns={columns} rows={pageItems} actions={[]} getRowActions={rowActions} onAction={(action, row) => void handleRowAction(action, row)} selectable={false} />
        ) : null}
      </TableCard>
      <Drawer open={Boolean(editingInstagramLead)} title="Corrigir Instagram" description="O status permanece Importado até a aprovação manual." onClose={() => setEditingInstagramLead(null)} footer={<Button loading={imported.saving} onClick={() => void saveInstagram()}>Salvar Instagram</Button>}>
        <Field label="Instagram" placeholder="@empresa ou https://instagram.com/empresa" value={instagramDraft} onChange={setInstagramDraft} />
      </Drawer>
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
