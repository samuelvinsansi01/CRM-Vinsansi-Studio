import type {
  BranchConfigRecord,
  ChipConfigRecord,
  ConfigRecord,
  InstagramConfigRecord,
  TemplateConfigRecord,
} from './types';

const SAFE_IMAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|webp|gif)$/i;
const SAFE_BRANCH_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

function assertRange(label: string, value: number, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} deve estar entre ${min} e ${max}.`);
  }
}

function timeToMinutes(value: string) {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function assertTimeWindow(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) throw new Error('Informe uma janela de horario valida no formato HH:mm.');
  if (start >= end) throw new Error('O horario inicial deve ser anterior ao horario final.');
  return { start, end };
}

function assertBranch(record: BranchConfigRecord, records: ConfigRecord[], editingId?: string) {
  if (record.name.trim().length < 2) throw new Error('O nome do ramo deve possuir pelo menos 2 caracteres.');
  if (!SAFE_BRANCH_SLUG.test(record.slug)) throw new Error('O slug do ramo deve conter somente letras minusculas, numeros e hifens.');
  assertRange('A nota minima', record.minRating, 0, 5);
  assertRange('A quantidade minima de avaliacoes', record.minReviews, 0, 1_000_000);

  if (record.imageRequired && !record.imageName.trim()) {
    throw new Error('Informe o nome da imagem quando a midia for obrigatoria.');
  }
  if (record.imageName && !SAFE_IMAGE_NAME.test(record.imageName)) {
    throw new Error('O nome da imagem deve ser um arquivo JPG, PNG, WEBP ou GIF sem caminho de pasta.');
  }

  const duplicate = records.find((item) =>
    item.kind === 'branches' &&
    item.id !== editingId &&
    (comparable(item.name) === comparable(record.name) || comparable(item.slug) === comparable(record.slug)),
  );
  if (duplicate) throw new Error('Ja existe um ramo com este nome ou slug.');
}

function assertTemplate(record: TemplateConfigRecord, records: ConfigRecord[], editingId?: string) {
  const branch = records.find((item): item is BranchConfigRecord => item.kind === 'branches' && item.id === record.branchId);
  if (!branch) throw new Error('O ramo selecionado nao existe.');
  if (record.active && !isActive(branch)) throw new Error('Nao e possivel ativar um template de ramo inativo ou arquivado.');

  [record.message1, record.message2, record.message3, record.message4].forEach((message, index) => {
    const text = message.trim();
    if (!text) throw new Error(`A Mensagem ${index + 1} e obrigatoria.`);
    if (text.length > 4000) throw new Error(`A Mensagem ${index + 1} excede 4000 caracteres.`);
  });

  const signature = [record.message1, record.message2, record.message3, record.message4].map(comparable).join('|');
  const duplicate = records.find((item) =>
    item.kind === 'templates' &&
    item.id !== editingId &&
    item.branchId === record.branchId &&
    item.channel === record.channel &&
    item.type === record.type &&
    [item.message1, item.message2, item.message3, item.message4].map(comparable).join('|') === signature,
  );
  if (duplicate) throw new Error('Ja existe um template identico para este ramo, canal e tipo.');
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function assertChip(record: ChipConfigRecord, records: ConfigRecord[], editingId?: string) {
  if (record.name.trim().length < 2) throw new Error('Informe um nome valido para o chip.');
  if (!/^[a-zA-Z0-9._-]{2,100}$/.test(record.instance)) {
    throw new Error('A instancia deve conter somente letras, numeros, ponto, hifen ou sublinhado.');
  }

  const phone = normalizePhone(record.number);
  if (record.number && (phone.length < 10 || phone.length > 15)) {
    throw new Error('O numero do chip deve conter entre 10 e 15 digitos, incluindo DDI e DDD.');
  }

  if (record.active) {
    if (!record.url.trim()) throw new Error('A URL da Evolution e obrigatoria para um chip ativo.');
    if (!record.apiKey.trim()) throw new Error('A API Key e obrigatoria para um chip ativo.');
  }

  if (record.url) {
    let url: URL;
    try {
      url = new URL(record.url);
    } catch {
      throw new Error('Informe uma URL valida para a Evolution.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A URL da Evolution deve usar HTTP ou HTTPS.');
  }

  const { start, end } = assertTimeWindow(record.startTime, record.endTime);
  assertRange('O limite diario', record.dailyLimit, 1, 10000);
  assertRange('O intervalo entre leads', record.intervalSeconds, 10, 86400);
  assertRange('O tamanho do lote', record.blockSize, 1, record.dailyLimit);
  assertRange('A prioridade', record.priority, 1, 999);

  const uniqueBatches = new Set(record.batches);
  if (!record.batches.length) throw new Error('Configure pelo menos um horario de lote.');
  if (uniqueBatches.size !== record.batches.length) throw new Error('Existem horarios de lote duplicados.');
  for (const batch of record.batches) {
    const minutes = timeToMinutes(batch);
    if (minutes === null) throw new Error(`Horario de lote invalido: ${batch}.`);
    if (minutes < start || minutes > end) throw new Error(`O lote ${batch} esta fora da janela operacional.`);
  }

  const duplicate = records.find((item) => {
    if (item.kind !== 'chips' || item.id === editingId) return false;
    const sameInstance = comparable(item.instance) === comparable(record.instance);
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
  assertRange('O limite diario do Instagram', record.dailyLimit, 1, 1000);

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
  const activeTemplates = records.filter((item) => item.kind === 'templates' && isActive(item)).length;
  const activeChips = records.filter((item) => item.kind === 'chips' && isActive(item)).length;
  const activeInstagramProfiles = records.filter((item) => item.kind === 'instagram' && isActive(item)).length;
  const issues: string[] = [];

  if (!activeBranches) issues.push('Nenhum ramo ativo.');
  if (!activeTemplates) issues.push('Nenhum template ativo com quatro mensagens.');
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
