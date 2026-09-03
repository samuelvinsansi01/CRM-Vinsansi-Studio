export type WhatsAppContactFields = {
  leads_whatsapp?: unknown;
  leads_phone?: unknown;
};

export function getEffectiveWhatsAppPhone(lead: WhatsAppContactFields) {
  return String(lead.leads_whatsapp ?? '').trim()
    || String(lead.leads_phone ?? '').trim();
}
