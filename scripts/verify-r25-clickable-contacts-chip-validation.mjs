import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');
let checks = 0;
const ok = (value, message) => { checks += 1; assert.ok(value, message); };

const home = read('src/pages/HomePage.tsx');
const review = read('src/components/QueueReviewPanel.tsx');
const reviewService = read('src/services/queue-review/queueReview.service.ts');
const reviewTypes = read('src/services/queue-review/types.ts');
const queuePage = read('src/pages/QueuePage.tsx');
const links = read('src/utils/externalLinks.ts');
const leadCss = read('src/styles/lead-list.css');
const queueCss = read('src/styles/queue.css');

ok(home.includes("{ key: 'site', label: 'Site'"), 'Home sem coluna Site');
ok(home.includes('label="Com site"'), 'Home sem card Com site');
ok(home.includes('company: companyCell(lead)'), 'Empresa da Home não usa link para Maps');
ok(home.includes('mapsHref(lead.mapsUrl)'), 'Home não resolve Google Maps do lead');
ok(home.includes("target=\"_blank\""), 'Links da Home não abrem em outra aba');
ok(home.includes("number: availabilityTag("), 'Número da Home não usa Sim/Não clicável');
ok(home.includes("instagram: availabilityTag("), 'Instagram da Home não usa Sim/Não clicável');
ok(home.includes("site: availabilityTag("), 'Site da Home não usa Sim/Não clicável');
ok(home.includes('whatsappResourceId'), 'Home não mantém chip WhatsApp selecionado');
ok(home.includes('placeholder="Selecione o chip"'), 'Home não exibe seletor explícito de chip');
ok(home.includes("disabled={Boolean(pulling) || !whatsappResourceId}"), 'Home permite puxar WhatsApp sem chip');
ok(home.includes("queueReviewService.pullToCapacity(channel, toLocalDateInputValue(), channel === 'WhatsApp' ? whatsappResourceId : '')"), 'Home não envia chip selecionado ao pull WhatsApp');

for (const label of ['Empresa','Ramo','Estado','Cidade','Nota','Avaliações','Site','Ações']) {
  ok(review.includes(`<th>${label}</th>`), `Revisão sem coluna ${label}`);
}
ok(review.includes('<th>{channel}</th>'), 'Revisão não exibe coluna do canal');
ok(review.includes('companyLink(item)'), 'Empresa da revisão não usa link para Maps');
ok(review.includes('mapsHref(item.mapsUrl)'), 'Revisão não resolve Google Maps');
ok(review.includes("channelAvailability(item, channel)"), 'Canal da revisão não usa Sim/Não clicável');
ok(review.includes("availabilityTag(Boolean(item.website.trim()), externalHttpHref(item.website)"), 'Site da revisão não usa Sim/Não clicável');
ok(review.includes("disabled={loading || pulling || (channel === 'WhatsApp' && !preferredResourceId)}"), 'Revisão permite puxar WhatsApp sem chip');
ok(review.includes("'Selecione um chip para puxar'"), 'Revisão não orienta seleção do chip');
ok(review.includes('<colgroup>'), 'Revisão não possui organização explícita das colunas');

ok(reviewTypes.includes('mapsUrl: string;'), 'QueueReviewItem sem mapsUrl');
ok(reviewService.includes(".select('leads_id,leads_maps')"), 'Serviço de revisão não carrega Maps do lead');
ok(reviewService.includes("if (!preferredResourceId) throw new Error('Selecione um chip específico"), 'Serviço ainda aceita fallback automático de chip no WhatsApp');
ok(reviewService.includes("return fillBatch(channel, resource, scheduledDate, { revalidateExisting: channel === 'WhatsApp' })"), 'Pull WhatsApp não revalida a revisão aberta com o chip selecionado');
ok(reviewService.includes('whatsappValidationService.validateInitialWithChip(existingIds, resource.id)'), 'Revisão existente não é revalidada pelo chip selecionado');
ok(reviewService.includes('whatsappValidationService.validateInitialWithChip(reserved, resource.id)'), 'Novos leads não são validados pelo chip selecionado');

ok(queuePage.includes('preferredResourceId={activeChip}'), 'Tela de disparos não passa o chip selecionado para revisão');
ok(queuePage.includes('mapsHref(lead.mapsUrl)'), 'Listagens de fila não mantêm empresa clicável para Maps');

for (const helper of ['externalHttpHref','mapsHref','instagramHref','whatsappHref','phoneHref']) {
  ok(links.includes(`function ${helper}`) || links.includes(`export function ${helper}`), `Helper ${helper} ausente`);
}
ok(leadCss.includes('.company-map-link') && leadCss.includes('.availability-link'), 'CSS dos links clicáveis não foi aplicado');
ok(queueCss.includes('.queue-review-col--company') && queueCss.includes('table-layout: fixed'), 'Tabela de revisão não foi reorganizada');

console.log(`R25 links + chip + revisão WhatsApp: PASS (${checks} verificações)`);
