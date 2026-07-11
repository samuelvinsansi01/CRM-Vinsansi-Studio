import type { LucideIcon } from 'lucide-react';
import { Archive, Instagram, List, MessageSquare, PhoneCall, PhoneOff, Plus, RotateCcw, Send, Smartphone, SquareCheck, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  Button,
  ConfirmDialog,
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
import { useConfigRecords } from '../hooks/useConfigRecords';
import { useDispatchSettings } from '../hooks/useDispatchSettings';
import {
  DEFAULT_BRANCH_MIN_RATING,
  DEFAULT_BRANCH_MIN_REVIEWS,
  DEFAULT_TEMPLATE_MESSAGE_1,
  DEFAULT_TEMPLATE_MESSAGE_2,
} from '../services/config/config.seed';
import { CHIP_LEVEL_OPTIONS, chipLevelDefaults, chipStatusLabel, isOperationalWhatsAppChip } from '../services/config/chipOperational';
import type {
  BranchConfigRecord,
  ChipConfigRecord,
  ConfigKind,
  ConfigRecord,
  TemplateChannel,
  InstagramConfigRecord,
  TemplateConfigRecord,
  TemplateType,
} from '../services/config/types';

type DrawerMode = 'create' | 'view' | 'edit';
type SelectOption = { label: string; value: string };

type FieldDefinition = {
  key: string;
  label: string;
  type?: 'input' | 'select' | 'textarea';
  options?: Array<string | SelectOption>;
  placeholder?: string;
  description?: string;
};

type ScreenMetric = {
  icon: LucideIcon;
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  getValue: (records: ConfigRecord[]) => number | string;
};

type ScreenDefinition = {
  title: string;
  singular: string;
  action: string;
  table: string;
  metrics: ScreenMetric[];
  columns: TableColumn<ConfigTableRow>[];
  fields: FieldDefinition[];
  emptyMessage: string;
};

type ConfigTableRow = Record<string, ReactNode> & {
  id: string;
};

type ChipLevelPresetsMap = Record<string, Partial<{ dailyLimit: number; blockSize: number; intervalSeconds: number; batches: string[]; startTime: string; endTime: string }>>;

const statusOptions = [
  { label: 'Todos', value: 'Todos' },
  { label: 'Ativos', value: 'Ativos' },
  { label: 'Inativos', value: 'Inativos' },
  { label: 'Arquivados', value: 'Arquivados' },
];

const activeOptions = [
  { label: 'Ativo', value: 'Ativo' },
  { label: 'Inativo', value: 'Inativo' },
];

const imageRequirementOptions: SelectOption[] = [
  { label: 'Obrigatoria — bloquear sem imagem', value: 'true' },
  { label: 'Opcional — enviar somente texto', value: 'false' },
];

const templateTypeOptions: SelectOption[] = [
  { label: 'Sem site', value: 'sem-site' },
  { label: 'Com site', value: 'com-site' },
];

const templateChannelOptions: SelectOption[] = [
  { label: 'Geral', value: 'Geral' },
  { label: 'WhatsApp', value: 'WhatsApp' },
  { label: 'Instagram', value: 'Instagram' },
];

function isBranch(record: ConfigRecord): record is BranchConfigRecord {
  return record.kind === 'branches';
}

function isTemplate(record: ConfigRecord): record is TemplateConfigRecord {
  return record.kind === 'templates';
}

function isChip(record: ConfigRecord): record is ChipConfigRecord {
  return record.kind === 'chips';
}

function isInstagramProfile(record: ConfigRecord): record is InstagramConfigRecord {
  return record.kind === 'instagram';
}

function joinList(items: string[]) {
  return items.length ? items.join(', ') : '-';
}

function formatTemplateType(type: TemplateType) {
  const labels: Record<TemplateType, string> = {
    'sem-site': 'Sem site',
    'com-site': 'Com site',
  };
  return labels[type];
}

function isArchivedConfig(record: ConfigRecord) {
  return String(record.status ?? '').toLowerCase() === 'arquivado';
}

function statusTag(record: ConfigRecord) {
  if (isArchivedConfig(record)) return <Tag tone="neutral">Arquivado</Tag>;
  return <Tag tone={record.active ? 'success' : 'warning'}>{record.active ? 'Ativo' : 'Inativo'}</Tag>;
}

function chipStatusTag(record: ChipConfigRecord) {
  const label = chipStatusLabel(record);
  const tone = label === 'Ativo' ? 'success' : label === 'Arquivado' ? 'neutral' : 'danger';
  return <Tag tone={tone}>{label}</Tag>;
}

function toCsv(value: string[]) {
  return value.join(', ');
}

function branchOptions(branches: BranchConfigRecord[]): SelectOption[] {
  if (!branches.length) return [{ label: 'Cadastre um ramo primeiro', value: '' }];
  return branches.map((branch) => ({ label: branch.name, value: branch.id }));
}

function optionLabel(options: FieldDefinition['options'], value: string) {
  const option = options?.find((item) => (typeof item === 'string' ? item === value : item.value === value));
  if (!option) return value;
  return typeof option === 'string' ? option : option.label;
}

function branchDisplayName(branches: BranchConfigRecord[], branchId?: string, fallback?: string) {
  const match = branches.find((branch) => branch.id === branchId) ?? branches.find((branch) => branch.name === fallback);
  return match?.name ?? fallback ?? '-';
}

function configRecordLabel(record: ConfigRecord | null | undefined, branches: BranchConfigRecord[]) {
  if (!record) return '';
  if (isTemplate(record)) {
    return `${branchDisplayName(branches, record.branchId, record.branchName)} - ${record.channel} - ${formatTemplateType(record.type)}`;
  }
  return 'name' in record && record.name ? String(record.name) : record.id;
}

function makeScreen(kind: ConfigKind, branches: BranchConfigRecord[]): ScreenDefinition {
  const branchSelectOptions = branchOptions(branches);

  if (kind === 'branches') {
    return {
      title: 'Ramos',
      singular: 'ramo',
      action: 'Adicionar novo ramo',
      table: 'Listagem de ramos',
      emptyMessage: 'Nenhum ramo configurado ainda.',
      metrics: [
        { icon: List, label: 'Total', tone: 'neutral', getValue: (records) => records.length },
        { icon: SquareCheck, label: 'Ativos', tone: 'success', getValue: (records) => records.filter((record) => record.active && !isArchivedConfig(record)).length },
        { icon: Archive, label: 'Inativos', tone: 'warning', getValue: (records) => records.filter((record) => !record.active && !isArchivedConfig(record)).length },
      ],
      columns: [
        { key: 'name', label: 'Ramo', width: '24%' },
        { key: 'subcategories', label: 'Sub ramos', width: '34%' },
        { key: 'imageName', label: 'Nome da imagem', width: '24%' },
        { key: 'status', label: 'Status', width: '12%' },
      ],
      fields: [
        { key: 'name', label: 'Nome', placeholder: 'Ex.: Moveis Planejados', description: 'Ramo operacional utilizado por toda a plataforma.' },
        { key: 'slug', label: 'Slug', placeholder: 'moveis-planejados' },
        { key: 'imageName', label: 'Nome da imagem', placeholder: 'moveis-planejados.jpg', description: 'Arquivo que o Worker procura em /app/images/.' },
        { key: 'imageRequired', label: 'Imagem no disparo', type: 'select', options: imageRequirementOptions, description: 'Obrigatoria: o Worker confere o arquivo antes da primeira mensagem. Opcional: envia somente texto.' },
        { key: 'associatedCategories', label: 'Categorias do Google Maps', type: 'textarea', placeholder: 'Categoria principal, aliases...', description: 'Categorias oficiais importadas do Google Maps que serao associadas automaticamente a este ramo.' },
        { key: 'subcategories', label: 'Palavras-chave de reconhecimento', type: 'textarea', placeholder: 'Marcenaria, marceneiro, moveleiro...', description: 'Termos utilizados para identificar automaticamente este ramo durante a importacao.' },
        { key: 'active', label: 'Status', type: 'select', options: activeOptions },
      ],
    };
  }

  if (kind === 'templates') {
    return {
      title: 'Templates',
      singular: 'template',
      action: 'Adicionar novo template',
      table: 'Templates por ramo, canal e tipo',
      emptyMessage: 'Nenhum template configurado ainda.',
      metrics: [
        { icon: MessageSquare, label: 'Total', tone: 'neutral', getValue: (records) => records.length },
        { icon: SquareCheck, label: 'Ativos', tone: 'success', getValue: (records) => records.filter((record) => record.active && !isArchivedConfig(record)).length },
        { icon: Archive, label: 'Inativos', tone: 'warning', getValue: (records) => records.filter((record) => !record.active && !isArchivedConfig(record)).length },
      ],
      columns: [
        { key: 'branch', label: 'Ramo', width: '22%' },
        { key: 'channel', label: 'Canal', width: '14%' },
        { key: 'type', label: 'Tipo', width: '14%' },
        { key: 'messages', label: 'Mensagens', width: '30%' },
        { key: 'status', label: 'Status', width: '10%' },
      ],
      fields: [
        { key: 'branchId', label: 'Ramo', type: 'select', options: branchSelectOptions },
        { key: 'channel', label: 'Canal', type: 'select', options: templateChannelOptions, description: 'Geral atende WhatsApp e Instagram deste ramo. Entre templates compatíveis, a plataforma sorteia e fixa uma opção por lead.' },
        { key: 'type', label: 'Tipo', type: 'select', options: templateTypeOptions },
        { key: 'message1', label: 'Mensagem 1', type: 'textarea', placeholder: DEFAULT_TEMPLATE_MESSAGE_1 },
        { key: 'message2', label: 'Mensagem 2', type: 'textarea', placeholder: DEFAULT_TEMPLATE_MESSAGE_2 },
        { key: 'active', label: 'Status', type: 'select', options: activeOptions },
      ],
    };
  }

  if (kind === 'instagram') {
    return {
      title: 'Instagram',
      singular: 'perfil',
      action: 'Adicionar perfil',
      table: 'Listagem de perfis',
      emptyMessage: 'Nenhum perfil Instagram configurado ainda.',
      metrics: [
        { icon: Instagram, label: 'Total', tone: 'neutral', getValue: (records) => records.filter(isInstagramProfile).length },
        {
          icon: SquareCheck,
          label: 'Ativos',
          tone: 'success',
          getValue: (records) => records.filter(isInstagramProfile).filter((record) => record.active && !isArchivedConfig(record)).length,
        },
        {
          icon: PhoneOff,
          label: 'Inativos',
          tone: 'danger',
          getValue: (records) => records.filter(isInstagramProfile).filter((record) => !record.active && !isArchivedConfig(record)).length,
        },
        {
          icon: Archive,
          label: 'Arquivados',
          tone: 'warning',
          getValue: (records) => records.filter(isInstagramProfile).filter(isArchivedConfig).length,
        },
      ],
      columns: [
        { key: 'name', label: 'Nome', width: '36%' },
        { key: 'username', label: '@Instagram', width: '36%' },
        { key: 'status', label: 'Status', width: '16%' },
      ],
      fields: [
        { key: 'name', label: 'Nome', placeholder: 'Ex.: Samuel' },
        { key: 'username', label: '@Instagram', placeholder: '@perfil' },
        { key: 'active', label: 'Status', type: 'select', options: activeOptions },
      ],
    };
  }

  return {
    title: 'Chips',
    singular: 'chip',
    action: 'Adicionar novo chip',
    table: 'Listagem de chips',
    emptyMessage: 'Nenhum chip configurado ainda.',
    metrics: [
      { icon: Smartphone, label: 'Total', tone: 'neutral', getValue: (records) => records.length },
      { icon: PhoneCall, label: 'Ativos', tone: 'success', getValue: (records) => records.filter(isChip).filter(isOperationalWhatsAppChip).length },
      { icon: PhoneOff, label: 'Inativos', tone: 'danger', getValue: (records) => records.filter(isChip).filter((record) => !isOperationalWhatsAppChip(record)).length },
      {
        icon: Send,
        label: 'Capacidade/dia',
        tone: 'warning',
        getValue: (records) => records.filter(isChip).filter(isOperationalWhatsAppChip).reduce((total, record) => total + record.dailyLimit, 0),
      },
    ],
    columns: [
      { key: 'name', label: 'Nome do chip', width: '18%' },
      { key: 'number', label: 'Numero', width: '14%' },
      { key: 'level', label: 'Nivel', width: '14%' },
      { key: 'url', label: 'URL', width: '16%' },
      { key: 'instance', label: 'Instance name', width: '14%' },
      { key: 'apiKey', label: 'API Key', width: '12%' },
      { key: 'status', label: 'Status', width: '10%' },
    ],
    fields: [
      { key: 'name', label: 'Nome do chip', placeholder: 'Ex.: Principal' },
      { key: 'number', label: 'Numero', placeholder: 'Ex.: 5511940028922' },
      { key: 'level', label: 'Nivel', type: 'select', options: CHIP_LEVEL_OPTIONS },
      { key: 'url', label: 'URL', placeholder: 'https://evolution.exemplo.com' },
      { key: 'instance', label: 'Instance name', placeholder: 'chip-8457' },
      { key: 'apiKey', label: 'API Key', placeholder: 'Chave da instancia' },
      { key: 'active', label: 'Status', type: 'select', options: activeOptions },
    ],
  };
}

function createEmptyForm(kind: ConfigKind, branches: BranchConfigRecord[], chipLevelPresets: ChipLevelPresetsMap = {}): Record<string, string> {
  if (kind === 'branches') {
    return {
      name: '',
      slug: '',
      associatedCategories: '',
      subcategories: '',
      order: '0',
      minRating: String(DEFAULT_BRANCH_MIN_RATING),
      minReviews: String(DEFAULT_BRANCH_MIN_REVIEWS),
      imageName: '',
      imageRequired: 'false',
      active: 'Ativo',
    };
  }

  if (kind === 'templates') {
    return {
      branchId: branches[0]?.id ?? '',
      channel: 'WhatsApp',
      type: 'sem-site',
      message1: DEFAULT_TEMPLATE_MESSAGE_1,
      message2: DEFAULT_TEMPLATE_MESSAGE_2,
      active: 'Ativo',
    };
  }

  if (kind === 'instagram') {
    return {
      name: '',
      username: '',
      active: 'Ativo',
    };
  }

  const defaults = chipLevelDefaults('estabilizado', chipLevelPresets);
  return {
    instance: '',
    name: '',
    number: '',
    level: 'estabilizado',
    url: '',
    apiKey: '',
    priority: '1',
    startTime: defaults.startTime,
    endTime: defaults.endTime,
    dailyLimit: String(defaults.dailyLimit),
    blockSize: String(defaults.blockSize),
    intervalSeconds: String(defaults.intervalSeconds),
    batches: defaults.batches.join(', '),
    active: 'Ativo',
  };
}

function formFromRecord(record: ConfigRecord): Record<string, string> {
  if (isBranch(record)) {
    return {
      name: record.name,
      slug: record.slug,
      associatedCategories: toCsv(record.associatedCategories),
      subcategories: toCsv(record.subcategories),
      order: String(record.order),
      minRating: String(record.minRating),
      minReviews: String(record.minReviews),
      imageName: record.imageName,
      imageRequired: record.imageRequired ? 'true' : 'false',
      active: isArchivedConfig(record) ? 'Arquivado' : record.active ? 'Ativo' : 'Inativo',
    };
  }

  if (isTemplate(record)) {
    return {
      branchId: record.branchId,
      channel: record.channel,
      type: record.type,
      message1: record.message1,
      message2: record.message2,
      active: isArchivedConfig(record) ? 'Arquivado' : record.active ? 'Ativo' : 'Inativo',
    };
  }

  if (isInstagramProfile(record)) {
    return {
      name: record.name,
      username: record.username ? `@${record.username.replace(/^@/, '')}` : '',
      active: isArchivedConfig(record) ? 'Arquivado' : record.active ? 'Ativo' : 'Inativo',
    };
  }

  return {
    instance: record.instance,
    name: record.name,
    number: record.number,
    level: record.level,
    url: record.url,
    apiKey: record.apiKey,
    priority: String(record.priority),
    startTime: record.startTime,
    endTime: record.endTime,
    dailyLimit: String(record.dailyLimit),
    blockSize: String(record.blockSize),
    intervalSeconds: String(record.intervalSeconds),
    batches: toCsv(record.batches),
    active: isArchivedConfig(record) ? 'Arquivado' : record.active ? 'Ativo' : 'Inativo',
  };
}

function toInputPayload(kind: ConfigKind, form: Record<string, string>, chipLevelPresets: ChipLevelPresetsMap = {}) {
  if (kind !== 'chips') {
    return {
      ...form,
      username: form.username?.replace(/^@/, ''),
      active: form.active === 'Ativo',
    };
  }

  const levelDefaults = chipLevelDefaults(form.level, chipLevelPresets);
  return {
    ...form,
    active: form.active === 'Ativo',
    dailyLimit: form.dailyLimit ?? String(levelDefaults.dailyLimit),
    blockSize: form.blockSize ?? String(levelDefaults.blockSize),
    intervalSeconds: form.intervalSeconds ?? String(levelDefaults.intervalSeconds),
    batches: form.batches ?? levelDefaults.batches.join(', '),
    startTime: form.startTime ?? levelDefaults.startTime,
    endTime: form.endTime ?? levelDefaults.endTime,
  };
}

function toTableRows(kind: ConfigKind, records: ConfigRecord[], branches: BranchConfigRecord[] = []): ConfigTableRow[] {
  if (kind === 'branches') {
    return records.filter(isBranch).map((record) => ({
      id: record.id,
      name: record.name,
      subcategories: joinList(record.subcategories),
      imageName: record.imageName || '-',
      status: statusTag(record),
    }));
  }

  if (kind === 'templates') {
    return records.filter(isTemplate).map((record) => ({
      id: record.id,
      branch: branchDisplayName(branches, record.branchId, record.branchName),
      channel: record.channel,
      type: formatTemplateType(record.type),
      messages: [previewMessage(record.message1), record.message2 ? previewMessage(record.message2) : ''].filter(Boolean).join(' / '),
      status: statusTag(record),
    }));
  }

  if (kind === 'instagram') {
    return records.filter(isInstagramProfile).map((record) => ({
      id: record.id,
      name: record.name,
      username: record.username ? `@${record.username.replace(/^@/, '')}` : '-',
      status: statusTag(record),
    }));
  }

  return records.filter(isChip).map((record) => ({
    id: record.id,
    name: record.name,
    number: record.number || '-',
    level: optionLabel(CHIP_LEVEL_OPTIONS, record.level),
    url: record.url || '-',
    instance: record.instance || '-',
    apiKey: record.apiKey ? 'Configurada' : '-',
    status: chipStatusTag(record),
  }));
}

function previewMessage(message: string) {
  return (message || DEFAULT_TEMPLATE_MESSAGE_1).replace(/\{EMPRESA\}/g, 'Empresa Exemplo').replace(/\[EMPRESA\]/g, 'Empresa Exemplo');
}

export function ConfigTablePage({ kind }: { kind: ConfigKind }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('create');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);

  const branchRecords = useConfigRecords('branches', { search: '', status: 'Todos' });
  const branches = useMemo(() => branchRecords.records.filter(isBranch), [branchRecords.records]);
  const { settings: dispatchSettings } = useDispatchSettings();
  const chipLevelPresets = dispatchSettings?.chipLevels ?? {};
  const screen = useMemo(() => makeScreen(kind, branches), [kind, branches]);
  const [form, setForm] = useState<Record<string, string>>(() => createEmptyForm(kind, branches));

  const { records, loading, error, createRecord, updateRecord, removeRecord, toggleArchive, bulkArchive, bulkRestore, bulkRemove } = useConfigRecords(kind, {
    search,
    status: statusFilter,
  });

  const rows = useMemo(() => toTableRows(kind, records, branches), [kind, records, branches]);
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => rows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage), [rows, currentPage, rowsPerPage]);
  const recordById = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const selectedRecords = useMemo(
    () => selectedRows.map((rowIndex) => recordById.get(pageRows[rowIndex]?.id)).filter((record): record is ConfigRecord => Boolean(record)),
    [pageRows, recordById, selectedRows],
  );
  const selectedIds = selectedRecords.map((record) => record.id);
  const canBulkArchive = selectedRecords.length > 0 && selectedRecords.every((record) => !isArchivedConfig(record));
  const canBulkRestore = selectedRecords.length > 0 && selectedRecords.every(isArchivedConfig);
  const canBulkRemove = selectedRecords.length > 0 && selectedRecords.every(isArchivedConfig);
  const hasBulkAction = canBulkArchive || canBulkRestore || canBulkRemove;

  const recordMetrics = screen.metrics.map((metric) => ({
    ...metric,
    value: String(metric.getValue(records)),
  }));

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  };

  const openCreateDrawer = () => {
    setDrawerMode('create');
    setEditingId(null);
    setForm(createEmptyForm(kind, branches, chipLevelPresets));
    setDrawerOpen(true);
  };

  const openRecordDrawer = (row: ConfigTableRow, mode: 'view' | 'edit' = 'view') => {
    const record = recordById.get(row.id);
    if (!record) return;
    setDrawerMode(mode);
    setEditingId(record.id);
    setForm(formFromRecord(record));
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingId(null);
  };

  const updateForm = (key: string, value: string) => {
    setForm((current) => {
      if (kind === 'chips' && key === 'level') {
        const defaults = chipLevelDefaults(value, chipLevelPresets);
        return {
          ...current,
          level: value,
          startTime: defaults.startTime,
          endTime: defaults.endTime,
          dailyLimit: String(defaults.dailyLimit),
          blockSize: String(defaults.blockSize),
          intervalSeconds: String(defaults.intervalSeconds),
          batches: defaults.batches.join(', '),
        };
      }

      return { ...current, [key]: value };
    });
  };

  const validateForm = () => {
    if (kind === 'templates' && !form.branchId) {
      throw new Error('Cadastre um ramo antes de criar templates.');
    }
  };

  const saveForm = async () => {
    setSaving(true);

    try {
      validateForm();
      const payload = toInputPayload(kind, form, chipLevelPresets);

      if (drawerMode === 'create') {
        await createRecord(payload);
        pushToast({ title: `${screen.singular} criado`, description: 'Registro salvo com sucesso.', tone: 'success' });
      } else if (editingId) {
        await updateRecord(editingId, payload);
        pushToast({ title: `${screen.singular} atualizado`, description: 'Alteracao salva com sucesso.', tone: 'success' });
      }

      closeDrawer();
    } catch (err) {
      pushToast({ title: 'Nao foi possivel salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (row: ConfigTableRow) => {
    setDeleteId(row.id);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;

    try {
      await removeRecord(deleteId);
      setDeleteId(null);
      pushToast({ title: `${screen.singular} removido`, description: 'Registro excluido com sucesso.', tone: 'danger' });
    } catch (err) {
      pushToast({ title: 'Nao foi possivel excluir', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const archiveRow = async (row: ConfigTableRow) => {
    try {
      await toggleArchive(row.id);
      pushToast({ title: 'Status atualizado', description: 'O status foi alternado com sucesso.', tone: 'info' });
    } catch (err) {
      pushToast({ title: 'Nao foi possivel atualizar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const runBulkAction = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
      setSelectedRows([]);
      pushToast({ title: 'Acao em massa concluida', description: `${selectedIds.length} registro(s): ${label}.`, tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Acao em massa bloqueada', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleAction = (action: TableAction, row: ConfigTableRow) => {
    if (action === 'edit' || action === 'view') {
      openRecordDrawer(row, action === 'edit' ? 'edit' : 'view');
      return;
    }

    if (action === 'delete') {
      requestDelete(row);
      return;
    }

    if (action === 'archive' || action === 'restore') {
      void archiveRow(row);
    }
  };

  const selectedDeleteRecord = deleteId ? recordById.get(deleteId) : null;
  const editingRecord = editingId ? recordById.get(editingId) : undefined;

  return (
    <div className={`config-table-page config-table-page--${kind}`}>
      <PageHeader title={screen.title} action={<Button iconLeft={Plus} onClick={openCreateDrawer}>{screen.action}</Button>} />
      <section className={`metric-grid metric-grid--${screen.metrics.length === 3 ? 3 : 4}`}>
        {recordMetrics.map((metric) => (
          <MetricCard {...metric} key={metric.label} />
        ))}
      </section>
      <FiltersBar>
        <SelectField value={statusFilter} options={statusOptions} placeholder="Status" onChange={(value) => { setStatusFilter(value); setPage(1); setSelectedRows([]); }} />
        <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); setSelectedRows([]); }} />
      </FiltersBar>
      <TableCard
        title={screen.table}
        footerText={`Mostrando ${pageRows.length} de ${rows.length} registro(s). ${selectedRecords.length} selecionado(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); setSelectedRows([]); }} />}
        page={currentPage}
        totalPages={totalPages}
        onPageChange={(nextPage) => { setPage(nextPage); setSelectedRows([]); }}
      >
        {selectedRecords.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedRecords.length} selecionado(s)</span>
            {canBulkArchive ? <Button size="sm" variant="danger" iconLeft={Archive} onClick={() => runBulkAction('arquivados', () => bulkArchive(selectedIds))}>Arquivar</Button> : null}
            {canBulkRestore ? <Button size="sm" variant="secondary" iconLeft={RotateCcw} onClick={() => runBulkAction('restaurados', () => bulkRestore(selectedIds))}>Restaurar</Button> : null}
            {canBulkRemove ? <Button size="sm" variant="danger" iconLeft={Trash2} onClick={() => runBulkAction('excluidos', () => bulkRemove(selectedIds))}>Excluir</Button> : null}
            {!hasBulkAction ? <small>Nenhuma acao disponivel para a selecao atual.</small> : null}
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando registros...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">{screen.emptyMessage}</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable
            columns={screen.columns}
            rows={pageRows}
            actions={['view', 'archive']}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            getRowActions={(row) => {
              const record = recordById.get(row.id);
              if (!record) return [];
              return isArchivedConfig(record)
                ? ['view' as TableAction, 'restore' as TableAction, 'delete' as TableAction]
                : ['view' as TableAction, 'archive' as TableAction];
            }}
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={drawerOpen}
        title={drawerMode === 'create' ? screen.action : drawerMode === 'edit' ? `Editar ${screen.singular}` : `Detalhes do ${screen.singular}`}
        description="As regras sao salvas pela camada de servico e usadas pelos fluxos operacionais."
        onClose={closeDrawer}
        footer={
          drawerMode === 'view' ? (
            <>
              <Button variant="secondary" onClick={closeDrawer}>Fechar</Button>
              {editingRecord && !isArchivedConfig(editingRecord) ? (
                <Button onClick={() => {
                  const row = pageRows.find((item) => item.id === editingId);
                  if (row) openRecordDrawer(row, 'edit');
                }}>Editar</Button>
              ) : null}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => (drawerMode === 'edit' ? setDrawerMode('view') : closeDrawer())}>Cancelar</Button>
              <Button loading={saving} onClick={saveForm}>Salvar</Button>
            </>
          )
        }
      >
        <div className={`drawer-form ${drawerMode === 'view' ? 'drawer-form--readonly' : ''}`}>
          {screen.fields.map((field) =>
            field.type === 'select' ? (
              <label className="drawer-field" key={field.key}>
                <span>{field.label}</span>
                {field.description ? <small className="drawer-field__description">{field.description}</small> : null}
                {drawerMode === 'view' ? (
                  <Field value={optionLabel(field.options, form[field.key] ?? '')} readOnly />
                ) : (
                  <SelectField value={form[field.key] ?? ''} options={field.options ?? []} onChange={(value) => updateForm(field.key, value)} />
                )}
              </label>
            ) : (
              <div className="drawer-field-stack" key={field.key}>
                <Field
                  as={field.type === 'textarea' ? 'textarea' : 'input'}
                  label={field.label}
                  placeholder={field.placeholder}
                  value={form[field.key] ?? ''}
                  readOnly={drawerMode === 'view'}
                  onChange={(value) => updateForm(field.key, value)}
                />
                {field.description ? <small className="drawer-field__description">{field.description}</small> : null}
              </div>
            ),
          )}
          {kind === 'templates' ? (
            <div className="config-preview">
              <strong>Preview</strong>
              <span>{previewMessage(form.message1)}</span>
              {form.message2 ? <span>{previewMessage(form.message2)}</span> : null}
            </div>
          ) : null}
        </div>
      </Drawer>

      <ConfirmDialog
        open={deleteId !== null}
        title={`Excluir ${screen.singular}?`}
        description="Essa acao remove definitivamente apenas registros arquivados."
        confirmLabel="Excluir"
        danger
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
      >
        {selectedDeleteRecord ? <strong>{configRecordLabel(selectedDeleteRecord, branches)}</strong> : null}
      </ConfirmDialog>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
