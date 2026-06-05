/* ════════════════════════════
   INSTAGRAM — STORAGE
════════════════════════════ */
// getInstaFila / saveInstaFila definidas acima — sem duplicata
function getInstaWeek()    { return getStoredObject(INSTA_WEEK_KEY); }
function saveInstaWeek(d)  {
  if (typeof v48StateSet === 'function') v48StateSet(INSTA_WEEK_KEY, d, 'instagram-week-save');
  if (typeof mergeLeadsIntoPermanentBase === 'function') mergeLeadsIntoPermanentBase(Object.values(d || {}).flat(), { source:'Agenda Instagram' });
  scheduleLegacyOperationalSyncV36();
}

/* ── MIGRAÇÃO: normaliza chaves antigas para dd/mm/aaaa ── */
function migrarChavesInstaWeek() { return; }

/* ── Constantes e estado do painel Instagram (declaração única) ── */
const INSTA_DIA_LIMIT   = 60;
const INSTA_PAGE_SIZE   = 50;
const INSTA_CUTOFF_HOUR = 19;
const INSTA_STATUS      = ['Não contatado','DM Enviada','Respondeu','Não respondeu','Fechou','Recusou'];

let instaPage      = 0;
let instaBacklogPg = 0;
let instaActiveTab = 'backlog'; // 'backlog' | dd/mm/aaaa

function instaWeekDays()              { return currentWeekDays(); }
function instaCountForDay(week, day)  { return (week[day]||[]).length; }
function instaParseDay(day) {
  const [d, m, y] = day.split('/').map(Number);
  return new Date(y, m - 1, d);
}

/* ════════════════════════════
   INSTAGRAM TEMPLATES
════════════════════════════ */
const INSTA_TEMPLATES_KEY = 'vs_insta_templates_v1';
const INSTA_TEMPLATES_DEFAULT = [
`Olá, tudo bem?
Me chamo Samuel. Encontrei a {EMPRESA} e estive vendo o trabalho de vocês aqui no Instagram. Cada projeto postado aqui reforça o nível do que entregam, dá para ver o cuidado em cada detalhe.
Percebi que vocês ainda não têm um site. Para marcenarias com esse padrão de projeto, isso é uma oportunidade clara. O cliente que pesquisa no Google simplesmente não encontra vocês, e a decisão de orçar muitas vezes começa antes do primeiro contato.
Recentemente desenvolvi um projeto para uma marcenaria chamada Bicho Preguiça: bichopreguicaplanejados.com.br
A ideia é que qualquer pessoa que chegue pelo Google ou pelas redes sociais consiga visualizar de modo sofisticado e completo tudo que vocês já entregaram, criando uma jornada que reforce o valor do trabalho antes do orçamento.
Montei uma amostra do que poderia ser feito para vocês. Dá uma olhada e me fala se faz sentido, beleza?`,
`Olá, tudo bem?
Me chamo Samuel. Achei a {EMPRESA} e estive vendo o trabalho de vocês aqui no Instagram. Cada projeto apresentado e postado aqui reforça a qualidade do que entregam. Nota-se o cuidado e a qualidade em cada entrega.
O que percebi é que vocês ainda não têm um site. No nicho de marcenarias e planejados, o cliente forma a percepção de valor antes mesmo de entrar em contato. Quem não aparece no Google fica fora dessa decisão.
Deixo aqui um projeto que desenvolvi para uma marcenaria chamada Bicho Preguiça: bichopreguicaplanejados.com.br
Sem um espaço próprio no Google, cada cliente que pesquisa ativamente por móveis planejados na região passa direto para quem tem. Esse é o tipo de decisão que acontece antes de qualquer contato, e vocês ficam fora dela.
Montei uma amostra do que poderia ser feito para vocês. Dá uma olhada e me fala se faz sentido, beleza?`,
`Olá, tudo bem?
Me chamo Samuel. Encontrei a {EMPRESA} e estive vendo o trabalho de vocês aqui no Instagram. Os projetos que postam têm um padrão muito bom, cada detalhe bem pensado e bem apresentado.
Só que percebi que vocês ainda não têm presença no Google. Isso significa que o cliente que está pesquisando ativamente por móveis planejados na região não encontra vocês. Essa busca acontece exatamente no momento em que ele está pronto para orçar.
Aqui um projeto que desenvolvi recentemente para uma marcenaria chamada Bicho Preguiça: bichopreguicaplanejados.com.br
O objetivo é que qualquer pessoa que chegue até vocês consiga visualizar com clareza e sofisticação tudo que já entregaram, criando uma jornada que reforce o valor do projeto antes do primeiro contato.
Montei uma amostra do que poderia ser feito para vocês. Dá uma olhada e me fala se faz sentido, beleza?`
];

function getInstaTemplates() {
  try { const saved = (typeof v48StateGetArray === 'function') ? v48StateGetArray(INSTA_TEMPLATES_KEY) : []; return saved.length ? saved : INSTA_TEMPLATES_DEFAULT; } catch { return INSTA_TEMPLATES_DEFAULT; }
}
function saveInstaTemplates(t) {
  if (typeof v48StateSet === 'function') v48StateSet(INSTA_TEMPLATES_KEY, t, 'instagram-template-update');
  uiSyncLogV426('optimistic-update', { entity:'template', action:'save-instagram-cache', count:Array.isArray(t) ? t.length : 0 });
  scheduleLegacyOperationalSyncV36({ delay:400, reason:'instagram-template-update' });
}

function sortearInstaTemplate(nome) {
  const tpls = getInstaTemplates();
  if (!tpls.length) return '';
  const t = tpls[Math.floor(Math.random() * tpls.length)];
  return t.replace(/\{EMPRESA\}/g, nome || '');
}

function copiarInstaMsg(nome) {
  const msg = sortearInstaTemplate(nome);
  if (!msg) { notify('// nenhum template Instagram cadastrado','warn'); return; }
  navigator.clipboard.writeText(msg).then(() => {
    notify('📋 Mensagem copiada');
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = msg; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    notify('📋 Mensagem copiada');
  });
}

function renderInstaTemplatesConfig() {
  const el = document.getElementById('instaTemplatesList');
  if (!el) return;
  const tpls = getInstaTemplates();
  el.innerHTML = tpls.map((t, i) => `
    <div style="background:var(--bg);border:1px solid rgba(225,48,108,0.2);border-radius:10px;padding:12px;margin-bottom:8px;position:relative">
      <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--insta);margin-bottom:8px;opacity:0.7">TEMPLATE ${i+1}</div>
      <textarea style="min-height:100px;font-size:10px;line-height:1.6;border-color:rgba(225,48,108,0.2)"
        oninput="saveInstaTemplateItem(${i},this.value)"
        onfocus="this.style.borderColor='var(--insta)'" onblur="this.style.borderColor='rgba(225,48,108,0.2)'">${escHtml(t)}</textarea>
      ${tpls.length>1?`<button class="del-btn" style="position:absolute;top:8px;right:8px" onclick="removerInstaTemplate(${i})">✕</button>`:''}
    </div>`).join('');
}
function saveInstaTemplateItem(idx, val) {
  const tpls = getInstaTemplates(); tpls[idx] = val; saveInstaTemplates(tpls);
}
function adicionarInstaTemplate() {
  const tpls = getInstaTemplates();
  if (tpls.length >= 10) { notify('// limite de 10 templates','warn'); return; }
  tpls.push('Olá, tudo bem?\nMe chamo Samuel. Encontrei a {EMPRESA}...\n\nDá uma olhada e me fala se faz sentido, beleza?');
  saveInstaTemplates(tpls); renderInstaTemplatesConfig(); notify('✓ Template Instagram adicionado');
}
function removerInstaTemplate(idx) {
  const tpls = getInstaTemplates();
  if (tpls.length <= 1) { notify('// mantenha ao menos 1 template','warn'); return; }
  tpls.splice(idx, 1); saveInstaTemplates(tpls); renderInstaTemplatesConfig();
}

