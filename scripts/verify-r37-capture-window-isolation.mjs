import fs from 'node:fs';

const route = fs.readFileSync('server/routes/maps/extension.ts', 'utf8');
const checks = [
  ['candidates_list exige execução proprietária', route.includes("if (action === 'candidates_list')") && route.includes("const execution = await ownedExecution(client, usersId, text(input.executionId));")],
  ['leitura de revisão filtra por executionId', route.includes(".eq('maps_search_executions_id', execution.maps_search_executions_id)\n        .in('review_state', ['pending','rejected','invalid'])")],
  ['limpeza de revisão é escopada pela execução', route.includes("if (action === 'review_queue_clear')") && route.includes(".eq('maps_search_executions_id', execution.maps_search_executions_id).in('review_state'")],
  ['edição/recusa/restauração exige candidato da execução', route.includes("maps_candidate_not_found_in_execution") && route.includes("requestedExecution.maps_search_executions_id")],
  ['promoção exige executionId', route.includes("const requestedExecution = await ownedExecution(client, usersId, text(input.executionId));") && route.includes("maps_leads_promote_execution_mismatch")],
  ['update final permanece na execução', route.includes(".eq('maps_search_executions_id', execution.maps_search_executions_id).select('*').single()")],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'OK' : 'FAIL'} - ${name}`);
if (failed.length) process.exit(1);
console.log(`R37: ${checks.length}/${checks.length} verificações de isolamento por janela aprovadas.`);
