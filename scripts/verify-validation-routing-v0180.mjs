import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/ValidationRoutingPage.tsx', import.meta.url), 'utf8');
const mapper = fs.readFileSync(new URL('../src/mappers/lead.mapper.ts', import.meta.url), 'utf8');

const required = [
  "const [source, setSource] = useState<SourceFilter>('Todos');",
  "const matchesSource = source === 'Todos' || sourceName(lead) === source;",
  "&& matchesSource",
  "[allRecords, branch, destination, search, source, state, status]",
  'className="metric-grid metric-grid--3"',
  'value={String(totalRecords)} label="Total"',
  'value={String(whatsappTotal)} label="WhatsApp"',
  'value={String(instagramTotal)} label="Instagram"',
  "value={source} options={['Todos', 'Sem site', 'Domínio próprio', 'Agregador', 'Instagram']} placeholder=\"Origem\"",
  "status === 'Aguardando validação' && lead.statusId === 3",
];

for (const token of required) {
  if (!page.includes(token)) throw new Error(`ValidationRoutingPage sem contrato v0.18.0: ${token}`);
}

if (page.includes('label="Com site"')) throw new Error('Card Com site ainda existe na Validação e roteamento.');
if (page.includes('label="Agregador"')) throw new Error('Card Agregador ainda existe na Validação e roteamento.');
if (!mapper.includes("3: 'pre_envio'")) throw new Error('Status 3 deixou de mapear para pre_envio.');

console.log('Validation routing v0.18.0: 3 cards, filtro de origem/contact source e status pre_envio OK.');
