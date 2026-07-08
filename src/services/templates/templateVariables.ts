export type TemplateVariableContext = {
  company?: string;
  company_name?: string;
  empresa?: string;
  branch?: string;
  ramo?: string;
  city?: string;
  cidade?: string;
  state?: string;
  estado?: string;
  phone?: string;
  whatsapp?: string;
  instagram?: string;
  site?: string;
};

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeKey(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function variableMap(context: TemplateVariableContext) {
  const company = clean(context.company ?? context.company_name ?? context.empresa);
  const branch = clean(context.branch ?? context.ramo);
  const city = clean(context.city ?? context.cidade);
  const state = clean(context.state ?? context.estado);
  const phone = clean(context.phone ?? context.whatsapp);

  return new Map<string, string>([
    ['EMPRESA', company],
    ['NOME_EMPRESA', company],
    ['NOME_DA_EMPRESA', company],
    ['COMPANY', company],
    ['COMPANY_NAME', company],
    ['RAMO', branch],
    ['BRANCH', branch],
    ['CIDADE', city],
    ['CITY', city],
    ['ESTADO', state],
    ['STATE', state],
    ['TELEFONE', phone],
    ['WHATSAPP', phone],
    ['PHONE', phone],
    ['INSTAGRAM', clean(context.instagram)],
    ['SITE', clean(context.site)],
  ]);
}

export function renderTemplateVariables(message: string, context: TemplateVariableContext) {
  const variables = variableMap(context);
  const pattern = /\{\{\s*([^{}[\]]+?)\s*\}\}|\{\s*([^{}[\]]+?)\s*\}|\[\s*([^[\]{}]+?)\s*\]|%\s*([A-Za-z0-9_ -]+?)\s*%/g;

  return String(message ?? '').replace(pattern, (match, doubleBrace, brace, bracket, percent) => {
    const rawKey = doubleBrace ?? brace ?? bracket ?? percent;
    const key = normalizeKey(rawKey);
    const replacement = variables.get(key);
    return replacement || match;
  });
}

export function renderLeadMessages<T extends TemplateVariableContext>(
  lead: T,
  messages: {
    message1?: string;
    message2?: string;
    message3?: string;
    message4?: string;
    message_1?: string;
    message_2?: string;
    message_3?: string;
    message_4?: string;
  },
) {
  const message1 = renderTemplateVariables(messages.message1 ?? messages.message_1 ?? '', lead);
  const message2 = renderTemplateVariables(messages.message2 ?? messages.message_2 ?? '', lead);
  const message3 = renderTemplateVariables(messages.message3 ?? messages.message_3 ?? '', lead);
  const message4 = renderTemplateVariables(messages.message4 ?? messages.message_4 ?? '', lead);
  return {
    message1,
    message2,
    message3,
    message4,
    message_1: message1,
    message_2: message2,
    message_3: message3,
    message_4: message4,
  };
}
