import type {
  BranchConfigRecord,
  ChipConfigRecord,
  ConfigRecord,
  InstagramConfigRecord,
  TemplateConfigRecord,
} from './types';
import { assertTemplateMessagesForChannel, hasRequiredTemplateMessages } from '../templates/templateContract';

const SAFE_INSTAGRAM_USERNAME = /^[a-z0-9._]{1,30}$/;
const ACTIVE_CONFIG_STATUSES = new Set(['ativo', 'active']);

function comparable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function isActive(record: ConfigRecord) {
  return record.active && ACTIVE_CONFIG_STATUSES.has(comparable(record.status));
}

function assertBranch(record: BranchConfigRecord, records: ConfigRecord[], editingId?: string) {
  if (record.name.trim().length < 2) throw new Error('O nome do ramo deve possuir pelo menos 2 caracteres.');

  const duplicate = records.find((item) =>
    item.kind === 'branches' &&
    item.id !== editingId &&
    comparable(item.name) === comparable(record.name),
  );
  if (duplicate) throw new Error('Ja existe um ramo com este nome.');
}

function assertTemplate(record: TemplateConfigRecord, records: ConfigRecord[], editingId?: string) {
  if (record.name.trim().length < 2) throw new Error('Informe um nome valido para o template.');
  if (!record.templateChannelId) throw new Error('Selecione um canal de template.');
  if (!record.templateTypeId) throw new Error('Selecione um tipo de template.');
  const branch = records.find((item): item is BranchConfigRecord => item.kind === 'branches' && item.id === record.branchId);
  if (!branch) throw new Error('O ramo selecionado nao existe.');
  if (record.active && !isActive(branch)) throw new Error('Nao e possivel ativar um template de ramo inativo.');

  assertTemplateMessagesForChannel(record, record.channel);
  [record.message1, record.message2, record.message3, record.message4].forEach((message, index) => {
    const text = message.trim();
    if (text.length > 4000) throw new Error(`A Mensagem ${index + 1} excede 4000 caracteres.`);
  });

  const signature = [record.message1, record.message2, record.message3, record.message4].map(comparable).join('|');
  const duplicate = records.find((item) =>
    item.kind === 'templates' &&
    item.id !== editingId &&
    item.branchId === record.branchId &&
    item.templateChannelId === record.templateChannelId &&
    item.templateTypeId === record.templateTypeId &&
    [item.message1, item.message2, item.message3, item.message4].map(comparable).join('|') === signature,
  );
  if (duplicate) throw new Error('Ja existe um template identico para este ramo, canal e tipo.');
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function assertChip(record: ChipConfigRecord, records: ConfigRecord[], editingId?: string) {
  if (record.name.trim().length < 2) throw new Error('Informe um nome valido para o chip.');
  if (!record.instanceId) throw new Error('Selecione uma instancia para o chip.');
  if (!record.levelId) throw new Error('Selecione um nivel para o chip.');

  const phone = normalizePhone(record.number);
  if (phone.length < 10 || phone.length > 15) {
    throw new Error('O numero do chip deve conter entre 10 e 15 digitos, incluindo DDI e DDD.');
  }

  const duplicate = records.find((item) => {
    if (item.kind !== 'chips' || item.id === editingId) return false;
    const sameInstance = item.instanceId === record.instanceId;
    const samePhone = phone && normalizePhone(item.number) === phone;
    return sameInstance || samePhone;
  });
  if (duplicate) throw new Error('Ja existe um chip com esta instancia ou numero.');
}

function assertInstagram(record: InstagramConfigRecord, records: ConfigRecord[], editingId?: string) {
  if (record.name.trim().length < 2) throw new Error('Informe um nome valido para o perfil Instagram.');
  if (!SAFE_INSTAGRAM_USERNAME.test(record.username)) {
    throw new Error('O usuario do Instagram deve conter ate 30 caracteres: letras, numeros, ponto ou sublinhado.');
  }
  if (!record.levelId) throw new Error('Selecione um nivel para o perfil Instagram.');

  const duplicate = records.find((item) =>
    item.kind === 'instagram' &&
    item.id !== editingId &&
    comparable(item.username) === comparable(record.username),
  );
  if (duplicate) throw new Error('Ja existe um perfil com este usuario do Instagram.');
}

export function assertOperationalConfigRecord(record: ConfigRecord, records: ConfigRecord[], editingId?: string) {
  if (record.kind === 'branches') return assertBranch(record, records, editingId);
  if (record.kind === 'templates') return assertTemplate(record, records, editingId);
  if (record.kind === 'chips') return assertChip(record, records, editingId);
  return assertInstagram(record, records, editingId);
}

export type OperationalReadiness = {
  ready: boolean;
  activeBranches: number;
  activeTemplates: number;
  activeChips: number;
  activeInstagramProfiles: number;
  issues: string[];
};

export function buildOperationalReadiness(records: ConfigRecord[]): OperationalReadiness {
  const activeBranches = records.filter((item) => item.kind === 'branches' && isActive(item)).length;
  const activeTemplates = records.filter((item) => item.kind === 'templates' && isActive(item) && hasRequiredTemplateMessages(item, item.channel)).length;
  const activeChips = records.filter((item) => item.kind === 'chips' && isActive(item)).length;
  const activeInstagramProfiles = records.filter((item) => item.kind === 'instagram' && isActive(item)).length;
  const issues: string[] = [];

  if (!activeBranches) issues.push('Nenhum ramo ativo.');
  if (!activeTemplates) issues.push('Nenhum template ativo e pronto para uso.');
  if (!activeChips) issues.push('Nenhum chip WhatsApp ativo e configurado.');
  if (!activeInstagramProfiles) issues.push('Nenhum perfil Instagram ativo.');

  return {
    ready: issues.length === 0,
    activeBranches,
    activeTemplates,
    activeChips,
    activeInstagramProfiles,
    issues,
  };
}
