import { normalizeBrazilState } from '../geo/brazilState';
import { normalizeInstagramUsername } from '../instagram/instagram.utils';
import { normalizePhone, normalizeSiteIdentity } from './importValidation';
import type { ImportLead, ImportLeadDestination } from './types';

export type NormalizedLeadIdentity = {
  phone: string;
  site: string;
  instagram: string;
  mapsUrl: string;
};

export type NormalizedLeadContact = {
  phone: string | null;
  instagram: string | null;
  website: string | null;
  mapsUrl: string | null;
  state: string;
  city: string;
  categories: string[];
  identity: NormalizedLeadIdentity;
};

function compactUnique(values: unknown[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  values.forEach((value) => {
    const text = String(value ?? '').trim();
    const key = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    output.push(text);
  });

  return output;
}

function normalizeMapsUrl(value: unknown) {
  return String(value ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

function normalizedWebsite(value: unknown) {
  const raw = String(value ?? '').trim();
  return normalizeSiteIdentity(raw) ? raw : '';
}

export function normalizeLeadContact(lead: ImportLead): NormalizedLeadContact {
  const phone = normalizePhone(lead.normalizedPhone || lead.whatsapp);
  const instagram = normalizeInstagramUsername(lead.normalizedInstagram || lead.instagram_url || lead.instagram);
  const website = normalizedWebsite(lead.site);
  const mapsUrl = normalizeMapsUrl(lead.normalizedMapsUrl);

  return {
    phone: phone || null,
    instagram: instagram || null,
    website: website || null,
    mapsUrl: mapsUrl || null,
    state: normalizeBrazilState(lead.estado),
    city: String(lead.cidade ?? '').trim(),
    categories: compactUnique([lead.subcategoria, lead.ramo]),
    identity: {
      phone,
      site: normalizeSiteIdentity(website),
      instagram,
      mapsUrl,
    },
  };
}

export function classifyLeadContact(destination: ImportLeadDestination) {
  if (destination === 'Instagram') return { channelId: 2, contactSourceId: 4 } as const;
  if (destination === 'Com site') return { channelId: 1, contactSourceId: 2 } as const;
  if (destination === 'Agregadores') return { channelId: 1, contactSourceId: 3 } as const;
  return { channelId: 1, contactSourceId: 1 } as const;
}
