import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const registry = fs.readFileSync(path.join(root, 'src/pages/pageRegistry.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const header = fs.readFileSync(path.join(root, 'src/design-system/layouts/Header.tsx'), 'utf8');

const requiredLabels = [
  'Início',
  'Leads',
  'Importação',
  'Validação e roteamento',
  'Base Permanente',
  'Disparos',
  'Fila WhatsApp',
  'Fila Instagram',
  'Remetentes',
  'Chips WhatsApp',
  'Perfis Instagram',
  'Central de Mensagens',
  'Ramos',
  'Templates de mensagens',
  'Variáveis',
  'Configurações',
  'Contas Apify',
  'Fontes de contato',
  'Critérios de importação',
  'Canais do sistema',
  'Níveis',
  'Instâncias',
  'Canais de template',
  'Tipos de template',
  'Ferramentas',
  'Minha conta',
];

const missing = requiredLabels.filter((label) => !registry.includes(label));
if (missing.length) throw new Error(`Menu incompleto: ${missing.join(', ')}`);
if (registry.includes("label: 'Pré-Envio'") || registry.includes("label: 'Válidos'")) {
  throw new Error('Pré-Envio/Válidos não podem permanecer no menu novo.');
}
if (!header.includes('onMouseEnter') || !header.includes('onMouseLeave')) {
  throw new Error('Dropdowns da navegação precisam preservar a abertura por hover.');
}
if (header.includes("setOpenGroup((current) => current === group.id ? '' : group.id)")) {
  throw new Error('Dropdowns principais não devem depender de clique para abrir.');
}
if (!header.includes("aria-haspopup={hasItems ? 'menu' : undefined}") || !header.includes('role="menuitem"')) {
  throw new Error('Dropdowns da navegação perderam o contrato acessível de menu.');
}
if (!header.includes('nav-menu__cascade') || !header.includes('nav-menu__submenu') || !header.includes('ChevronLeft')) {
  throw new Error('Configurações precisa permanecer como dropdown multinível com submenu lateral.');
}
if (!header.includes("navigate('account')") || !header.includes('Minha conta')) {
  throw new Error('Minha conta precisa permanecer no menu do usuário.');
}
if (!header.includes("navigate('audit')") || !header.includes('Auditoria')) {
  throw new Error('Auditoria precisa permanecer no menu do usuário.');
}
if (!app.includes("activePage === 'validation-routing'")) {
  throw new Error('Rota de Validação e roteamento ausente.');
}
if (!app.includes("activePage === 'account'") || !app.includes("activePage === 'tools'")) {
  throw new Error('Rotas de Minha conta e Ferramentas ausentes.');
}
if (!app.includes('legacyPageMap')) {
  throw new Error('Migração das páginas antigas do sessionStorage ausente.');
}

console.log('OK: menu, rotas, perfil e migração de navegação validados.');
