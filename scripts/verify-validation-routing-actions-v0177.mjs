import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'src/pages/ValidationRoutingPage.tsx'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'src/services/lead-cycle/leadRouting.rules.ts'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src/services/lead-cycle/types.ts'), 'utf8');
const table = fs.readFileSync(path.join(root, 'src/design-system/components/data-display/DataTable.tsx'), 'utf8');

const checks = [
  [page.includes('instagram: instagramCell(lead.instagram)'), 'Instagram deve renderizar apenas pela célula Sim/Não'],
  [page.includes('https://www.instagram.com/${encodeURIComponent(username)}/'), 'Sim do Instagram deve conter link do perfil'],
  [!page.includes('Pronto para aprovar') && !page.includes('Corrigir Instagram') && !page.includes('Adicionar Instagram'), 'Tabela não deve exibir estados textuais no campo Instagram'],
  [page.includes("if (lead.statusId === 1) return ['validate', 'edit', 'invalidate'];"), 'Importado deve exibir Validar, Editar e Invalidar'],
  [page.includes("if (lead.statusId === 2) return ['return', 'edit', 'invalidate'];"), 'Validado deve exibir Retornar, Editar e Invalidar'],
  [types.includes("'return-valid-to-imported'"), 'Comando de retorno deve existir no contrato'],
  [rules.includes("'return-valid-to-imported': { expectedStatus: LEAD_STATUS.VALIDATED, targetStatus: LEAD_STATUS.IMPORTED }"), 'Retorno deve mover Validado para Importado sem trocar canal'],
  [table.includes("return: 'Retornar para Importado'"), 'Tooltip da ação de retorno deve ser claro'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, message] of failed) console.error(`FAIL: ${message}`);
  process.exit(1);
}
console.log('Validação e roteamento: Instagram Sim/Não linkável + ações por status OK.');
