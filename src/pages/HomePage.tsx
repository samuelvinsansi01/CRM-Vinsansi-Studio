import { Archive, Globe2, Instagram, MessageCircle, RefreshCcw, Users, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  FiltersBar,
  MetricCard,
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
import { useLeadCycle } from '../hooks/useLeadCycle';
import type { LeadCycleLead, LeadRoutingCommand, LeadRoutingResult } from '../services/lead-cycle/types';

const SOURCE_NO_SITE = 1;
const SOURCE_OWN_SITE = 2;
const SOURCE_AGGREGATOR = 3;
const SOURCE_INSTAGRAM = 4;

type ImportedCardBucket = 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';

function importedCardBucket(lead: LeadCycleLead): ImportedCardBucket {
  if (lead.contactSourceId === SOURCE_INSTAGRAM || Boolean(lead.instagram.trim())) return 'Instagram';
  if (lead.contactSourceId === SOURCE_AGGREGATOR) return 'Agregadores';
  if (lead.contactSourceId === SOURCE_OWN_SITE) return 'Com site';
  if (lead.contactSourceId === SOURCE_NO_SITE || lead.phone.trim()) return 'WhatsApp';
  return 'WhatsApp';
}

type Row = Record<string, ReactNode> & { id: string };

const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Nome da empresa', width: '25%' },
  { key: 'branch', label: 'Ramo', width: '16%' },
  { key: 'state', label: 'Estado', width: '9%' },
  { key: 'city', label: 'Cidade', width: '13%' },
  { key: 'phone', label: 'WhatsApp', width: '11%' },
  { key: 'instagram', label: 'Instagram', width: '11%' },
  { key: 'channel', label: 'Canal', width: '10%' },
];

function hasValue(value: string) { return value.trim() ? 'Sim' : 'Não'; }
function channelTag(lead: LeadCycleLead) {
  return <Tag tone={lead.channelId === 2 ? 'primary' : 'success'}>{lead.channel}</Tag>;
}

function resultDescription(result: LeadRoutingResult) {
  const parts = [`${result.succeeded} atualizado(s)`];
  if (result.unchanged) parts.push(`${result.unchanged} já estava(m) correto(s)`);
  if (result.failed) parts.push(`${result.failed} não processado(s)`);
  let description = `${parts.join(', ')}.`;
  if (result.failures[0]) description += ` ${result.failures[0].reason}`;
  if (result.auditWarnings.length) description += ' A alteração foi salva, mas houve aviso na auditoria.';
  return description;
}

export function HomePage({ mode = 'home' }: { mode?: 'home' | 'valid' }) {
  const validPage = mode === 'valid';
  const importedCycle = useLeadCycle('imported');
  const validCycle = useLeadCycle('valid');
  const activeCycle = validPage ? validCycle : importedCycle;
  const { records, loading, saving, error, executeRoutingCommand } = activeCycle;
  const refresh = async () => {
    await Promise.all([importedCycle.refresh(), validCycle.refresh()]);
  };
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('Todos');
  const [branch, setBranch] = useState('Todos');
  const [state, setState] = useState('Todos');
  const [destination, setDestination] = useState('Todos');
  const [instagramFilter, setInstagramFilter] = useState('Todos');
  const [siteFilter, setSiteFilter] = useState('Todos');
  const [statusFilter, setStatusFilter] = useState('Importado');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const branches = useMemo(() => ['Todos', ...Array.from(new Set(records.map((lead) => lead.branch).filter(Boolean))).sort()], [records]);
  const states = useMemo(() => ['Todos', ...Array.from(new Set(records.map((lead) => lead.state).filter(Boolean))).sort()], [records]);
  const matchesDestination = (lead: LeadCycleLead) => destination === 'Todos' || importedCardBucket(lead) === destination;
  const visible = useMemo(() => records.filter((lead) => {
    const query = search.trim().toLowerCase();
    const instagramOk = instagramFilter === 'Todos' || (instagramFilter === 'Com Instagram' ? Boolean(lead.instagram.trim()) : !lead.instagram.trim());
    const siteOk = siteFilter === 'Todos' || (siteFilter === 'Com site' ? Boolean(lead.website.trim()) : !lead.website.trim());
    const statusOk = validPage || statusFilter === 'Todos' || statusFilter === 'Importado';
    return (!query || lead.company.toLowerCase().includes(query))
      && (channel === 'Todos' || lead.channel === channel)
      && (branch === 'Todos' || lead.branch === branch)
      && (validPage || state === 'Todos' || lead.state === state)
      && (validPage || matchesDestination(lead))
      && (validPage || instagramOk)
      && (validPage || siteOk)
      && statusOk;
  }), [records, search, channel, branch, state, destination, instagramFilter, siteFilter, statusFilter, validPage]);

  const rows = useMemo<Row[]>(() => visible.map((lead) => ({
    id: lead.id,
    company: lead.company,
    branch: lead.branch || '-',
    state: lead.state || '-',
    city: lead.city || '-',
    phone: hasValue(lead.phone),
    instagram: hasValue(lead.instagram),
    channel: channelTag(lead),
  })), [visible]);

  const selectedIds = selectedRows.map((index) => rows[index]?.id).filter(Boolean);

  const toast = (title: string, description: string, tone: ToastItem['tone'] = 'success') => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, title, description, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  };

  const runRoutingCommand = async (command: LeadRoutingCommand, ids: string[], successTitle: string) => {
    try {
      const result = await executeRoutingCommand(command, ids);
      if (result.succeeded || result.unchanged) setSelectedRows([]);

      if (!result.failed) {
        toast(successTitle, resultDescription(result), result.auditWarnings.length ? 'warning' : 'success');
      } else if (result.succeeded || result.unchanged) {
        toast('Ação concluída parcialmente', resultDescription(result), 'warning');
      } else {
        toast('Não foi possível concluir', resultDescription(result), 'danger');
      }
      return result;
    } catch (err) {
      toast('Não foi possível concluir', err instanceof Error ? err.message : 'Tente novamente.', 'danger');
      return null;
    }
  };

  const handleAction = async (action: TableAction, row: Row) => {
    if (!validPage) {
      if (action === 'whatsapp') await runRoutingCommand('route-imported-to-whatsapp', [row.id], 'Lead enviado ao Pré-Envio');
      if (action === 'instagram') await runRoutingCommand('route-imported-to-instagram', [row.id], 'Lead validado para Instagram');
      if (action === 'invalidate') await runRoutingCommand('invalidate-imported', [row.id], 'Lead invalidado');
      if (action === 'archive') await runRoutingCommand('archive-imported', [row.id], 'Lead arquivado');
      return;
    }
    if (action === 'whatsapp') await runRoutingCommand('set-valid-channel-whatsapp', [row.id], 'Canal atualizado');
    if (action === 'instagram') await runRoutingCommand('set-valid-channel-instagram', [row.id], 'Canal atualizado');
    if (action === 'archive') await runRoutingCommand('archive-valid', [row.id], 'Lead arquivado');
  };

  const total = records.length;
  const importedBuckets = useMemo(() => {
    const counts: Record<ImportedCardBucket, number> = {
      WhatsApp: 0,
      'Com site': 0,
      Agregadores: 0,
      Instagram: 0,
    };
    records.forEach((lead) => { counts[importedCardBucket(lead)] += 1; });
    return counts;
  }, [records]);
  const whatsapp = validPage
    ? records.filter((lead) => lead.channelId === 1).length
    : importedBuckets.WhatsApp;
  const instagram = validPage
    ? records.filter((lead) => lead.channelId === 2).length
    : importedBuckets.Instagram;
  const ownSite = importedBuckets['Com site'];
  const aggregators = importedBuckets.Agregadores;

  return (
    <div className="dashboard-table-page lead-list-page">
      <PageHeader
        title={validPage ? 'Válidos' : 'Início'}
        description={validPage ? 'Leads aprovados e prontos para entrar em fila.' : 'Entrada do ciclo: triagem dos leads importados.'}
        action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || saving} onClick={() => void refresh()}>Atualizar</Button>}
      />

      <section className={`metric-grid ${validPage ? 'metric-grid--3' : 'metric-grid--5'}`}>
        <MetricCard icon={Users} value={String(total)} label="Total" />
        <MetricCard icon={MessageCircle} value={String(whatsapp)} label="WhatsApp" tone="success" />
        {validPage ? <MetricCard icon={Instagram} value={String(instagram)} label="Instagram" tone="primary" /> : null}
        {!validPage ? <MetricCard icon={Globe2} value={String(ownSite)} label="Com site" /> : null}
        {!validPage ? <MetricCard value={String(aggregators)} label="Agregadores" /> : null}
        {!validPage ? <MetricCard icon={Instagram} value={String(instagram)} label="Instagram" tone="primary" /> : null}
      </section>

      <FiltersBar>
        {validPage ? (
          <>
            <SelectField value={channel} options={['Todos', 'WhatsApp', 'Instagram']} placeholder="Canal" onChange={setChannel} />
            <SelectField value={branch} options={branches} placeholder="Ramo" onChange={setBranch} />
          </>
        ) : (
          <>
            <SelectField value={branch} options={branches} placeholder="Ramo" onChange={setBranch} />
            <SelectField value={state} options={states} placeholder="Estado" onChange={setState} />
            <SelectField value={destination} options={['Todos', 'WhatsApp', 'Com site', 'Agregadores', 'Instagram']} placeholder="Destino" onChange={setDestination} />
            <SelectField value={instagramFilter} options={['Todos', 'Com Instagram', 'Sem Instagram']} placeholder="Instagram" onChange={setInstagramFilter} />
            <SelectField value={siteFilter} options={['Todos', 'Com site', 'Sem site']} placeholder="Site" onChange={setSiteFilter} />
            <SelectField value={statusFilter} options={['Todos', 'Importado']} placeholder="Status" onChange={setStatusFilter} />
          </>
        )}
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar empresa" />
      </FiltersBar>

      <TableCard title={validPage ? 'Leads aprovados' : 'Leads importados'} footerText={loading ? 'Carregando...' : `${rows.length} lead(s).`}>
        {selectedIds.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedIds.length} selecionado(s)</span>
            {!validPage ? <Button size="sm" iconLeft={MessageCircle} disabled={saving} onClick={() => void runRoutingCommand('route-imported-to-whatsapp', selectedIds, 'Leads enviados ao Pré-Envio')}>Pré-Envio</Button> : null}
            {!validPage ? <Button size="sm" iconLeft={Instagram} disabled={saving} onClick={() => void runRoutingCommand('route-imported-to-instagram', selectedIds, 'Leads validados para Instagram')}>Validar Instagram</Button> : null}
            {validPage ? <Button size="sm" iconLeft={MessageCircle} disabled={saving} onClick={() => void runRoutingCommand('set-valid-channel-whatsapp', selectedIds, 'Canais atualizados')}>WhatsApp</Button> : null}
            {validPage ? <Button size="sm" iconLeft={Instagram} disabled={saving} onClick={() => void runRoutingCommand('set-valid-channel-instagram', selectedIds, 'Canais atualizados')}>Instagram</Button> : null}
            {!validPage ? <Button size="sm" variant="secondary" iconLeft={X} disabled={saving} onClick={() => void runRoutingCommand('invalidate-imported', selectedIds, 'Leads invalidados')}>Invalidar</Button> : null}
            <Button
              size="sm"
              variant="secondary"
              iconLeft={Archive}
              disabled={saving}
              onClick={() => void runRoutingCommand(validPage ? 'archive-valid' : 'archive-imported', selectedIds, 'Leads arquivados')}
            >
              Arquivar
            </Button>
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando leads...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum lead nesta etapa.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable
            columns={columns}
            rows={rows}
            actions={validPage ? ['whatsapp', 'instagram', 'archive'] : ['whatsapp', 'instagram', 'invalidate', 'archive']}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
