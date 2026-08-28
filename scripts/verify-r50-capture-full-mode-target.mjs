import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'server/routes/maps/extension.ts'), 'utf8');
const required = [
  `const searchStrategy = text(input.searchStrategy) === 'until_target' ? 'until_target' : 'exhaust_feed'`,
  `desiredCompanyCount: desiredCompanies, searchStrategy, qualityCriteria`,
  `function executionSearchStrategy(execution: Row)`,
  `executionSearchStrategy(execution) === 'until_target'`,
  `function acquisitionTargetIsHardStop(execution: Row, counts: Row, desiredLimitReported = false)`,
  `const hardTargetMode = executionSearchStrategy(execution) === 'until_target'`,
  `const remainingNeeded = hardTargetMode && desiredCompanyCount > 0`,
  `const targetStop = acquisitionTargetIsHardStop(execution, counts, desiredLimitReported)`,
  `stopAfterCurrentCoverage: targetStop`,
];
for (const token of required) {
  if (!source.includes(token)) throw new Error(`R50: contrato ausente: ${token}`);
}
if (source.includes(`const remainingNeeded = desiredCompanyCount > 0 ?`)) {
  throw new Error('R50: batch_sync ainda limita o modo completo pela meta.');
}
if (source.includes(`if (targetsReached) {\n          await client.from('maps_search_executions').update({ status: 'completed'`)) {
  throw new Error('R50: coverage_transition ainda encerra qualquer estrategia pela meta.');
}
if (!source.includes(`return text((execution.runner_strategy as Row | null)?.searchStrategy) === 'until_target' ? 'until_target' : 'exhaust_feed'`)) {
  throw new Error('R50: fallback de estrategia nao preserva Esgotar Maps.');
}
console.log('R50 capture full-mode target semantics guard: ok');
