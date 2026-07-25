import type { TemplateChannel, TemplateConfigRecord, TemplateType } from '../config/types';

type LeadTemplateContext = {
  branch?: string;
  branch_id?: string;
  channel: 'WhatsApp' | 'Instagram';
  destination: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  original_destination?: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  /** Classificação persistida quando disponível. Evita que uma troca de canal altere o tipo da mensagem. */
  templateType?: TemplateType;
  /** Site efetivamente encontrado no lead. */
  site?: string | null;
  templateId?: string;
};

export type TemplateSelectionSource =
  | 'assigned'
  | 'branch-channel-type'
  | 'branch-general-type'
  | 'global-channel-type'
  | 'global-general-type';

export type TemplateSelection = {
  template: TemplateConfigRecord;
  source: TemplateSelectionSource;
  randomized: boolean;
};

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function isActiveTemplate(template: TemplateConfigRecord) {
  return Boolean(template.active) &&
    template.status !== 'Arquivado' &&
    template.status !== 'deleted' &&
    Boolean(template.message1?.trim());
}

function isEmptySiteValue(value: unknown) {
  const normalized = normalize(value);
  return !normalized || [
    '-',
    'n/a',
    'na',
    'none',
    'null',
    'undefined',
    'sem site',
    'sem-site',
    'nao possui',
    'não possui',
    'nao tem',
    'não tem',
  ].includes(normalized);
}

function isSocialOrContactOnlyUrl(value: unknown) {
  const normalized = normalize(value)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  return [
    'instagram.com',
    'facebook.com',
    'fb.com',
    'wa.me',
    'whatsapp.com',
    'api.whatsapp.com',
  ].some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

/** Retorna se o valor representa um site comercial próprio, não rede social ou contato. */
export function hasWebsiteForTemplate(value: unknown) {
  return !isEmptySiteValue(value) && !isSocialOrContactOnlyUrl(value);
}

/**
 * Define o grupo de template pelo dado do lead, não pelo canal de destino.
 * Assim, um retorno WhatsApp -> Instagram continua usando "com-site" quando
 * já possuía site antes da troca de canal.
 */
export function templateTypeForLead(lead: LeadTemplateContext): TemplateType {
  if (lead.templateType === 'com-site' || lead.templateType === 'sem-site') return lead.templateType;

  // A presença de um site no próprio lead é a fonte mais confiável para registros
  // atuais e para aprovações diretas em Instagram.
  if (hasWebsiteForTemplate(lead.site)) return 'com-site';

  // Registros legados podem não trazer site completo no Pré-Envio. Neles, a
  // classificação original da importação preserva a decisão feita na entrada.
  const originalDestination = normalize(lead.original_destination);
  if (originalDestination === 'com site' || originalDestination === 'agregadores' || originalDestination === 'agregador') {
    return 'com-site';
  }

  // Último fallback apenas para registros antigos sem site/origem persistidos.
  return destinationToTemplateType(lead.destination);
}

/** Compatibilidade para registros legados que ainda só guardam destination. */
export function destinationToTemplateType(destination: LeadTemplateContext['destination']): TemplateType {
  return destination === 'Com site' || destination === 'Agregadores' ? 'com-site' : 'sem-site';
}

function isGlobalBranch(template: TemplateConfigRecord) {
  const values = [template.branchId, template.branchName].map(normalize);
  return values.some((value) => ['', '*', 'geral', 'global', 'todos', 'todas'].includes(value));
}

function matchesBranch(template: TemplateConfigRecord, lead: LeadTemplateContext) {
  if (isGlobalBranch(template)) return false;
  const leadBranchId = normalize(lead.branch_id);
  const leadBranch = normalize(lead.branch);
  const templateBranchId = normalize(template.branchId);
  const templateBranch = normalize(template.branchName);

  return Boolean(
    (leadBranchId && templateBranchId && leadBranchId === templateBranchId) ||
    (leadBranch && templateBranch && leadBranch === templateBranch) ||
    (leadBranch && templateBranchId && leadBranch === templateBranchId),
  );
}

function matchesChannel(template: TemplateConfigRecord, channel: LeadTemplateContext['channel'], expected: TemplateChannel) {
  if (expected === 'Geral') return template.channel === 'Geral';
  return template.channel === channel;
}

function chooseRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function compatibleTemplates(templates: TemplateConfigRecord[]) {
  return templates.filter(isActiveTemplate);
}

/**
 * Hierarquia obrigatória, sempre sem misturar com-site e sem-site:
 * 1. Ramo + canal do lead + tipo exato
 * 2. Ramo + Geral + tipo exato
 * 3. Global + canal do lead + tipo exato
 * 4. Global + Geral + tipo exato
 *
 * Templates já atribuídos só permanecem quando ainda pertencem ao melhor nível
 * disponível. Isso corrige automaticamente alocações antigas de tipo errado ou
 * que ficaram em Geral mesmo existindo template específico de canal.
 */
export function selectTemplateForLead(
  lead: LeadTemplateContext,
  templates: TemplateConfigRecord[],
): TemplateSelection | undefined {
  const active = compatibleTemplates(templates);
  const expectedType = templateTypeForLead(lead);
  const specificBranch = active.filter((template) => matchesBranch(template, lead));
  const globalBranch = active.filter((template) => isGlobalBranch(template));

  const tiers: Array<{ source: Exclude<TemplateSelectionSource, 'assigned'>; candidates: TemplateConfigRecord[] }> = [
    {
      source: 'branch-channel-type',
      candidates: specificBranch.filter((template) => matchesChannel(template, lead.channel, lead.channel) && template.type === expectedType),
    },
    {
      source: 'branch-general-type',
      candidates: specificBranch.filter((template) => matchesChannel(template, lead.channel, 'Geral') && template.type === expectedType),
    },
    {
      source: 'global-channel-type',
      candidates: globalBranch.filter((template) => matchesChannel(template, lead.channel, lead.channel) && template.type === expectedType),
    },
    {
      source: 'global-general-type',
      candidates: globalBranch.filter((template) => matchesChannel(template, lead.channel, 'Geral') && template.type === expectedType),
    },
  ];

  const bestTier = tiers.find((tier) => tier.candidates.length > 0);
  if (!bestTier) return undefined;

  const assigned = active.find((template) => template.id === lead.templateId);
  if (assigned && bestTier.candidates.some((candidate) => candidate.id === assigned.id)) {
    return { template: assigned, source: 'assigned', randomized: false };
  }

  return { template: chooseRandom(bestTier.candidates), source: bestTier.source, randomized: true };
}
