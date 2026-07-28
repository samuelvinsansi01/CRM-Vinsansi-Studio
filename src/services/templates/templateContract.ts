export type FourMessageTemplate = {
  message1?: unknown;
  message2?: unknown;
  message3?: unknown;
  message4?: unknown;
};

export const TEMPLATE_MESSAGE_NUMBERS = [1, 2, 3, 4] as const;

export function missingTemplateMessageNumbers(template: FourMessageTemplate): number[] {
  return TEMPLATE_MESSAGE_NUMBERS.filter((number) => {
    const value = template[`message${number}` as keyof FourMessageTemplate];
    return !String(value ?? '').trim();
  });
}

export function hasAllTemplateMessages(template: FourMessageTemplate): boolean {
  return missingTemplateMessageNumbers(template).length === 0;
}

export function assertAllTemplateMessages(template: FourMessageTemplate): void {
  const missing = missingTemplateMessageNumbers(template);
  if (!missing.length) return;
  throw new Error(`Todo template deve possuir 4 mensagens. Preencha: ${missing.map((number) => `Mensagem ${number}`).join(', ')}.`);
}
