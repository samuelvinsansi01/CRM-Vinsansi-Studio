import type { LucideIcon } from 'lucide-react';
import { Instagram, List, MessageSquare, PhoneCall, PhoneOff, Plus, Power, PowerOff, Send, Smartphone, SquareCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
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
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { useCatalogRecords } from '../hooks/useCatalogRecords';
import { useConfigRecords } from '../hooks/useConfigRecords';
import { DEFAULT_TEMPLATE_MESSAGE_1, DEFAULT_TEMPLATE_MESSAGE_2 } from '../services/config/config.seed';
import { chipStatusLabel, isOperationalWhatsAppChip } from '../services/config/chipOperational';
import { categoriesFormValue, formatCategoriesJson, mergeCategoriesJson, parseCategoriesJson, removeLegacyBranchAcquisitionTargets } from '../utils/branchCategories';
import type { InstanceRecord, LevelRecord, TemplateChannelRecord, TemplateTypeRecord } from '../repositories/configuration';
import type {
  BranchConfigRecord,
  ChipConfigRecord,
  ConfigKind,
  ConfigRecord,
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
  inputType?: 'text' | 'password' | 'number' | 'url' | 'time';
  options?: Array<string | SelectOption>;
  placeholder?: string;
  description?: string;
  readOnly?: boolean;
  className?: string;
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

const statusOptions = [
  { label: 'Todos', value: 'Todos' },
  { label: 'Ativos', value: 'Ativos' },
  { label: 'Inativos', value: 'Inativos' },
];

const activeOptions = [
  { label: 'Ativo', value: 'Ativo' },
  { label: 'Inativo', value: 'Inativo' },
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

function formatTemplateType(type: TemplateType) {
  const labels: Record<TemplateType, string> = {
    'sem-site': 'Sem site',
    'com-site': 'Com site',
  };
  return labels[type];
}

function statusTag(record: ConfigRecord) {
  return <Tag tone={record.active ? 'success' : 'warning'}>{record.active ? 'Ativo' : 'Inativo'}</Tag>;
}

function chipStatusTag(record: ChipConfigRecord) {
  const label = chipStatusLabel(record);
  const tone = label === 'Conectado'
    ? 'success'
    : label === 'Reconectando' || label === 'Sessao salva'
      ? 'warning'
      : label === 'Arquivado'
        ? 'neutral'
        : 'danger';
  const title = [
    record.jid ? `JID: ${record.jid}` : '',
    record.runtimeCheckedAt ? `Verificado: ${record.runtimeCheckedAt}` : '',
    record.runtimeError ? `Erro: ${record.runtimeError}` : '',
  ].filter(Boolean).join(' | ');
  return <span title={title || undefined}><Tag tone={tone}>{label}</Tag></span>;
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

type ConfigModalOptions = {
  branches: BranchConfigRecord[];
  instances: InstanceRecord[];
  whatsappLevels: LevelRecord[];
  instagramLevels: LevelRecord[];
  templateChannels: TemplateChannelRecord[];
  templateTypes: TemplateTypeRecord[];
};

const EMPTY_MODAL_OPTIONS: ConfigModalOptions = {
  branches: [],
  instances: [],
  whatsappLevels: [],
  instagramLevels: [],
  templateChannels: [],
  templateTypes: [],
};

function recordOptions<T extends { id: string; name: string; active: boolean }>(records: T[], emptyLabel: string): SelectOption[] {
  if (!records.length) return [{ label: emptyLabel, value: '' }];
  return records.map((record) => ({
    label: record.active ? record.name : `${record.name} (inativo)`,
    value: record.id,
  }));
}

function makeScreen(kind: ConfigKind, options: ConfigModalOptions): ScreenDefinition {
  const branchSelectOptions = branchOptions(options.branches);

  if (kind === 'branches') {
    return {
      title: 'Ramos',
      singular: 'ramo',
      action: 'Adicionar novo ramo',
      table: 'Listagem de ramos',
      emptyMessage: 'Nenhum ramo configurado ainda.',
      metrics: [
        { icon: List, label: 'Total', tone: 'neutral', getValue: (records) => records.length },
        { icon: SquareCheck, label: 'Ativos', tone: 'success', getValue: (records) => records.filter((record) => record.active).length },
        { icon: PowerOff, label: 'Inativos', tone: 'warning', getValue: (records) => records.filter((record) => !record.active).length },
      ],
      columns: [
        { key: 'name', label: 'Ramo', width: '34%' },
        { key: 'categories', label: 'Categorias (JSONB)', width: '34%' },
        { key: 'status', label: 'Status', width: '12%' },
      ],
      fields: [
        { key: 'name', label: 'Nome', placeholder: 'Ex.: Móveis Planejados', description: 'Mapeia diretamente para branches.branches_name.' },
        {
          key: 'categoriesText',
          label: 'Categorias associadas',
          type: 'textarea',
          placeholder: 'contabilidade, escritório contábil, contador, serviços contábeis',
          description: 'Digite as categorias separadas por vírgula, ponto e vírgula ou quebra de linha. Espaços, duplicidades e capitalização são normalizados automaticamente.',
        },
        {
          key: 'categoriesJson',
          label: 'Estrutura JSON gerada',
          type: 'textarea',
          readOnly: true,
          className: 'branch-categories-json',
          description: 'Visualização somente leitura de branches.branches_categories. As demais propriedades existentes no JSON são preservadas.',
        },
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
        { icon: SquareCheck, label: 'Ativos', tone: 'success', getValue: (records) => records.filter((record) => record.active).length },
        { icon: PowerOff, label: 'Inativos', tone: 'warning', getValue: (records) => records.filter((record) => !record.active).length },
      ],
      columns: [
        { key: 'name', label: 'Template', width: '18%' },
        { key: 'branch', label: 'Ramo', width: '16%' },
        { key: 'channel', label: 'Canal', width: '12%' },
        { key: 'type', label: 'Tipo', width: '12%' },
        { key: 'messages', label: 'Mensagens', width: '30%' },
        { key: 'status', label: 'WhatsApp', width: '10%' },
      ],
      fields: [
        { key: 'name', label: 'Nome do template', placeholder: 'Ex.: WhatsApp sem site - abordagem A', description: 'Mapeia diretamente para templates.templates_name.' },
        { key: 'branchId', label: 'Ramo', type: 'select', options: branchSelectOptions },
        { key: 'templateChannelId', label: 'Canal de template', type: 'select', options: recordOptions(options.templateChannels, 'Cadastre um canal de template primeiro') },
        { key: 'templateTypeId', label: 'Tipo de template', type: 'select', options: recordOptions(options.templateTypes, 'Cadastre um tipo de template primeiro') },
        { key: 'message1', label: 'Mensagem 1', type: 'textarea', placeholder: DEFAULT_TEMPLATE_MESSAGE_1, description: 'As quatro mensagens são obrigatórias e serão congeladas na fila.' },
        { key: 'message2', label: 'Mensagem 2', type: 'textarea', placeholder: DEFAULT_TEMPLATE_MESSAGE_2 },
        { key: 'message3', label: 'Mensagem 3', type: 'textarea', placeholder: 'Digite a terceira mensagem' },
        { key: 'message4', label: 'Mensagem 4', type: 'textarea', placeholder: 'Digite a quarta mensagem' },
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
        { icon: SquareCheck, label: 'Ativos', tone: 'success', getValue: (records) => records.filter(isInstagramProfile).filter((record) => record.active).length },
        { icon: PhoneOff, label: 'Inativos', tone: 'danger', getValue: (records) => records.filter(isInstagramProfile).filter((record) => !record.active).length },
      ],
      columns: [
        { key: 'name', label: 'Nome', width: '26%' },
        { key: 'username', label: '@Instagram', width: '24%' },
        { key: 'level', label: 'Nível', width: '22%' },
        { key: 'dailyLimit', label: 'Limite diário', width: '14%' },
        { key: 'status', label: 'Status', width: '12%' },
      ],
      fields: [
        { key: 'name', label: 'Nome', placeholder: 'Ex.: Perfil comercial 1' },
        { key: 'username', label: '@Instagram', placeholder: '@perfil' },
        { key: 'levelId', label: 'Nível operacional', type: 'select', options: recordOptions(options.instagramLevels, 'Cadastre um nível de Instagram primeiro'), description: 'O limite diário é herdado de levels; não é duplicado no perfil.' },
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
      { icon: PhoneCall, label: 'Com sessao', tone: 'success', getValue: (records) => records.filter(isChip).filter(isOperationalWhatsAppChip).length },
      { icon: PhoneOff, label: 'Sem sessao', tone: 'danger', getValue: (records) => records.filter(isChip).filter((record) => !isOperationalWhatsAppChip(record)).length },
      { icon: Send, label: 'Capacidade/dia', tone: 'warning', getValue: (records) => records.filter(isChip).filter(isOperationalWhatsAppChip).reduce((total, record) => total + record.dailyLimit, 0) },
    ],
    columns: [
      { key: 'name', label: 'Nome do chip', width: '22%' },
      { key: 'number', label: 'Número', width: '20%' },
      { key: 'instance', label: 'Instância', width: '20%' },
      { key: 'level', label: 'Nível', width: '18%' },
      { key: 'dailyLimit', label: 'Limite/dia', width: '10%' },
      { key: 'status', label: 'Status', width: '10%' },
    ],
    fields: [
      { key: 'name', label: 'Nome do chip', placeholder: 'Ex.: Principal' },
      { key: 'number', label: 'Número', placeholder: 'Ex.: 5511940028922' },
      { key: 'instanceId', label: 'Instância', type: 'select', options: recordOptions(options.instances, 'Cadastre uma instância primeiro'), description: 'URL e API key são gerenciadas exclusivamente em Configurações > Instâncias.' },
      { key: 'levelId', label: 'Nível operacional', type: 'select', options: recordOptions(options.whatsappLevels, 'Cadastre um nível de WhatsApp primeiro'), description: 'Limite diário e quantidade de filas são herdados de levels.' },
      { key: 'active', label: 'Status', type: 'select', options: activeOptions },
    ],
  };
}

function createEmptyForm(kind: ConfigKind, options: ConfigModalOptions): Record<string, string> {
  if (kind === 'branches') {
    return {
      name: '',
      categoriesText: '',
      categoriesJson: formatCategoriesJson({ associatedCategories: [] }),
      active: 'Ativo',
    };
  }

  if (kind === 'templates') {
    return {
      name: '',
      branchId: options.branches[0]?.id ?? '',
      templateChannelId: options.templateChannels.find((record) => record.active)?.id ?? options.templateChannels[0]?.id ?? '',
      templateTypeId: options.templateTypes.find((record) => record.active)?.id ?? options.templateTypes[0]?.id ?? '',
      message1: DEFAULT_TEMPLATE_MESSAGE_1,
      message2: DEFAULT_TEMPLATE_MESSAGE_2,
      message3: '',
      message4: '',
      active: 'Ativo',
    };
  }

  if (kind === 'instagram') {
    return {
      name: '',
      username: '',
      levelId: options.instagramLevels.find((record) => record.active)?.id ?? options.instagramLevels[0]?.id ?? '',
      active: 'Ativo',
    };
  }

  return {
    name: '',
    number: '',
    instanceId: options.instances.find((record) => record.active)?.id ?? options.instances[0]?.id ?? '',
    levelId: options.whatsappLevels.find((record) => record.active)?.id ?? options.whatsappLevels[0]?.id ?? '',
    active: 'Ativo',
  };
}

function formFromRecord(record: ConfigRecord): Record<string, string> {
  if (isBranch(record)) {
    return {
      name: record.name,
      ...categoriesFormValue(removeLegacyBranchAcquisitionTargets(record.categories)),
      active: record.active ? 'Ativo' : 'Inativo',
    };
  }

  if (isTemplate(record)) {
    return {
      name: record.name,
      branchId: record.branchId,
      templateChannelId: record.templateChannelId,
      templateTypeId: record.templateTypeId,
      message1: record.message1,
      message2: record.message2,
      message3: record.message3,
      message4: record.message4,
      active: record.active ? 'Ativo' : 'Inativo',
    };
  }

  if (isInstagramProfile(record)) {
    return {
      name: record.name,
      username: record.username ? `@${record.username.replace(/^@/, '')}` : '',
      levelId: record.levelId,
      active: record.active ? 'Ativo' : 'Inativo',
    };
  }

  return {
    name: record.name,
    number: record.number,
    instanceId: record.instanceId,
    levelId: record.levelId,
    active: record.active ? 'Ativo' : 'Inativo',
  };
}

function toInputPayload(kind: ConfigKind, form: Record<string, string>, options: ConfigModalOptions) {
  const payload: Record<string, unknown> = {
    ...form,
    username: form.username?.replace(/^@/, ''),
    active: form.active === 'Ativo',
  };

  if (kind === 'branches') {
    payload.categories = removeLegacyBranchAcquisitionTargets(parseCategoriesJson(form.categoriesJson ?? ''));
    delete payload.categoriesJson;
    return payload;
  }

  if (kind === 'templates') {
    payload.templateChannelName = options.templateChannels.find((record) => record.id === form.templateChannelId)?.name ?? '';
    payload.templateTypeName = options.templateTypes.find((record) => record.id === form.templateTypeId)?.name ?? '';
    return payload;
  }

  if (kind === 'chips') {
    const instance = options.instances.find((record) => record.id === form.instanceId);
    const level = options.whatsappLevels.find((record) => record.id === form.levelId);
    payload.instanceName = instance?.name ?? '';
    payload.instanceUrl = instance?.url ?? '';
    payload.levelName = level?.name ?? '';
    payload.dailyLimit = level?.dailyLimit ?? 0;
    return payload;
  }

  const level = options.instagramLevels.find((record) => record.id === form.levelId);
  payload.levelName = level?.name ?? '';
  payload.dailyLimit = level?.dailyLimit ?? 0;
  return payload;
}

function toTableRows(kind: ConfigKind, records: ConfigRecord[], branches: BranchConfigRecord[] = []): ConfigTableRow[] {
  if (kind === 'branches') {
    return records.filter(isBranch).map((record) => ({
      id: record.id,
      name: record.name,
      categories: formatCategoriesJson(record.categories).replace(/\s+/g, ' ').slice(0, 140) || '—',
      status: statusTag(record),
    }));
  }

  if (kind === 'templates') {
    return records.filter(isTemplate).map((record) => ({
      id: record.id,
      name: record.name,
      branch: branchDisplayName(branches, record.branchId, record.branchName),
      channel: record.templateChannelName || record.channel,
      type: record.templateTypeName || formatTemplateType(record.type),
      messages: [record.message1, record.message2, record.message3, record.message4].map(previewMessage).join(' / '),
      status: statusTag(record),
    }));
  }

  if (kind === 'instagram') {
    return records.filter(isInstagramProfile).map((record) => ({
      id: record.id,
      name: record.name,
      username: record.username ? `@${record.username.replace(/^@/, '')}` : '-',
      level: record.levelName || '—',
      dailyLimit: record.dailyLimit,
      status: statusTag(record),
    }));
  }

  return records.filter(isChip).map((record) => ({
    id: record.id,
    name: record.name,
    number: record.number || '-',
    instance: record.instance || '-',
    level: record.level || '-',
    dailyLimit: record.dailyLimit || '—',
    status: chipStatusTag(record),
  }));
}

function previewMessage(message: string) {
  return (message || DEFAULT_TEMPLATE_MESSAGE_1).replace(/\{EMPRESA\}/g, 'Empresa Exemplo').replace(/\[EMPRESA\]/g, 'Empresa Exemplo');
}

export function ConfigTablePage({ kind }: { kind: ConfigKind }) {
  const { hasPermission } = useOrganizationContext();
  const managePermission = kind === 'chips'
    ? 'whatsapp.instances.manage'
    : kind === 'instagram'
      ? 'instagram.settings'
      : 'templates.manage';
  const canManage = hasPermission(managePermission);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [templateBranchFilter, setTemplateBranchFilter] = useState('Todos');
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('create');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);

  const branchRecords = useConfigRecords('branches', { search: '', status: 'Todos' });
  const branches = useMemo(() => branchRecords.records.filter(isBranch), [branchRecords.records]);
  const instanceCatalog = useCatalogRecords('instances', '', 'Todos');
  const levelCatalog = useCatalogRecords('levels', '', 'Todos');
  const templateChannelCatalog = useCatalogRecords('template_channels', '', 'Todos');
  const templateTypeCatalog = useCatalogRecords('template_types', '', 'Todos');

  const instances = useMemo(
    () => instanceCatalog.records.filter((record): record is InstanceRecord => record.kind === 'instances'),
    [instanceCatalog.records],
  );
  const levels = useMemo(
    () => levelCatalog.records.filter((record): record is LevelRecord => record.kind === 'levels'),
    [levelCatalog.records],
  );
  const whatsappLevels = useMemo(
    () => levels.filter((record) => record.channelName.trim().toLowerCase().includes('whatsapp')),
    [levels],
  );
  const instagramLevels = useMemo(
    () => levels.filter((record) => record.channelName.trim().toLowerCase().includes('instagram')),
    [levels],
  );
  const templateChannels = useMemo(
    () => templateChannelCatalog.records.filter((record): record is TemplateChannelRecord => record.kind === 'template_channels'),
    [templateChannelCatalog.records],
  );
  const templateTypes = useMemo(
    () => templateTypeCatalog.records.filter((record): record is TemplateTypeRecord => record.kind === 'template_types'),
    [templateTypeCatalog.records],
  );
  const modalOptions = useMemo<ConfigModalOptions>(() => ({
    branches,
    instances,
    whatsappLevels,
    instagramLevels,
    templateChannels,
    templateTypes,
  }), [branches, instances, whatsappLevels, instagramLevels, templateChannels, templateTypes]);
  const screen = useMemo(() => makeScreen(kind, modalOptions), [kind, modalOptions]);
  const [form, setForm] = useState<Record<string, string>>(() => createEmptyForm(kind, EMPTY_MODAL_OPTIONS));

  const { records, loading, error, createRecord, updateRecord, toggleArchive, bulkArchive, bulkRestore } = useConfigRecords(kind, {
    search,
    status: statusFilter,
  });

  const visibleRecords = useMemo(() => {
    if (kind !== 'templates' || templateBranchFilter === 'Todos') return records;

    const selectedBranch = branches.find((branch) => branch.id === templateBranchFilter);
    return records.filter((record) => {
      if (!isTemplate(record)) return false;
      if (record.branchId === templateBranchFilter) return true;
      return selectedBranch
        ? record.branchName.trim().toLowerCase() === selectedBranch.name.trim().toLowerCase()
        : false;
    });
  }, [kind, records, branches, templateBranchFilter]);

  const templateBranchFilterOptions = useMemo<SelectOption[]>(() => [
    { label: 'Todos os ramos', value: 'Todos' },
    ...branches.map((branch) => ({ label: branch.name, value: branch.id })),
  ], [branches]);

  const rows = useMemo(() => toTableRows(kind, visibleRecords, branches), [kind, visibleRecords, branches]);
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => rows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage), [rows, currentPage, rowsPerPage]);
  const recordById = useMemo(() => new Map(visibleRecords.map((record) => [record.id, record])), [visibleRecords]);
  const selectedRecords = useMemo(
    () => selectedRows.map((rowIndex) => recordById.get(pageRows[rowIndex]?.id)).filter((record): record is ConfigRecord => Boolean(record)),
    [pageRows, recordById, selectedRows],
  );
  const selectedIds = selectedRecords.map((record) => record.id);
  const canBulkDeactivate = selectedRecords.length > 0 && selectedRecords.every((record) => record.active);
  const canBulkActivate = selectedRecords.length > 0 && selectedRecords.every((record) => !record.active);
  const hasBulkAction = canBulkDeactivate || canBulkActivate;

  const recordMetrics = screen.metrics.map((metric) => ({
    ...metric,
    value: String(metric.getValue(visibleRecords)),
  }));

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  };

  const openCreateDrawer = () => {
    if (!canManage) return;
    setDrawerMode('create');
    setEditingId(null);
    setForm(createEmptyForm(kind, modalOptions));
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
      if (kind === 'branches' && key === 'categoriesText') {
        return {
          ...current,
          categoriesText: value,
          categoriesJson: mergeCategoriesJson(current.categoriesJson ?? '', value),
        };
      }
      return { ...current, [key]: value };
    });
  };

  const validateForm = () => {
    if (kind === 'branches') {
      if (!form.name?.trim()) throw new Error('Informe o nome do ramo.');
      parseCategoriesJson(form.categoriesJson ?? '');
      return;
    }

    if (kind === 'templates') {
      if (!form.name?.trim()) throw new Error('Informe o nome do template.');
      if (!form.branchId) throw new Error('Selecione o ramo do template.');
      if (!form.templateChannelId) throw new Error('Selecione o canal canônico do template.');
      if (!form.templateTypeId) throw new Error('Selecione o tipo canônico do template.');
      [form.message1, form.message2, form.message3, form.message4].forEach((message, index) => {
        if (!message?.trim()) throw new Error(`A Mensagem ${index + 1} é obrigatória.`);
      });
      return;
    }

    if (kind === 'instagram') {
      if (!form.name?.trim()) throw new Error('Informe o nome do perfil do Instagram.');
      if (!form.username?.replace(/^@/, '').trim()) throw new Error('Informe o usuário do Instagram.');
      if (!form.levelId) throw new Error('Selecione um nível de Instagram já cadastrado.');
      return;
    }

    if (!form.name?.trim()) throw new Error('Informe o nome do chip.');
    const phone = form.number?.replace(/\D/g, '') ?? '';
    if (phone && (phone.length < 10 || phone.length > 15)) throw new Error('Informe um telefone com 10 a 15 dígitos.');
    if (!form.instanceId) throw new Error('Selecione uma instância Evolution já cadastrada.');
    if (!form.levelId) throw new Error('Selecione um nível de WhatsApp já cadastrado.');
  };

  const saveForm = async () => {
    if (!canManage) return;
    setSaving(true);

    try {
      validateForm();
      const payload = toInputPayload(kind, form, modalOptions);

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

  const toggleStatusRow = async (row: ConfigTableRow) => {
    if (!canManage) return;
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

    if (action === 'activate' || action === 'deactivate') {
      void toggleStatusRow(row);
    }
  };
  const editingRecord = editingId ? recordById.get(editingId) : undefined;

  return (
    <div className={`config-table-page config-table-page--${kind}`}>
      <PageHeader title={screen.title} action={canManage ? <Button iconLeft={Plus} onClick={openCreateDrawer}>{screen.action}</Button> : undefined} />
      <section className={`metric-grid metric-grid--${screen.metrics.length === 3 ? 3 : 4}`}>
        {recordMetrics.map((metric) => (
          <MetricCard {...metric} key={metric.label} />
        ))}
      </section>
      <FiltersBar>
        <SelectField value={statusFilter} options={statusOptions} placeholder="Status" onChange={(value) => { setStatusFilter(value); setPage(1); setSelectedRows([]); }} />
        {kind === 'templates' ? (
          <SelectField
            value={templateBranchFilter}
            options={templateBranchFilterOptions}
            placeholder="Ramo"
            onChange={(value) => { setTemplateBranchFilter(value); setPage(1); setSelectedRows([]); }}
          />
        ) : null}
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
        {canManage && selectedRecords.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedRecords.length} selecionado(s)</span>
            {canBulkDeactivate ? <Button size="sm" variant="danger" iconLeft={PowerOff} onClick={() => runBulkAction('desativados', () => bulkArchive(selectedIds))}>Desativar</Button> : null}
            {canBulkActivate ? <Button size="sm" variant="secondary" iconLeft={Power} onClick={() => runBulkAction('ativados', () => bulkRestore(selectedIds))}>Ativar</Button> : null}
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
            actions={canManage ? ['edit', 'deactivate'] : ['view']}
            selectable={canManage}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            getRowActions={(row) => {
              const record = recordById.get(row.id);
              if (!record) return [];
              if (!canManage) return ['view' as TableAction];
              return record.active
                ? ['edit' as TableAction, 'deactivate' as TableAction]
                : ['view' as TableAction, 'activate' as TableAction];
            }}
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={drawerOpen}
        title={drawerMode === 'create' ? screen.action : drawerMode === 'edit' ? `Editar ${screen.singular}` : `Detalhes do ${screen.singular}`}
        description="Campos alinhados diretamente às tabelas canônicas. Instâncias, níveis e catálogos são selecionados por ID e mantidos em seus próprios cadastros."
        onClose={closeDrawer}
        footer={
          drawerMode === 'view' ? (
            <>
              <Button variant="secondary" onClick={closeDrawer}>Fechar</Button>
              {canManage && editingRecord && editingRecord.active ? (
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
                  type={field.inputType}
                  value={form[field.key] ?? ''}
                  className={field.className}
                  readOnly={drawerMode === 'view' || field.readOnly}
                  aria-readonly={drawerMode === 'view' || field.readOnly}
                  onChange={drawerMode === 'view' || field.readOnly ? undefined : (value) => updateForm(field.key, value)}
                />
                {field.description ? <small className="drawer-field__description">{field.description}</small> : null}
              </div>
            ),
          )}
          {kind === 'templates' ? (
            <div className="config-preview">
              <strong>Preview</strong>
              <span>{previewMessage(form.message1)}</span>
              <span>{previewMessage(form.message2)}</span>
              <span>{previewMessage(form.message3)}</span>
              <span>{previewMessage(form.message4)}</span>
            </div>
          ) : null}
        </div>
      </Drawer>


      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
