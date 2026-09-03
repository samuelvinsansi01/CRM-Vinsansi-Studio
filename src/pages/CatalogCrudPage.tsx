import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Database, Plus, RefreshCcw, SquareCheck, SquareX } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
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
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { useCatalogRecords } from '../hooks/useCatalogRecords';
import { useClientPagination } from '../hooks/useClientPagination';
import { syncEvolutionInstances } from '../services/evolution-instances/evolutionInstances.service';
import {
  listChannelOptions,
  isDeliveryChannelOption,
  type CatalogKind,
  type CatalogRecord,
  type ChannelOption,
  type ContactSourceRecord,
  type InstanceRecord,
  type LevelRecord,
  type TemplateChannelRecord,
  type TemplateTypeRecord,
} from '../repositories/configuration';

export type CatalogCrudPageProps = { kind: CatalogKind };

type FormValue = string | boolean | string[];
type FormState = Record<string, FormValue>;
type CatalogTableRow = Record<string, ReactNode> & { id: string };

type PageDefinition = {
  title: string;
  description: string;
  singular: string;
  tableTitle: string;
  emptyMessage: string;
};

const definitions: Record<CatalogKind, PageDefinition> = {
  contact_sources: {
    title: 'Fontes de contato',
    description: 'Gerencie as origens usadas para classificar leads e definir revisão e canal padrão.',
    singular: 'fonte de contato', tableTitle: 'Fontes cadastradas', emptyMessage: 'Nenhuma fonte de contato cadastrada.',
  },
  levels: {
    title: 'Níveis',
    description: 'Configure os limites diários que cada chip ou perfil remetente herda.',
    singular: 'nível', tableTitle: 'Níveis operacionais', emptyMessage: 'Nenhum nível cadastrado.',
  },
  instances: {
    title: 'Instâncias',
    description: 'Cadastre as credenciais das instâncias Evolution. O estado administrativo é separado da sessão e do socket do WhatsApp.',
    singular: 'instância', tableTitle: 'Instâncias cadastradas', emptyMessage: 'Nenhuma instância cadastrada.',
  },
  template_channels: {
    title: 'Canais de template',
    description: 'Organize os canais permitidos ou bloqueados para cada grupo de template.',
    singular: 'canal de template', tableTitle: 'Canais de template', emptyMessage: 'Nenhum canal de template cadastrado.',
  },
  template_types: {
    title: 'Tipos de template',
    description: 'Gerencie os tipos usados para classificar templates de mensagens.',
    singular: 'tipo de template', tableTitle: 'Tipos de template', emptyMessage: 'Nenhum tipo de template cadastrado.',
  },
};

const statusOptions = [
  { label: 'Ativo', value: '1' },
  { label: 'Inativo', value: '2' },
];
const yesNoOptions = [
  { label: 'Sim', value: 'true' },
  { label: 'Não', value: 'false' },
];
const filterStatusOptions = [
  { label: 'Todos', value: 'Todos' },
  { label: 'Ativos', value: 'Ativos' },
  { label: 'Inativos', value: 'Inativos' },
];

const booleanValue = (value: FormValue | undefined, fallback = false) => typeof value === 'boolean' ? value : String(value) === 'true' ? true : String(value) === 'false' ? false : fallback;
const stringValue = (value: FormValue | undefined) => Array.isArray(value) ? value.join(',') : String(value ?? '');

function initialForm(kind: CatalogKind, record?: CatalogRecord | null): FormState {
  if (!record) {
    if (kind === 'contact_sources') return { name: '', key: '', requiresReview: true, defaultChannelId: '', statusId: '1' };
    if (kind === 'levels') return { name: '', channelId: '1', dailyLimit: '1', queues: '', statusId: '1' };
    if (kind === 'instances') return { name: '', url: '', apiKey: '' };
    if (kind === 'template_channels') return { name: '', blockedChannelIds: [], statusId: '1' };
    if (kind === 'template_types') return { name: '', statusId: '1' };
    return { name: '', statusId: '1' };
  }

  if (record.kind === 'contact_sources') return {
    name: record.name, key: record.key, requiresReview: record.requiresReview,
    defaultChannelId: record.defaultChannelId, statusId: record.statusId,
  };
  if (record.kind === 'levels') return {
    name: record.name, channelId: record.channelId, dailyLimit: String(record.dailyLimit),
    queues: record.queues == null ? '' : String(record.queues), statusId: record.statusId,
  };
  if (record.kind === 'instances') return { name: record.name, url: record.url, apiKey: '' };
  if (record.kind === 'template_channels') return { name: record.name, blockedChannelIds: record.blockedChannelIds, statusId: record.statusId };
  if (record.kind === 'template_types') return { name: record.name, statusId: record.statusId };
  throw new Error('Tipo de catálogo não suportado.');
}

function FormSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <SelectField value={value} options={options} onChange={onChange} />
    </label>
  );
}

function statusTag(active: boolean, labels: { active: string; inactive: string } = { active: 'Ativo', inactive: 'Inativo' }) {
  return <Tag tone={active ? 'success' : 'warning'}>{active ? labels.active : labels.inactive}</Tag>;
}

function instanceOperationalTag(record: InstanceRecord) {
  if (record.operationalState === 'online') return <Tag tone="success">Conectado</Tag>;
  if (record.operationalState === 'reconnecting') return <Tag tone="warning">Reconectando</Tag>;
  if (record.operationalState === 'session_saved') return <Tag tone="primary">Sessão salva</Tag>;
  if (record.operationalState === 'unavailable') return <Tag tone="danger">Indisponível</Tag>;
  if (record.operationalState === 'disconnected') return <Tag tone="warning">Desconectado</Tag>;
  return <Tag tone="neutral">Não verificado</Tag>;
}

function columnsFor(kind: CatalogKind): TableColumn<CatalogTableRow>[] {
  if (kind === 'contact_sources') return [
    { key: 'name', label: 'Fonte', width: '24%' },
    { key: 'key', label: 'Chave', width: '20%' },
    { key: 'review', label: 'Exige revisão', width: '18%' },
    { key: 'channel', label: 'Canal padrão', width: '18%' },
    { key: 'status', label: 'Status', width: '12%' },
  ];
  if (kind === 'levels') return [
    { key: 'name', label: 'Nível', width: '28%' },
    { key: 'channel', label: 'Canal', width: '18%' },
    { key: 'limit', label: 'Limite diário', width: '18%' },
    { key: 'queues', label: 'Filas', width: '14%' },
    { key: 'status', label: 'Status', width: '12%' },
  ];
  if (kind === 'instances') return [
    { key: 'name', label: 'Instância', width: '26%' },
    { key: 'url', label: 'URL', width: '38%' },
    { key: 'credential', label: 'Credencial', width: '16%' },
    { key: 'status', label: 'WhatsApp', width: '18%' },
  ];
  if (kind === 'template_channels') return [
    { key: 'name', label: 'Canal de template', width: '34%' },
    { key: 'blocked', label: 'Canais bloqueados', width: '38%' },
    { key: 'status', label: 'Status', width: '16%' },
  ];
  if (kind === 'template_types') return [
    { key: 'name', label: 'Tipo de template', width: '70%' },
    { key: 'status', label: 'Status', width: '20%' },
  ];
  return [{ key: 'name', label: 'Item' }, { key: 'status', label: 'Status' }];
}

function rowFor(record: CatalogRecord, channels: ChannelOption[]): CatalogTableRow {
  const channelName = (id: string) => channels.find((channel) => channel.id === id)?.name ?? '—';
  if (record.kind === 'contact_sources') return {
    id: record.id, name: record.name, key: <code>{record.key}</code>,
    review: record.requiresReview ? 'Sim' : 'Não', channel: record.defaultChannelId ? channelName(record.defaultChannelId) : 'Nenhum',
    status: statusTag(record.active),
  };
  if (record.kind === 'levels') return {
    id: record.id, name: record.name, channel: record.channelName, limit: String(record.dailyLimit),
    queues: record.queues == null ? '—' : String(record.queues), status: statusTag(record.active),
  };
  if (record.kind === 'instances') return {
    id: record.id, name: record.name, url: record.url || '—', credential: <Tag tone="neutral">Não exibida</Tag>,
    status: <span title={record.runtimeError || (record.jid ? `JID: ${record.jid}` : undefined)}>{instanceOperationalTag(record)}</span>,
  };
  if (record.kind === 'template_channels') return {
    id: record.id, name: record.name, blocked: record.blockedChannelNames.length ? record.blockedChannelNames.join(', ') : 'Nenhum',
    status: statusTag(record.active),
  };
  if (record.kind === 'template_types') return { id: record.id, name: record.name, status: statusTag(record.active) };
  throw new Error('Tipo de catálogo não suportado.');
}

function CatalogForm({ kind, form, channels, onChange }: { kind: CatalogKind; form: FormState; channels: ChannelOption[]; onChange: (key: string, value: FormValue) => void }) {
  const channelOptions = [{ label: 'Nenhum', value: '' }, ...channels.map((item) => ({ label: item.name, value: item.id }))];
  const channelRequiredOptions = channels.map((item) => ({ label: item.name, value: item.id }));

  return (
    <div className="configuration-form-grid">
      <Field label="Nome" value={stringValue(form.name)} placeholder="Digite o nome" onChange={(value) => onChange('name', value)} />

      {kind === 'contact_sources' ? (
        <>
          <Field label="Chave técnica" value={stringValue(form.key)} placeholder="ex.: sem_site" onChange={(value) => onChange('key', value)} />
          <FormSelect label="Exige revisão manual" value={String(booleanValue(form.requiresReview, true))} options={yesNoOptions} onChange={(value) => onChange('requiresReview', value === 'true')} />
          <FormSelect label="Canal padrão" value={stringValue(form.defaultChannelId)} options={channelOptions} onChange={(value) => onChange('defaultChannelId', value)} />
        </>
      ) : null}

      {kind === 'levels' ? (
        <>
          <FormSelect label="Canal" value={stringValue(form.channelId)} options={channelRequiredOptions} onChange={(value) => onChange('channelId', value)} />
          <Field label="Limite diário por remetente" type="number" min="1" value={stringValue(form.dailyLimit)} onChange={(value) => onChange('dailyLimit', value)} />
          <Field label="Quantidade de filas/lotes" type="number" min="1" value={stringValue(form.queues)} placeholder="Opcional" onChange={(value) => onChange('queues', value)} />
        </>
      ) : null}

      {kind === 'instances' ? (
        <>
          <Field label="URL da instância" type="url" value={stringValue(form.url)} placeholder="https://..." onChange={(value) => onChange('url', value)} />
          <Field label="API key" type="password" value={stringValue(form.apiKey)} placeholder="Deixe vazio para manter a chave atual" autoComplete="new-password" onChange={(value) => onChange('apiKey', value)} />
          <p className="configuration-form-note">A chave não é exibida na listagem. Em edição, deixe o campo vazio para preservar a credencial atual. O cadastro permanece administrativamente ativo; sessão salva e socket conectado são sincronizados separadamente pela Evolution Go.</p>
        </>
      ) : null}

      {kind === 'template_channels' ? (
        <div className="configuration-form-section configuration-form-section--full">
          <strong>Canais bloqueados</strong>
          <div className="configuration-checkbox-grid">
            {channels.map((channel) => {
              const selected = Array.isArray(form.blockedChannelIds) && form.blockedChannelIds.includes(channel.id);
              return (
                <button
                  className={`configuration-check-card ${selected ? 'configuration-check-card--selected' : ''}`}
                  type="button"
                  key={channel.id}
                  aria-pressed={selected}
                  onClick={() => {
                    const current = Array.isArray(form.blockedChannelIds) ? form.blockedChannelIds : [];
                    onChange('blockedChannelIds', selected ? current.filter((id) => id !== channel.id) : [...current, channel.id]);
                  }}
                >
                  <span className={`checkbox ${selected ? 'checkbox--checked' : ''}`} />
                  {channel.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}


      {kind !== 'instances' ? (
        <FormSelect label="Status" value={stringValue(form.statusId) || '1'} options={statusOptions} onChange={(value) => onChange('statusId', value)} />
      ) : null}
    </div>
  );
}

export function CatalogCrudPage({ kind }: CatalogCrudPageProps) {
  const { hasPermission } = useOrganizationContext();
  const managePermission = kind === 'instances'
    ? 'whatsapp.instances.manage'
    : kind === 'template_channels' || kind === 'template_types'
      ? 'templates.manage'
      : 'settings.manage';
  const canManage = hasPermission(managePermission);
  const definition = definitions[kind];
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogRecord | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(kind));
  const [saving, setSaving] = useState(false);
  const [syncingInstances, setSyncingInstances] = useState(false);
  const [deleting, setDeleting] = useState<CatalogRecord | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const { records, filteredRecords, loading, refreshing, error, refresh, create, update, remove } = useCatalogRecords(kind, search, status);

  useEffect(() => {
    void listChannelOptions().then(setChannels).catch(() => setChannels([]));
  }, []);

  const deliveryChannels = useMemo(() => channels.filter(isDeliveryChannelOption), [channels]);
  const rows = useMemo(() => filteredRecords.map((record) => rowFor(record, channels)), [channels, filteredRecords]);
  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);
  const activeCount = records.filter((record) => record.active).length;
  const inactiveCount = records.length - activeCount;
  const instanceOnlineCount = kind === 'instances'
    ? records.filter((record): record is InstanceRecord => record.kind === 'instances' && record.socketConnected).length
    : 0;
  const instanceSavedCount = kind === 'instances'
    ? records.filter((record): record is InstanceRecord => record.kind === 'instances' && record.sessionSaved && !record.socketConnected).length
    : 0;

  const notify = (toast: Omit<ToastItem, 'id'>) => setToasts((current) => [...current, { ...toast, id: crypto.randomUUID() }]);
  const openCreate = () => {
    if (!canManage) return;
    setEditing(null);
    setForm(initialForm(kind));
    setDrawerOpen(true);
  };
  const openEdit = (record: CatalogRecord) => {
    setEditing(record);
    setForm(initialForm(kind, record));
    setDrawerOpen(true);
  };

  const syncInstances = async (showSuccess = true, instanceId?: string) => {
    setSyncingInstances(true);
    try {
      const result = await syncEvolutionInstances({ instanceId, configureWebhook: true });
      const webhookFailures = result.results.filter((item) => item.webhookError);
      if (webhookFailures.length) {
        notify({
          title: 'Status sincronizado com ressalvas',
          description: `${result.online} conectada(s), ${result.sessionSaved} com sessão salva e ${result.unavailable} indisponível(is). ${webhookFailures.length} webhook(s) não puderam ser configurados.`,
          tone: 'warning',
        });
      } else if (showSuccess) {
        notify({
          title: 'Evolution sincronizada',
          description: `${result.online} conectada(s), ${result.sessionSaved} com sessão salva e ${result.disconnected} desconectada(s).`,
          tone: 'success',
        });
      }
      return result;
    } catch (cause) {
      notify({
        title: 'Falha ao sincronizar a Evolution',
        description: cause instanceof Error ? cause.message : 'Erro inesperado.',
        tone: 'danger',
      });
      throw cause;
    } finally {
      setSyncingInstances(false);
    }
  };

  const save = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      if (editing) await update(editing.id, form);
      else await create(form);
      if (kind === 'instances') await syncInstances(false, editing?.id);
      setDrawerOpen(false);
      notify({
        title: editing ? 'Registro atualizado' : 'Registro criado',
        description: kind === 'instances'
          ? 'Credenciais salvas e conexão conferida na Evolution.'
          : `${definition.singular} salvo com sucesso.`,
        tone: 'success',
      });
    } catch (cause) {
      notify({ title: 'Não foi possível salvar', description: cause instanceof Error ? cause.message : 'Erro inesperado.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!canManage) return;
    if (!deleting) return;
    try {
      await remove(deleting.id);
      notify({ title: 'Registro excluído', description: `${definition.singular} removido.`, tone: 'success' });
    } catch (cause) {
      notify({ title: 'Exclusão bloqueada', description: cause instanceof Error ? cause.message : 'O registro pode estar em uso.', tone: 'danger' });
    } finally {
      setDeleting(null);
    }
  };

  const onAction = (action: TableAction, row: CatalogTableRow) => {
    const record = records.find((item) => item.id === row.id);
    if (!record) return;
    if (action === 'edit' || action === 'view') openEdit(record);
    if (action === 'delete') setDeleting(record);
  };

  return (
    <div className="config-table-page configuration-crud-page">
      <PageHeader
        title={definition.title}
        description={definition.description}
        action={canManage ? <Button iconLeft={Plus} size="lg" onClick={openCreate}>Adicionar {definition.singular}</Button> : undefined}
      />

      <section className="metric-grid metric-grid--3">
        <MetricCard icon={Database} value={String(records.length)} label="Total" />
        <MetricCard icon={SquareCheck} value={String(kind === 'instances' ? instanceOnlineCount : activeCount)} label={kind === 'instances' ? 'Conectadas' : 'Ativos'} tone="success" />
        <MetricCard icon={SquareX} value={String(kind === 'instances' ? instanceSavedCount : inactiveCount)} label={kind === 'instances' ? 'Sessão salva' : 'Inativos'} tone="warning" />
      </section>

      <FiltersBar>
        <SearchInput value={search} placeholder="Buscar registros" onChange={(value) => { setSearch(value); resetPage(); }} />
        <SelectField
          value={status}
          options={kind === 'instances'
            ? [{ label: 'Todos', value: 'Todos' }, { label: 'Conectados', value: 'Ativos' }, { label: 'Não conectados', value: 'Inativos' }]
            : filterStatusOptions}
          onChange={(value) => { setStatus(value); resetPage(); }}
        />
        <Button
          variant="secondary"
          iconLeft={RefreshCcw}
          loading={kind === 'instances' ? syncingInstances : refreshing}
          onClick={() => kind === 'instances' && canManage ? void syncInstances(true) : void refresh()}
        >
          {kind === 'instances' && canManage ? 'Sincronizar Evolution' : 'Atualizar'}
        </Button>
      </FiltersBar>

      <TableCard
        title={definition.tableTitle}
        footerText={`Mostrando ${pageItems.length} de ${filteredRecords.length} registro(s); ${records.length} no total.`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="configuration-state configuration-state--error">{error}</div> : null}
        {loading ? <div className="configuration-state">Carregando registros...</div> : null}
        {!loading && !error && !rows.length ? <div className="configuration-state">{definition.emptyMessage}</div> : null}
        {!loading && !error && rows.length ? (
          <DataTable<CatalogTableRow>
            rows={pageItems}
            columns={columnsFor(kind)}
            actions={canManage ? ['edit', 'delete'] : []}
            selectable={false}
            onAction={canManage ? onAction : undefined}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={drawerOpen}
        title={editing ? `Editar ${definition.singular}` : `Adicionar ${definition.singular}`}
        description={editing ? 'Altere os campos e salve.' : 'Preencha os campos para criar o registro.'}
        onClose={() => setDrawerOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>Cancelar</Button>
            <Button loading={saving} onClick={() => void save()}>Salvar</Button>
          </>
        )}
      >
        <CatalogForm kind={kind} form={form} channels={deliveryChannels} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} />
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Excluir ${definition.singular}?`}
        description="A exclusão será bloqueada pelo banco quando o registro estiver vinculado a outros dados."
        confirmLabel="Excluir"
        danger
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
