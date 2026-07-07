import type { TemplateChannel, TemplateConfigRecord, TemplateType } from '../config/types';

type LeadTemplateContext = {
  branch?: string;
  branch_id?: string;
  channel: 'WhatsApp' | 'Instagram';
  destination: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  templateId?: string;
};

export type TemplateSelectionSource =
  | 'assigned'
  | 'branch-channel-type'
  | 'branch-general-type'
  | 'branch-channel-fallback-type'
  | 'branch-general-fallback-type'
  | 'global-channel-type'
  | 'global-general-type'
  | 'global-channel-fallback-type'
  | 'global-general-fallback-type';

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

function compatibleTemplates(templates: TemplateConfigRecord[], lead: LeadTemplateContext) {
  return templates.filter(isActiveTemplate);
}

/**
 * Seleciona um template sem misturar canal, ramo e tipo. "Geral" é um canal
 * compatível com WhatsApp e Instagram. Entre candidatos do mesmo nível, a
 * escolha é sorteada e depois pode ser fixada no lead por quem chama esta função.
 */
export function selectTemplateForLead(
  lead: LeadTemplateContext,
  templates: TemplateConfigRecord[],
): TemplateSelection | undefined {
  const active = compatibleTemplates(templates, lead);
  const expectedType = destinationToTemplateType(lead.destination);
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
      source: 'branch-channel-fallback-type',
      candidates: specificBranch.filter((template) => matchesChannel(template, lead.channel, lead.channel)),
    },
    {
      source: 'branch-general-fallback-type',
      candidates: specificBranch.filter((template) => matchesChannel(template, lead.channel, 'Geral')),
    },
    {
      source: 'global-channel-type',
      candidates: globalBranch.filter((template) => matchesChannel(template, lead.channel, lead.channel) && template.type === expectedType),
    },
    {
      source: 'global-general-type',
      candidates: globalBranch.filter((template) => matchesChannel(template, lead.channel, 'Geral') && template.type === expectedType),
    },
    {
      source: 'global-channel-fallback-type',
      candidates: globalBranch.filter((template) => matchesChannel(template, lead.channel, lead.channel)),
    },
    {
      source: 'global-general-fallback-type',
      candidates: globalBranch.filter((template) => matchesChannel(template, lead.channel, 'Geral')),
    },
  ];

  const selected = active.find((template) => template.id === lead.templateId);
  if (selected) {
    const selectedTier = tiers.find((tier) => tier.candidates.some((candidate) => candidate.id === selected.id));
    if (selectedTier) return { template: selected, source: 'assigned', randomized: false };
  }

  const tier = tiers.find((item) => item.candidates.length > 0);
  if (!tier) return undefined;
  return { template: chooseRandom(tier.candidates), source: tier.source, randomized: true };
}
