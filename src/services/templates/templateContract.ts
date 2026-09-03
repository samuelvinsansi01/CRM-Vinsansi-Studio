export type FourMessageTemplate = {
  message1?: unknown;
  message2?: unknown;
  message3?: unknown;
  message4?: unknown;
};

export type TemplateMessageChannel = 'WhatsApp' | 'Instagram' | 'Geral';

export const TEMPLATE_MESSAGE_NUMBERS = [1, 2, 3, 4] as const;

function messageText(template: FourMessageTemplate, number: 1 | 2 | 3 | 4) {
  return String(template[`message${number}` as keyof FourMessageTemplate] ?? '').trim();
}

export function configuredTemplateMessageNumbers(template: FourMessageTemplate): number[] {
  return TEMPLATE_MESSAGE_NUMBERS.filter((number) => Boolean(messageText(template, number)));
}

export function missingTemplateMessageNumbers(template: FourMessageTemplate): number[] {
  return TEMPLATE_MESSAGE_NUMBERS.filter((number) => !messageText(template, number));
}

/**
 * Todos os canais aceitam de 1 a 4 mensagens, sempre em sequência contínua.
 * Mensagem 1 é obrigatória; Mensagens 2, 3 e 4 são opcionais.
 */
export function templateMessageContractIssue(
  template: FourMessageTemplate,
  _channel: TemplateMessageChannel,
): string {
  const values = TEMPLATE_MESSAGE_NUMBERS.map((number) => messageText(template, number));

  if (!values[0]) return 'A Mensagem 1 é obrigatória.';

  for (let index = 1; index < values.length; index += 1) {
    if (!values[index] && values.slice(index + 1).some(Boolean)) {
      return `As mensagens devem ser preenchidas em sequência. Preencha a Mensagem ${index + 1} antes das posteriores.`;
    }
  }

  return '';
}

export function hasRequiredTemplateMessages(
  template: FourMessageTemplate,
  channel: TemplateMessageChannel,
): boolean {
  return !templateMessageContractIssue(template, channel);
}

export function assertTemplateMessagesForChannel(
  template: FourMessageTemplate,
  channel: TemplateMessageChannel,
): void {
  const issue = templateMessageContractIssue(template, channel);
  if (issue) throw new Error(issue);
}

/** Compatibilidade: agora significa contrato mínimo global (1..4 em sequência). */
export function hasAllTemplateMessages(template: FourMessageTemplate): boolean {
  return !templateMessageContractIssue(template, 'Geral');
}

/** Compatibilidade: valida o contrato mínimo global (1..4 em sequência). */
export function assertAllTemplateMessages(template: FourMessageTemplate): void {
  const issue = templateMessageContractIssue(template, 'Geral');
  if (issue) throw new Error(issue);
}

