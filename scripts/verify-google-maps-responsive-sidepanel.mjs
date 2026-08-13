import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const html = fs.readFileSync(path.join(extensionRoot, 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(extensionRoot, 'sidepanel.css'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/google-maps-responsive-sidepanel.json'), 'utf8'));
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(fixture.widths.join(',') === '460,360,300', 'Fixture não cobre 460px, 360px e 300px.');
assert(html.includes('name="viewport"') && html.includes('width=device-width'), 'Side Panel não declara viewport responsivo.');
assert(css.includes('body { min-width: 0') && css.includes('overflow-x: hidden'), 'Layout ainda pode impor largura ou overflow horizontal estrutural.');
assert(css.includes('repeat(auto-fit, minmax(84px, 1fr))'), 'Métricas não redistribuem colunas conforme a largura.');
assert(css.includes('repeat(auto-fit, minmax(88px, 1fr))'), 'Controles não quebram linha de forma responsiva.');
assert(css.includes('.execution-controls-sticky { position: sticky') && css.includes('z-index: 3'), 'Controles críticos não permanecem sticky e acima do conteúdo.');
assert(/@media \(max-width: 340px\)[\s\S]*\.configuration-grid[^}]*grid-template-columns: 1fr/.test(css), 'Painel estreito não reduz configuração a uma coluna.');
assert(/@media \(max-width: 300px\)[\s\S]*\.primary-actions, \.metrics, \.target-preview, \.operational-metrics, \.configuration-preview[^}]*grid-template-columns: 1fr/.test(css), 'Layout de 300px não reduz métricas e ações essenciais com segurança.');
assert(css.includes('.candidate-actions { grid-template-columns: repeat(auto-fit') && css.includes('.candidate-card { grid-template-columns: 20px minmax(0, 1fr);'), 'Aba Leads pode cortar ações/cards em painel estreito.');
assert(css.includes('overflow-wrap: anywhere') && !/[;{]\s*width:\s*(?:3\d\d|4\d\d)px/.test(css), 'Textos ou containers dependem de largura rígida.');

for (const id of [...fixture.requiredControls, ...fixture.requiredLeadActions, 'branchSelect', 'stateSelect', 'citySelect', 'daysSelect', 'mode']) {
  assert(html.includes(`id="${id}"`), `Controle responsivo ausente: ${id}.`);
}

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: Side Panel cobre 460/360/300px sem largura fixa, overflow horizontal ou controles cortados.');
