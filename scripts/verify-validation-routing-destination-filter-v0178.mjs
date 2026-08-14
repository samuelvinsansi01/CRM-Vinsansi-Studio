import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'src/pages/ValidationRoutingPage.tsx'), 'utf8');

const checks = [
  [page.includes("type DestinationFilter = 'Todos' | 'WhatsApp' | 'Instagram';"), 'Filtro de destino deve ter WhatsApp e Instagram'],
  [page.includes("const [destination, setDestination] = useState<DestinationFilter>('Todos');"), 'Estado deve ser de destino e não de origem'],
  [page.includes("const matchesDestination = destination === 'Todos' || lead.channel === destination;"), 'Filtro deve comparar com o canal/destino do lead'],
  [page.includes('value={destination}') && page.includes('placeholder="Destino"'), 'Dropdown deve ser identificado como Destino'],
  [page.includes("options={['Todos', 'WhatsApp', 'Instagram']}"), 'Dropdown deve listar apenas destinos operacionais'],
  [!page.includes('value={source} options='), 'Filtro antigo de origem não deve permanecer no lugar do destino'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, message] of failed) console.error(`FAIL: ${message}`);
  process.exit(1);
}
console.log('Validação e roteamento v0.17.8: filtro de Destino filtra lead.channel corretamente.');
