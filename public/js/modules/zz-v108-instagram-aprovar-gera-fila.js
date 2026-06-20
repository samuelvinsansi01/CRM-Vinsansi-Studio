/* V108 — Instagram: aprovar na Atribuição gera item real na Fila Instagram
   Correção do bug: ao colar o link e clicar "Aprovar para fila", o lead ficava
   apenas sinalizado em leads.pipeline_status e não entrava em instagram_dispatch_items.

   Agora o fluxo é:
   1) normaliza @/link do Instagram;
   2) atualiza o lead como instagram_backlog + approved_for_instagram_queue;
   3) se existir perfil Instagram ativo, cria/atualiza um item queued em instagram_dispatch_items;
   4) atualiza a tela de Atribuição, badges e painel Instagram.
*/
(function(){
  'use strict';
  const VERSION = '20260620-V108-INSTAGRAM-APPROVE-TO-DISPATCH-QUEUE';
  const FALLBACK_UID = 'c02fe973-4eb5-4036-9f8d-8787937e8b11';

  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(_) { return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || localStorage.getItem('vs_auth_local_user_v423') || FALLBACK_UID; } catch(_) { return FALLBACK_UID; } }
  function notify(msg,type){ try { if (typeof window.notify === 'function') return window.notify(msg,type); } catch(_) {} console[type === 'err' ? 'error' : 'log'](msg); }
  function escCss(v){ try { return CSS.escape(String(v)); } catch(_) { return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); } }
  function inputFor(id){ return document.getElementById('atrib-insta-url-' + id) || document.querySelector('#atrib-insta-url-' + escCss(id)); }
  function todayISO(){ const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); }

  function cleanUsername(value){
    let raw = String(value || '').trim();
    if (!raw) return '';
    raw = raw.replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
    raw = raw.replace(/^@+/, '').trim();
    raw = raw.replace(/\?.*$/,'').replace(/#.*$/,'').trim();
    let candidate = raw;
    try {
      let parse = raw;
      if (/^instagram\.com\//i.test(parse)) parse = 'https://www.' + parse;
      if (/^www\.instagram\.com\//i.test(parse)) parse = 'https://' + parse;
      const u = new URL(parse);
      const host = String(u.hostname || '').replace(/^www\./i,'').toLowerCase();
      if (host === 'instagram.com') candidate = String(u.pathname || '').split('/').filter(Boolean)[0] || '';
    } catch(_) {
      candidate = raw.replace(/^https?:\/\//i,'').replace(/^www\.instagram\.com\//i,'').replace(/^instagram\.com\//i,'').split('/')[0];
    }
    candidate = String(candidate || '').trim().replace(/^@+/,'').split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g,'').toLowerCase();
    const invalid = new Set(['','http','https','www','instagram','instagram.com','www.instagram.com','com','p','reel','reels','stories','story','explore','accounts','direct','about','privacy','terms','null','undefined']);
    if (invalid.has(candidate)) return '';
    if (candidate.length < 2 || candidate.length > 30) return '';
    if (/^\.+$/.test(candidate)) return '';
    return candidate;
  }
  function igUrl(v){ const u = cleanUsername(v); return u ? 'https://www.instagram.com/' + u + '/' : ''; }

  function norm(v){
    return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[_]+/g,'-').replace(/\s+/g,'-');
  }
  function templateAliases(value=''){
    const base=norm(value); const out=new Set([base].filter(Boolean));
    const j=base.replace(/-/g,' ');
    if(j.includes('moveis')||j.includes('movel')||j.includes('marcen')||j.includes('planejad')){
      out.add('marcenaria'); out.add('moveis-planejados'); out.add('moveis'); out.add('loja-de-moveis');
    }
    return [...out].filter(Boolean);
  }
  async function getTemplates(c,user){
    const { data, error } = await c.from('message_templates').select('*').eq('user_id',user).eq('active',true);
    if (error) { console.warn('[v109][templates]', error.message); return []; }
    return data || [];
  }
  function applyVars(txt, lead){
    const name = leadName(lead);
    return String(txt || '')
      .replace(/\{EMPRESA\}/g, name)
      .replace(/\{\{\s*empresa\s*\}\}/gi, name)
      .replace(/\{NOME\}/g, name)
      .replace(/\{\{\s*nome\s*\}\}/gi, name);
  }
  function selectTemplate(templates, lead){
    const ramo = categoryOf(lead);
    const tipo = leadTypeOf(lead);
    const nt = norm(tipo).replace('_','-');
    const aliases = new Set([
      ...templateAliases(ramo),
      ...templateAliases(lead?.ramo_id || lead?.branch_id || ''),
      ...templateAliases(lead?.parent_category || lead?.category_name || lead?.category || '')
    ]);
    const candidates = (templates || []).filter(t => {
      if (t.active === false) return false;
      const trVals = [t.ramo_id,t.branch_id,t.ramo,t.ramo_pai,t.category,t.category_name,t.parent_category,t.niche,t.name].filter(Boolean);
      const trAliases = new Set(trVals.flatMap(templateAliases));
      const tt = norm(t.tipo || t.lead_type || t.type || t.template_type || '');
      const ch = norm(t.channel || t.canal || t.channels || 'ambos');
      const ramoOk = !trAliases.size || !aliases.size || [...trAliases].some(a => [...aliases].some(b => a===b || a.includes(b) || b.includes(a)));
      const tipoOk = !tt || tt===nt || tt.includes(nt) || nt.includes(tt) || (nt.includes('sem') && tt.includes('sem')) || (nt.includes('com') && tt.includes('com')) || (nt.includes('agreg') && tt.includes('agreg'));
      const canalOk = !ch || ch.includes('ambos') || ch.includes('instagram') || ch.includes('whatsapp');
      return ramoOk && tipoOk && canalOk;
    });
    const t = candidates[0] || templates[0] || {};
    return {
      message_1: applyVars(t.part_1 || t.message_1 || t.msg1 || t.texto1 || t.body1 || t.mensagem1 || t.content || 'Olá, tudo bem? Me chamo Samuel.', lead),
      message_2: applyVars(t.part_2 || t.message_2 || t.msg2 || t.texto2 || t.body2 || t.mensagem2 || 'Vi uma oportunidade de apresentar melhor o trabalho de vocês na internet.', lead),
      template_id: t.id || null
    };
  }

  function leadName(lead){ return lead?.company_name || lead?.name || lead?.nome || 'Lead Instagram'; }
  function leadTypeOf(lead){
    const s = String(lead?.lead_type || lead?.website_type || lead?.current_stage || '').toLowerCase();
    if (s.includes('agreg')) return 'agregador';
    if (s.includes('site') && !s.includes('sem')) return 'com-site';
    return 'sem-site';
  }
  function categoryOf(lead){ return lead?.parent_category || lead?.category_name || lead?.category || 'Ramo não identificado'; }

  async function pickProfile(c, user, date){
    const { data:profiles, error:pErr } = await c.from('instagram_profiles')
      .select('*')
      .eq('user_id', user)
      .eq('active', true)
      .order('created_at', { ascending:true });
    if (pErr) throw pErr;
    const list = profiles || [];
    if (!list.length) return null;

    const { data:items } = await c.from('instagram_dispatch_items')
      .select('profile_id,status')
      .eq('user_id', user)
      .eq('scheduled_date', date);

    const counts = new Map();
    (items || []).forEach(it => {
      const st = String(it.status || 'queued').toLowerCase();
      if (['sent','enviado','queued','sending','error','failed','erro'].includes(st)) {
        const key = String(it.profile_id || '');
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });

    return list
      .map(p => ({ profile:p, used:counts.get(String(p.id)) || 0, limit:Number(p.daily_limit || 60) || 60 }))
      .filter(x => x.used < x.limit)
      .sort((a,b) => a.used - b.used)[0] || { profile:list[0], used:counts.get(String(list[0].id)) || 0, limit:Number(list[0].daily_limit || 60) || 60 };
  }

  async function getLead(c, user, id){
    const { data, error } = await c.from('leads').select('*').eq('user_id', user).eq('id', id).maybeSingle();
    if (error) throw error;
    return data || {};
  }

  async function upsertDispatchItem(c, user, lead, username){
    const selected = await pickProfile(c, user, todayISO());
    if (!selected || !selected.profile) return { queued:false, reason:'no_profile' };

    const p = selected.profile;
    const date = todayISO();
    const { data:existing, error:exErr } = await c.from('instagram_dispatch_items')
      .select('id,status')
      .eq('user_id', user)
      .eq('lead_id', String(lead.id))
      .in('status', ['queued','sending','error'])
      .limit(1);
    if (exErr) throw exErr;

    const blockSize = Number(p.block_size || 15) || 15;
    const position = selected.used + 1;
    const templates = await getTemplates(c, user);
    const tpl = selectTemplate(templates, lead);
    const row = {
      user_id:user,
      lead_id:String(lead.id),
      profile_id:p.id,
      profile_username:cleanUsername(p.username || p.profile_username || p.display_name),
      scheduled_date:date,
      block_number:Math.floor((position - 1) / blockSize) + 1,
      block_size:blockSize,
      position,
      status:'queued',
      follow_status:'not_checked',
      company_name:leadName(lead),
      instagram_username:username,
      instagram_url:igUrl(username),
      parent_category:categoryOf(lead),
      lead_type:leadTypeOf(lead),
      message_1:tpl.message_1,
      message_2:tpl.message_2,
      template_id:tpl.template_id||null,
      updated_at:new Date().toISOString()
    };

    if (existing && existing[0] && existing[0].id) {
      const { error } = await c.from('instagram_dispatch_items').update(row).eq('user_id', user).eq('id', existing[0].id);
      if (error) throw error;
      return { queued:true, updated:true, profile:row.profile_username, date };
    }

    row.created_at = new Date().toISOString();
    const { error } = await c.from('instagram_dispatch_items').insert(row);
    if (error) throw error;
    return { queued:true, inserted:true, profile:row.profile_username, date };
  }

  async function approveInstagramToQueue(id){
    const c = sb(), user = uid();
    if (!c || !user) return notify('// Supabase indisponível', 'err');

    const input = inputFor(id);
    let username = cleanUsername(input?.value || '');

    let lead = await getLead(c, user, id);
    if (!username) username = cleanUsername(lead.instagram_username || lead.instagram_url || lead.instagram || '');
    if (!username) {
      if (input) input.style.borderColor = 'var(--error,#ff4d4d)';
      return notify('Cole um @ ou link válido do Instagram', 'warn');
    }

    const url = igUrl(username);
    if (input) { input.value = '@' + username; input.style.borderColor = 'var(--ok,#a6ff3d)'; }

    const leadPayload = {
      instagram:'@' + username,
      instagram_url:url,
      instagram_username:username,
      current_stage:'instagram_backlog',
      current_status:'ready_for_instagram_queue',
      status:'ready_for_instagram_queue',
      lead_channel:'instagram',
      pipeline_status:'approved_for_instagram_queue',
      updated_at:new Date().toISOString()
    };
    const { error:uErr } = await c.from('leads').update(leadPayload).eq('user_id', user).eq('id', id);
    if (uErr) return notify('Erro ao aprovar Instagram: ' + uErr.message, 'err');
    lead = { ...lead, ...leadPayload };

    try {
      const q = await upsertDispatchItem(c, user, lead, username);
      if (q.queued) notify(`✓ @${username} aprovado e inserido na Fila Instagram (@${q.profile})`);
      else notify(`✓ @${username} aprovado. Configure um perfil Instagram ativo para gerar a fila.`, 'warn');
    } catch (e) {
      console.warn('[v108][instagram-dispatch-insert]', e?.message || e);
      notify(`✓ @${username} aprovado, mas não consegui inserir na fila: ${e.message || e}`, 'warn');
    }

    try { if (typeof window.renderAtribuicaoPanelV31 === 'function') await window.renderAtribuicaoPanelV31(); else if (typeof window.renderAtribuicao === 'function') await window.renderAtribuicao(); } catch(_) {}
    try { if (typeof window.refreshInstagramV94 === 'function') await window.refreshInstagramV94(); else if (typeof window.renderInstagram === 'function') await window.renderInstagram(); } catch(_) {}
    try { if (typeof window.updateMenuBadgesTotalsV65 === 'function') window.updateMenuBadgesTotalsV65(true); else if (typeof window.updateBadges === 'function') window.updateBadges(); } catch(_) {}
  }

  window.instagramV108ApproveToDispatchQueue = approveInstagramToQueue;
  window.instagramV102ApproveForQueue = approveInstagramToQueue;
  window.saveInstagramAttributionV105 = function(id, opts){ return opts?.approve ? approveInstagramToQueue(id) : (window.approveInstagramAttributionV31 ? window.approveInstagramAttributionV31(id) : approveInstagramToQueue(id)); };
  window.aprovarLeadAtribuicaoParaFilaV65 = (function(prev){
    return function(id, tab){
      if (String(tab || '').toLowerCase() === 'insta' || inputFor(id)) return approveInstagramToQueue(id);
      return typeof prev === 'function' ? prev.apply(this, arguments) : undefined;
    };
  })(window.aprovarLeadAtribuicaoParaFilaV65);

  document.addEventListener('click', function(ev){
    const btn = ev.target?.closest?.('[data-ig-v107-approve], [data-ig-v106-approve], [data-ig-v105-approve], [data-ig-v104-approve], [data-ig-v102-approve], .ig-v107-approve-btn, .ig-v106-approve-btn, .ig-v105-approve-btn, .ig-v104-approve-btn, .ig-v102-approve-btn');
    if (!btn) return;
    const id = btn.dataset.igV107Approve || btn.dataset.igV106Approve || btn.dataset.igV105Approve || btn.dataset.igV104Approve || btn.dataset.igV102Approve || btn.closest('[data-lead-id]')?.dataset?.leadId || '';
    if (!id || !inputFor(id)) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    approveInstagramToQueue(id);
  }, true);

  console.log('[v108][instagram-aprovar-gera-fila] ativo', VERSION);
})();
