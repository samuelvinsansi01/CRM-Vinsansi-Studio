/* ════════════════════════════
   DEFAULT RAMOS
════════════════════════════ */
const RAMOS_DEFAULT = [
  {
    id: 'marcenaria',
    nome: 'Marcenaria / Móveis',
    keywords: ['marcenaria','marceneiro','moveis planejados','móveis planejados',
      'movelaria','móveis sob medida','moveis sob medida','carpintaria',
      'armarios planejados','armários planejados','cozinhas planejadas',
      'dormitórios planejados','dormitorios planejados','móveis','moveis']
  }
];

/* ════════════════════════════
   DEFAULT MSG TEMPLATES
════════════════════════════ */
const TEMPLATES_DEFAULT = [
  `Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA} e acredito que ele pode estar afastando clientes sem vocês perceberem. Muitos sites não foram pensados pra converter e acabam não transmitindo a credibilidade que a empresa realmente tem.\n\nTrabalho desenvolvendo sites personalizados para empresas que querem ser vistas de forma profissional e atrair mais clientes no digital.\n\nFaz sentido conversarmos?`,
  `Olá, me chamo Samuel. Tudo bem?\n\nPassei pelo site da {EMPRESA} e sinto que ele não está representando bem o que vocês entregam. O cliente decide pela confiança, e essa confiança começa pelo digital.\n\nTrabalho criando sites personalizados para empresas que querem se destacar e converter mais visitantes em clientes.\n\nFaz sentido pra vocês?`,
  `Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA} e acredito que ele pode estar passando uma imagem mais genérica do que a empresa merece. Muitos clientes em potencial descartam pelo que veem online antes mesmo de entrar em contato.\n\nDesenvolvo sites personalizados para empresas que querem ser levadas a sério no digital.\n\nFaz sentido conversarmos?`,
];

/* ════════════════════════════
   TEMPLATES POR RAMO E TIPO
════════════════════════════ */
const RAMO_TEMPLATES_DEFAULT = {
  marcenaria: {
    'com-site': [
      `Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA} e acredito que ele pode estar deixando clientes na dúvida em vez de convencê-los a entrar em contato. Para móveis planejados, o site precisa vender visualmente antes de qualquer conversa.\n\nTrabalho desenvolvendo sites para marcenarias e móveis planejados que querem mostrar seu trabalho com mais impacto.\n\nFaz sentido conversarmos?`,
      `Olá, me chamo Samuel. Tudo bem?\n\nPassei pelo site da {EMPRESA} e percebi que o site pode não estar fazendo jus à qualidade do trabalho de vocês. No ramo de móveis planejados, a apresentação visual é tudo.\n\nCrio sites que mostram projetos de forma impressionante e convertem visitantes em orçamentos.\n\nFaz sentido pra vocês?`,
      `Olá! Sou o Samuel.\n\nVi o site da {EMPRESA} e acho que ele pode estar perdendo clientes por não mostrar seu portfólio da melhor forma possível. Clientes de móveis planejados decidem pela beleza e confiança que veem online.\n\nDesenvolvo sites que destacam projetos e geram mais orçamentos para marcenarias.\n\nFaz sentido conversarmos?`,
      `Oi! Me chamo Samuel.\n\nDei uma olhada no site da {EMPRESA} e acredito que ele pode ser muito mais poderoso para atrair clientes. Sites de marcenaria precisam fazer o cliente visualizar o sonho antes mesmo de pedir um orçamento.\n\nEspecializo-me em sites para móveis planejados e marcenarias que querem crescer.\n\nPodemos conversar?`,
      `Olá, sou o Samuel!\n\nAnalisei o site da {EMPRESA} e vejo oportunidade de destacar melhor os projetos e a qualidade do trabalho de vocês. No mercado de móveis planejados, o site é a vitrine mais importante.\n\nTrabalho com sites que mostram portfólios de forma que geram desejo e mais pedidos de orçamento.\n\nFaz sentido uma conversa rápida?`,
      `Olá! Me chamo Samuel.\n\nVi o site da {EMPRESA} e acredito que ele pode estar passando uma impressão mais simples do que o trabalho de vocês merece. Cada projeto entregue por vocês merece ser mostrado de forma impactante.\n\nDesenvolvo sites para marcenarias que transformam portfólio em clientes.\n\nFaz sentido conversarmos?`,
      `Oi, sou o Samuel!\n\nPassei pelo site da {EMPRESA} e acredito que existe muito espaço para melhorar como vocês se apresentam online. O cliente de móveis planejados pesquisa muito antes de decidir — o site precisa ser perfeito.\n\nCrio sites para marcenarias e móveis planejados que geram mais orçamentos e fechamentos.\n\nFaz sentido?`,
      `Olá! Sou o Samuel.\n\nAnalisei o site da {EMPRESA} e percebi que ele pode estar deixando clientes irem para a concorrência por não transmitir confiança suficiente. Sites de marcenaria precisam mostrar qualidade antes de qualquer conversa.\n\nTrabalho com sites que posicionam marcenarias como referência em suas regiões.\n\nFaz sentido conversarmos?`,
      `Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA} e acredito que vocês merecem uma vitrine digital muito melhor. No ramo de móveis planejados, o site é muitas vezes o primeiro contato que o cliente tem com o trabalho de vocês.\n\nDesenvolvo sites que mostram projetos com a qualidade que eles merecem.\n\nFaz sentido conversar?`,
      `Olá! Me chamo Samuel.\n\nPassei pelo site da {EMPRESA} e sinto que o potencial de vocês não está sendo totalmente comunicado online. Clientes de móveis planejados decidem com os olhos — o site precisa impressionar.\n\nCrio sites personalizados para marcenarias que querem crescer e se destacar.\n\nFaz sentido conversarmos?`,
    ],
    'sem-site': [
      `Olá, me chamo Samuel. Tudo bem?\n\nEncontrei a {EMPRESA} mas percebi que vocês ainda não têm um site. No ramo de móveis planejados, clientes pesquisam muito antes de decidir — sem um site com portfólio, vocês ficam de fora dessa pesquisa.\n\nTrabalho criando sites para marcenarias que querem mostrar seus projetos e atrair mais clientes.\n\nFaz sentido conversarmos?`,
      `Olá! Sou o Samuel.\n\nVi a {EMPRESA} e não encontrei um site de vocês. Para quem trabalha com móveis planejados, um site com portfólio é a diferença entre ser escolhido ou ser ignorado pelo cliente que pesquisa online.\n\nDesenvolvo sites para marcenarias. O site vira um vendedor 24h por dia.\n\nFaz sentido uma conversa?`,
      `Oi, me chamo Samuel!\n\nEncontrei a {EMPRESA} e percebi que vocês ainda não têm uma presença digital própria. No mercado de móveis planejados, quem não aparece online perde para quem aparece.\n\nCrio sites para marcenarias que querem crescer digitalmente. Posso te mostrar exemplos?\n\nFaz sentido?`,
    ],
  },
};

function getRamoTemplatesDefault(ramoId, tipo) {
  if (RAMO_TEMPLATES_DEFAULT[ramoId] && RAMO_TEMPLATES_DEFAULT[ramoId][tipo]) {
    return RAMO_TEMPLATES_DEFAULT[ramoId][tipo];
  }
  return tipo === 'com-site' ? TEMPLATES_DEFAULT : TEMPLATES_DEFAULT.slice(0, 3);
}

function getRamoTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_RAMO_KEY)||'null') || {}; } catch { return {}; }
}
function saveRamoTemplates(obj) {
  localStorage.setItem(TEMPLATES_RAMO_KEY, JSON.stringify(obj));
  uiSyncLogV426('optimistic-update', { entity:'template', action:'save-branch-cache', count:Object.keys(obj || {}).length });
  scheduleLegacyOperationalSyncV36({ delay:400, reason:'branch-template-update' });
}

function getTemplatesForRamoTipo(ramoId, tipo) {
  const all = getRamoTemplates();
  const key = `${ramoId}__${tipo}`;
  if (all[key] && all[key].length > 0) return all[key];
  return getRamoTemplatesDefault(ramoId, tipo);
}

function saveRamoTemplate(ramoId, tipo, idx, val) {
  const all = getRamoTemplates();
  const key = `${ramoId}__${tipo}`;
  if (!all[key]) all[key] = [...getRamoTemplatesDefault(ramoId, tipo)];
  all[key][idx] = val;
  saveRamoTemplates(all);
}

function adicionarRamoTemplate(ramoId, tipo) {
  const all = getRamoTemplates();
  const key = `${ramoId}__${tipo}`;
  if (!all[key]) all[key] = [...getRamoTemplatesDefault(ramoId, tipo)];
  const maxTpl = tipo === 'sem-site' ? 3 : 10;
  if (all[key].length >= maxTpl) { notify(`// máximo de ${maxTpl} templates para ${tipo}`,'warn'); return; }
  all[key].push(`Olá, me chamo Samuel. Tudo bem?\n\nVi ${tipo==='com-site'?'o site d':''}a {EMPRESA}...\n\nFaz sentido conversarmos?`);
  saveRamoTemplates(all);
  renderTemplatesConfig();
}

function removerRamoTemplate(ramoId, tipo, idx) {
  const all = getRamoTemplates();
  const key = `${ramoId}__${tipo}`;
  if (!all[key]) all[key] = [...getRamoTemplatesDefault(ramoId, tipo)];
  if (all[key].length <= 1) { notify('// precisa ter ao menos 1 template','warn'); return; }
  all[key].splice(idx, 1);
  saveRamoTemplates(all);
  renderTemplatesConfig();
}

const LINK_BICHOP = 'https://samuelvinsansi.com.br';

/* ════════════════════════════
   STATE
════════════════════════════ */
let selectedDay      = todayStr();
let selectedStatus   = 'Não enviada';
let importTargetDay  = todayStr();

/* ── paginação ── */
let inicioPage     = 1; let INICIO_PG    = 20;
let importPage     = 1; let IMPORT_PG    = 20;
let valPage        = 1; let VAL_PG       = 20;
let atribPage      = 1; let ATRIB_PG     = 20;
let disparoPage    = 1; let DISPARO_PG   = 20;
let disparoDay       = todayStr();
let disparoStatus    = 'Não enviada';
let msgEmpresaId     = null;
let msgTemplateIdx   = -1;
let historyOpen      = false;
let filaDisparo      = (() => { try { return JSON.parse(localStorage.getItem('vs_fila_disparo_v1')||'null') || {}; } catch { return {}; } })(); // { chipId: [...items] }
let disparoEmAndamento = false;
let aguardandoLote   = false;
let filaLotes = [], loteAtual = 0, lotesTotal = 0;
let loteEsperaTimer = null, loteEsperaFim = null, loteCountdownInt = null;
let activeChipId     = null;
let valTab           = 'com-site';
let instaStatus      = 'pendente';
let horarioCheckInt  = null;
let qrChipIdAtivo    = null;
let qrPollInt        = null;
let disparoChipId    = null;
let tplRamoId        = null;
let tplTipo          = 'com-site';

/* ════════════════════════════
   DATE HELPERS
════════════════════════════ */
function todayStr() { return new Date().toLocaleDateString('pt-BR'); }
function timeStr()  { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function getWeekStart(d) { const dt = d ? new Date(d) : new Date(); dt.setHours(0,0,0,0); const day = dt.getDay(); dt.setDate(dt.getDate() - (day === 0 ? 7 : day)); return dt; }
function currentWeekStartStr() { return getWeekStart().toLocaleDateString('pt-BR'); }
function currentWeekDays() {
  const days = [], start = getWeekStart();
  for (let i = 0; i <= 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d.toLocaleDateString('pt-BR')); }
  return days; // domingo a domingo
}
function dayLabel(dateStr) {
  const [d, m, y] = dateStr.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  const mm = m < 10 ? '0' + m : String(m);
  return WEEKDAY_NAMES[dt.getDay()] + ' ' + d + '/' + mm;
}
function dayLabelShort(dateStr) {
  const [d, m, y] = dateStr.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  return WEEKDAY_NAMES[dt.getDay()] + ' ' + d + '/' + (m < 10 ? '0'+m : m);
}
function nextWeekday(dateStr) {
  const [d, m, y] = dateStr.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return dt.toLocaleDateString('pt-BR');
}

function updateClock(){
  const clockEl =
    document.getElementById('clock') ||
    document.getElementById('sidebarClock') ||
    document.querySelector('[data-time]');

  const dateEl =
    document.getElementById('date') ||
    document.getElementById('sidebarDate') ||
    document.querySelector('[data-date]');

  const now = new Date();

  if (clockEl) {
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  if (dateEl) {
    if (dateEl) dateEl.textContent = now.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'short'
    });
  }
}
setInterval(updateClock, 1000); updateClock();

/* ════════════════════════════
   UTILS
════════════════════════════ */
function genId()    { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function normalizePhone(raw) { if (!raw) return ''; return raw.replace(/\D/g,''); }
function buildWaLink(raw) { if (!raw) return ''; const n = normalizePhone(raw); if (!n) return ''; return 'https://wa.me/' + (n.startsWith('55') ? n : '55' + n); }
function normalizeStr(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

function capitalizeName(raw) {
  if (!raw) return '';
  const lower = ['de','da','do','das','dos','e','em','na','no','nas','nos','a','o','as','os'];
  return raw.toLowerCase().replace(/\b\w+/g, (word, offset) => {
    if (offset > 0 && lower.includes(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

function getTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || 'null') || TEMPLATES_DEFAULT; } catch { return TEMPLATES_DEFAULT; }
}
function saveTemplates(t) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t));
  uiSyncLogV426('optimistic-update', { entity:'template', action:'save-default-cache', count:Array.isArray(t) ? t.length : 0 });
  scheduleLegacyOperationalSyncV36({ delay:400, reason:'default-template-update' });
}

function pickTemplate(nome, ramoId) {
  const tpl = ramoId ? getTemplatesForRamoTipo(ramoId, 'com-site') : getTemplates();
  if (!tpl || !tpl.length) return { text: '', idx: 0 };
  const idx = Math.floor(Math.random() * tpl.length);
  return { text: tpl[idx].replace(/\{EMPRESA\}/g, nome).replace(/\[EMPRESA\]/g, nome), idx };
}
function pickOtherTemplate(nome, cur, ramoId) {
  const tpl = ramoId ? getTemplatesForRamoTipo(ramoId, 'com-site') : getTemplates();
  if (!tpl || !tpl.length) return { text: '', idx: 0 };
  let idx; do { idx = Math.floor(Math.random() * tpl.length); } while (idx === cur && tpl.length > 1);
  return { text: tpl[idx].replace(/\{EMPRESA\}/g, nome).replace(/\[EMPRESA\]/g, nome), idx };
}

