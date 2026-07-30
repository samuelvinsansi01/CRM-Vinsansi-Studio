import fs from 'node:fs';

const page = fs.readFileSync('src/pages/ImportPage.tsx', 'utf8');
const service = fs.readFileSync('src/services/apify-import/apifyImport.service.ts', 'utf8');
const start = fs.readFileSync('supabase/functions/apify-google-maps-start/index.ts', 'utf8');

const failures = [];
if (page.includes('label="Termos de busca"') || page.includes('mapsSearchTerms') || page.includes('normalizedSearchTerms')) failures.push('Campo manual de termos ainda existe.');
if (!page.includes('A busca usará somente o ramo')) failures.push('Aviso de busca canônica por ramo ausente.');
if (!page.includes('title="Execuções Apify"') || !page.includes('<DataTable')) failures.push('Tabela de execuções não está padronizada.');
if (page.includes('<th>Termos</th>') || page.includes('selectedJob.searchTerms')) failures.push('Termos ainda aparecem na tabela/detalhe.');
if (service.includes('searchTerms,') || service.includes('normalizeTerms(input.searchTerms)')) failures.push('Frontend ainda envia termos livres.');
if (!service.includes('branches:branches_id(branches_name)')) failures.push('Listagem não resolve o ramo pela FK.');
if (!service.includes('legacyTerms[0]')) failures.push('Fallback para runs legados sem branch_name ausente.');
if (!start.includes('const searchStrings = [branchName]')) failures.push('Edge Function não deriva o termo exclusivamente do ramo.');
if (start.includes('body.searchTerms') || start.includes('body.search_terms')) failures.push('Edge Function ainda aceita termos livres do cliente.');
if (!start.includes('.eq("users_id", usersId)')) failures.push('Ramo não está escopado ao usuário autenticado.');
if (!start.includes('locationQuery,') || !start.includes('searchStringsArray: searchStrings')) failures.push('Ramo e localização não estão separados no payload da Apify.');
if (!service.includes('branches:branches_id(branches_id, branches_name)')) failures.push('Histórico por ramo não resolve a FK antes de filtrar localidades.');
if (!service.includes('const canonicalStoredBranch = normalize(')) failures.push('Histórico não usa identidade canônica do ramo.');
if (!service.includes('canonicalStoredBranch === expectedBranch')) failures.push('Localidades não estão isoladas pela combinação ramo + cidade.');
if (!start.includes('const { data: activeJobs')) failures.push('Backend não lista jobs ativos por localização para validar o ramo canônico.');
if (!start.includes('canonicalStoredBranch === expectedBranch')) failures.push('Backend não valida duplicidade ativa pela combinação ramo + localização.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Contrato Apify por ramo validado.');
