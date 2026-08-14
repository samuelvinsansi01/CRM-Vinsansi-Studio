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
import type { LeadCycleDetailsInput, LeadCycleLead } from '../services/lead-cycle/types';
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
  metricLabel: string;
  icon?: typeof Users;
};

const sourceDefinitions: SourceDefinition[] = [
  { id: SOURCE_NO_SITE, label: 'Sem site', metricLabel: 'WhatsApp', icon: MessageCircle },
  { id: SOURCE_OWN_SITE, label: 'Domínio próprio', metricLabel: 'Com site', icon: Globe2 },
  { id: SOURCE_AGGREGATOR, label: 'Agregador', metricLabel: 'Agregador' },
  { id: SOURCE_INSTAGRAM, label: 'Instagram', metricLabel: 'Instagram', icon: Instagram },
];

const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Empresa', width: '22%' },
  { key: 'source', label: 'Origem', width: '11%' },
  { key: 'branch', label: 'Ramo', width: '15%' },
  { key: 'location', label: 'Localização', width: '17%' },
  { key: 'phone', label: 'WhatsApp', width: '8%' },
  { key: 'instagram', label: 'Instagram', width: '10%' },
  { key: 'status', label: 'Status', width: '9%' },
  { key: 'channel', label: 'Destino', width: '8%' },
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

const emptyLeadDetails: LeadCycleDetailsInput = {
  company: '',
  channel: 'WhatsApp',
  rawPhone: '',
  whatsapp: '',
  instagram: '',
  website: '',
  mapsUrl: '',
};

function detailsFromLead(lead: LeadCycleLead): LeadCycleDetailsInput {
  return {
    company: lead.company,
    channel: lead.channel,
    rawPhone: lead.rawPhone,
    whatsapp: lead.whatsapp,
    instagram: lead.instagram,
    website: lead.website,
    mapsUrl: lead.mapsUrl,
  };
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
  const [editingLead, setEditingLead] = useState<LeadCycleLead | null>(null);
  const [leadDraft, setLeadDraft] = useState<LeadCycleDetailsInput>(emptyLeadDetails);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [approvingInstagram, setApprovingInstagram] = useState(false);
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

  useEffect(() => {
    setSelectedRows([]);
  }, [page, rowsPerPage, search, status, source, branch, state]);

  const selectedLeadIds = selectedRows.map((index) => pageItems[index]?.id).filter(Boolean);
  const selectedLeads = selectedLeadIds
    .map((id) => allRecords.find((lead) => lead.id === id))
    .filter((lead): lead is LeadCycleLead => Boolean(lead));
  const selectedInstagramReady = selectedLeads.filter((lead) =>
    lead.statusId === 1
    && lead.channel === 'Instagram'
    && isValidInstagram(normalizeInstagramUsername(lead.instagram))
  );

  const approveSelectedInstagram = async () => {
    if (!selectedInstagramReady.length) {
      toast('Nada para aprovar', 'Selecione leads Importados com destino Instagram e @Instagram válido.', 'warning');
      return;
    }
    setApprovingInstagram(true);
    try {
      const result = await imported.executeRoutingCommand('route-imported-to-instagram', selectedInstagramReady.map((lead) => lead.id));
      setSelectedRows([]);
      await refresh();
      const ignored = selectedLeads.length - selectedInstagramReady.length;
      const parts = [`${result.succeeded + result.unchanged} lead(s) aprovado(s) para Instagram`];
      if (ignored) parts.push(`${ignored} selecionado(s) incompatível(is) ignorado(s)`);
      if (result.failed) parts.push(`${result.failed} falha(s)`);
      toast(
        result.failed ? 'Aprovação Instagram concluída com pendências' : 'Leads Instagram aprovados',
        `${parts.join(', ')}.${result.failures[0] ? ` ${result.failures[0].reason}` : ''}`,
        result.failed ? 'warning' : 'success',
      );
    } catch (err) {
      toast('Não foi possível aprovar Instagram', err instanceof Error ? err.message : 'Tente novamente.', 'danger');
    } finally {
      setApprovingInstagram(false);
    }
  };

  const handleRowAction = (action: TableAction, row: Row) => {
    if (action !== 'edit') return;
    const lead = allRecords.find((item) => item.id === row.id);
    if (!lead) return;
    setEditingLead(lead);
    setLeadDraft(detailsFromLead(lead));
  };

  const updateLeadDraft = <K extends keyof LeadCycleDetailsInput,>(field: K, value: LeadCycleDetailsInput[K]) => {
    setLeadDraft((current) => ({ ...current, [field]: value }));
  };

  const cycleForLead = (lead: LeadCycleLead) => {
    if (lead.statusId === 1) return imported;
    if (lead.statusId === 2) return valid;
    return preSend;
  };

  const saveLeadDetails = async () => {
    if (!editingLead) return;
    try {
      await cycleForLead(editingLead).updateDetails(editingLead, leadDraft);
      setEditingLead(null);
      setLeadDraft(emptyLeadDetails);
      toast('Lead atualizado', 'Os dados e o destino do lead foram salvos sem avançar o status.');
    } catch (err) {
      toast('Não foi possível atualizar', err instanceof Error ? err.message : 'Revise os dados informados.', 'danger');
    }
  };

  const approveEditingInstagram = async () => {
    if (!editingLead || editingLead.statusId !== 1 || editingLead.channel !== 'Instagram') return;
    try {
      const updated = await imported.updateDetails(editingLead, leadDraft);
      const result = await imported.executeRoutingCommand('route-imported-to-instagram', [updated.id]);
      if (result.succeeded === 1 || result.unchanged === 1) {
        setEditingLead(null);
        setLeadDraft(emptyLeadDetails);
        toast('Lead aprovado', 'Instagram confirmado manualmente; o status avançou para Validado.');
      } else {
        toast('Aprovação não concluída', result.failures[0]?.reason || 'Atualize a página e tente novamente.', 'warning');
      }
    } catch (err) {
      toast('Aprovação não concluída', err instanceof Error ? err.message : 'Revise os dados e tente novamente.', 'warning');
    }
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
            label={metric.metricLabel}
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
        {selectedRows.length ? (
          <div className="lead-bulk-actions">
            <span>
              {selectedRows.length} selecionado(s) · {selectedInstagramReady.length} pronto(s) para aprovação Instagram
            </span>
            <Button
              size="sm"
              iconLeft={Instagram}
              loading={approvingInstagram}
              disabled={!selectedInstagramReady.length || approvingInstagram}
              onClick={() => void approveSelectedInstagram()}
            >
              Aprovar Instagram ({selectedInstagramReady.length})
            </Button>
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando leads...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead encontrado para os filtros selecionados.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable
            columns={columns}
            rows={pageItems}
            actions={['edit']}
            actionsLabel="Ações"
            onAction={(action, row) => handleRowAction(action, row)}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
          />
        ) : null}
      </TableCard>
      <Drawer
        open={Boolean(editingLead)}
        title="Editar lead"
        description="Consulte e corrija os dados do lead. O destino pode ser alterado manualmente sem avançar o status."
        onClose={() => { setEditingLead(null); setLeadDraft(emptyLeadDetails); }}
        footer={(
          <>
            <Button variant="secondary" onClick={() => { setEditingLead(null); setLeadDraft(emptyLeadDetails); }}>Cancelar</Button>
            {editingLead?.statusId === 1
              && leadDraft.channel === 'Instagram'
              && isValidInstagram(normalizeInstagramUsername(leadDraft.instagram)) ? (
                <Button variant="secondary" loading={imported.saving} onClick={() => void approveEditingInstagram()}>
                  Salvar e aprovar Instagram
                </Button>
              ) : null}
            <Button loading={imported.saving || valid.saving || preSend.saving} onClick={() => void saveLeadDetails()}>Salvar</Button>
          </>
        )}
      >
        {editingLead ? (
          <div className="drawer-form validation-routing__edit-form">
            <Field label="Empresa" value={leadDraft.company} onChange={(value) => updateLeadDraft('company', value)} />
            <Field label="Origem" value={sourceName(editingLead)} readOnly />
            <Field label="Ramo" value={editingLead.branch || '-'} readOnly />
            <Field label="Localização" value={[editingLead.city, editingLead.state].filter(Boolean).join(' / ') || '-'} readOnly />
            <Field label="Telefone" value={leadDraft.rawPhone} onChange={(value) => updateLeadDraft('rawPhone', value)} />
            <Field label="WhatsApp" value={leadDraft.whatsapp} onChange={(value) => updateLeadDraft('whatsapp', value)} />
            <Field label="Instagram" placeholder="@empresa ou https://instagram.com/empresa" value={leadDraft.instagram} onChange={(value) => updateLeadDraft('instagram', value)} />
            <Field label="Site" value={leadDraft.website} onChange={(value) => updateLeadDraft('website', value)} />
            <Field label="Google Maps" value={leadDraft.mapsUrl} onChange={(value) => updateLeadDraft('mapsUrl', value)} />
            <Field label="Status" value={editingLead.status} readOnly />
            {editingLead.statusId === 3 ? (
              <Field label="Destino" value={editingLead.channel} readOnly />
            ) : (
              <label className="drawer-field">
                <span>Destino</span>
                <SelectField
                  value={leadDraft.channel}
                  options={['WhatsApp', 'Instagram']}
                  placeholder="Destino"
                  onChange={(value) => updateLeadDraft('channel', value as LeadCycleLead['channel'])}
                />
              </label>
            )}
          </div>
        ) : null}
      </Drawer>
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
