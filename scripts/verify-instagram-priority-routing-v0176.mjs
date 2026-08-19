import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const validation = read('src/services/import/importValidation.ts');
const repository = read('src/repositories/import/supabaseImport.repository.ts');
const importPage = read('src/pages/ImportPage.tsx');
const mapsApi = read('api/maps/extension.ts');

assert(
  validation.includes("if (instagram && settings.routes.instagram)")
    && validation.indexOf("if (instagram && settings.routes.instagram)") < validation.indexOf("if (hasPhone)"),
  'Importação não prioriza Instagram válido antes de telefone/WhatsApp.',
);
assert(
  validation.includes("destination: 'Instagram'")
    && validation.includes("reason: 'instagram válido priorizado como destino inicial'"),
  'Importação não explicita Instagram como destino inicial prioritário.',
);
assert(
  validation.includes('sourceDestination') && validation.includes('classification.sourceDestination'),
  'Importação não preserva a classificação de origem separada do destino operacional.',
);
assert(
  repository.includes('const sourceDestination = lead.original_destination ?? destination;'),
  'Persistência canônica ainda deriva origem apenas do destino atual.',
);
assert(
  repository.includes("row.contact_sources_id === 4")
    && repository.includes("? 'Instagram'")
    && repository.includes("? 'Com site'")
    && repository.includes("? 'Agregadores'"),
  'Releitura do lead não preserva a origem persistida em contact_sources.',
);
assert(
  importPage.includes("const destination = instagram ? 'Instagram' : 'WhatsApp';"),
  'Cadastro manual ainda prioriza WhatsApp quando também existe Instagram.',
);
assert(
  importPage.includes("if (destination === 'WhatsApp' && whatsapp && createResult.lead)"),
  'Cadastro manual ainda dispara validação Evolution mesmo quando o destino inicial é Instagram.',
);
assert(
  importPage.includes("original_destination: whatsapp ? 'WhatsApp' : 'Instagram'"),
  'Cadastro manual não separa origem de destino quando há WhatsApp + Instagram.',
);
assert(
  mapsApi.includes("const destination = instagram ? 'instagram' : 'whatsapp';"),
  'Promoção Google Maps ainda prioriza telefone/WhatsApp sobre Instagram.',
);
assert(
  mapsApi.includes("const sourceKey = phoneWhatsapp ? text(candidate.website_classification || 'sem_site') : 'instagram';"),
  'Promoção Google Maps alterou indevidamente a origem ao trocar a prioridade do destino.',
);

console.log('OK: v0.17.6 prioriza Instagram válido como destino inicial sem apagar a classificação de origem e sem validar WhatsApp indevidamente.');
