/* V64 — Cards da Atribuição mais limpos, estilo Pré-envio
   - Mantém badges corretos por aba: ZAP, COM SITE, INSTAGRAM.
   - No card mostra somente links úteis: site, WhatsApp e Instagram quando existirem.
   - Cidade/estado, nota e avaliações ficam preservados na Ficha, não no card.
   - Não altera banco, não altera fluxo, não remove telas. */
(function(){
  'use strict';
  const VERSION='20260618-v64-atribuicao-cards-links-limpos';
  const FALLBACK_UID='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const PER_PAGE=10;
  let currentTab='zap';
  let page=1;

  function sb(){ try{return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;} }
  function uid(){ try{return window.currentUser?.id || (typeof currentUser!=='undefined' && currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || FALLBACK_UID;}catch(_){return FALLBACK_UID;} }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function digits(v){ return String(v||'').replace(/\D/g,''); }
  function cleanUrl(v){ const s=String(v||'').trim(); if(!s) return ''; return /^https?:\/\//i.test(s)?s:'https://'+s; }
  function shortHost(v){ try{ return new URL(cleanUrl(v)).hostname.replace(/^www\./,''); }catch(_){ return String(v||'').replace(/^https?:\/\/(www\.)?/i,'').split('/')[0]; } }
  function leadName(l){ return esc(l.company_name || l.name || l.title || 'Lead sem nome'); }
  function nameHtml(l){ return l.maps_url ? `<a href="${esc(cleanUrl(l.maps_url))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${leadName(l)}</a>` : leadName(l); }
  function stage(){ return currentTab==='com-site' ? 'attribution_site' : currentTab==='insta' ? 'attribution_instagram' : 'attribution_whatsapp'; }
  function badge(){
    if(currentTab==='com-site') return '<span class="atrib-v64-badge site">🌐 COM SITE</span>';
    if(currentTab==='insta') return '<span class="atrib-v64-badge insta">📸 INSTAGRAM</span>';
    return '<span class="atrib-v64-badge zap">💬 ZAP</span>';
  }
  function phoneHref(phone){ const d=digits(phone); return d ? `https://wa.me/${d.startsWith('55')?d:'55'+d}` : ''; }
  function linkSite(l){ if(!l.website) return ''; return `<a class="atrib-v64-link site" href="${esc(cleanUrl(l.website))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🌐 ${esc(shortHost(l.website))}</a>`; }
  function linkZap(l){ const p=l.phone || l.normalized_phone || ''; const href=phoneHref(p); if(!href) return ''; return `<a class="atrib-v64-link zap" href="${esc(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">💬 WhatsApp</a>`; }
  function linkInsta(l){ const u=l.instagram_url || l.instagram || ''; if(!u) return ''; return `<a class="atrib-v64-link insta" href="${esc(cleanUrl(u.startsWith('@')?'instagram.com/'+u.slice(1):u))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📸 Instagram</a>`; }

  async function countStage(st){
    const c=sb(); if(!c) return 0;
    const {count,error}=await c.from('leads').select('id',{count:'exact',head:true}).eq('user_id',uid()).eq('current_stage',st);
    if(error){ console.warn('[v64][count]',st,error.message); return 0; }
    return count||0;
  }
  async function refreshCounts(){
    const [w,s,i,ib]=await Promise.all([
      countStage('attribution_whatsapp'),
      countStage('attribution_site'),
      countStage('attribution_instagram'),
      countStage('instagram_backlog')
    ]);
    const pairs={atribTabZapCount:`(${w})`,atribTabComSiteCount:`(${s})`,atribTabInstaCount:`(${i})`,'badge-atribuicao':String(w+s+i),'badge-instagram':String(ib)};
    Object.entries(pairs).forEach(([id,val])=>{ const el=document.getElementById(id); if(el) el.textContent=val; });
  }
  async function fetchRows(){
    const c=sb(); if(!c) return {rows:[],total:0};
    const inputId=currentTab==='insta'?'atribInstaBusca':'atribBusca';
    const qv=(document.getElementById(inputId)?.value||'').trim().replaceAll('%','');
    let q=c.from('leads')
      .select('id,company_name,phone,normalized_phone,website,maps_url,instagram_url,city,state,rating,reviews_count,lead_score,current_stage,created_at',{count:'exact'})
      .eq('user_id',uid())
      .eq('current_stage',stage())
      .order('lead_score',{ascending:false})
      .order('created_at',{ascending:true});
    if(qv) q=q.or(`company_name.ilike.%${qv}%,phone.ilike.%${qv}%,normalized_phone.ilike.%${qv}%,website.ilike.%${qv}%,instagram_url.ilike.%${qv}%`);
    const from=(page-1)*PER_PAGE;
    const {data,count,error}=await q.range(from,from+PER_PAGE-1);
    return {rows:data||[],total:count||0,error};
  }

  function card(l){
    const isInsta=currentTab==='insta';
    const links=[linkSite(l), linkZap(l), linkInsta(l)].filter(Boolean).join('');
    const instaInput=isInsta ? `<div class="atrib-v64-insta-input-wrap"><input id="atrib-insta-url-${esc(l.id)}" class="atrib-insta-url-input" type="text" placeholder="Cole o Instagram aqui" value="${esc(l.instagram_url||'')}" onpaste="setTimeout(()=>approveInstagramAttributionV31('${esc(l.id)}'),80)" onchange="approveInstagramAttributionV31('${esc(l.id)}')" onkeydown="if(event.key==='Enter') approveInstagramAttributionV31('${esc(l.id)}')"></div>` : '';
    const invalidBtn=currentTab==='com-site' && typeof window.invalidarLeadAtribuicaoV58==='function'
      ? `<button class="btn btn-ghost v58-invalid-atrib" style="font-size:9px;padding:6px 10px;border-color:rgba(255,80,80,.45);color:var(--error);white-space:nowrap" onclick="event.preventDefault();event.stopPropagation();invalidarLeadAtribuicaoV58('${esc(l.id)}');return false;">Invalidar lead</button>`
      : '';
    return `<div class="empresa-card atrib-v64-card" data-lead-id="${esc(l.id)}">
      <div class="empresa-info atrib-v64-info">
        <div class="empresa-nome atrib-v64-name">${nameHtml(l)}</div>
        <div class="empresa-meta atrib-v64-meta">
          ${badge()}
          ${links || '<span class="atrib-v64-muted">Sem link salvo</span>'}
        </div>
      </div>
      ${instaInput}
      <div class="empresa-actions atrib-v64-actions">
        <button class="btn btn-ghost" style="font-size:9px;padding:6px 10px" onclick="event.stopPropagation();openLeadDrawer('${esc(l.id)}')">Ficha</button>
        ${invalidBtn}
      </div>
    </div>`;
  }

  function applyStyles(){
    if(document.getElementById('v64-atrib-styles')) return;
    const st=document.createElement('style');
    st.id='v64-atrib-styles';
    st.textContent=`
      .atrib-v64-card{min-height:58px;padding:12px 16px!important;display:flex!important;align-items:center!important;gap:14px!important;border-radius:10px!important;background:rgba(255,255,255,.015)!important;}
      .atrib-v64-info{flex:1;min-width:0;}
      .atrib-v64-name{font-size:14px!important;font-weight:800!important;margin-bottom:7px!important;line-height:1.2!important;}
      .atrib-v64-name a{color:var(--text)!important;text-decoration:none!important;}
      .atrib-v64-name a:hover{color:var(--accent)!important;}
      .atrib-v64-meta{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;font-family:'DM Mono',monospace!important;font-size:9px!important;}
      .atrib-v64-badge{display:inline-flex;align-items:center;gap:4px;border-radius:5px;padding:3px 8px;font-size:8px;font-weight:800;font-family:'DM Mono',monospace;border:1px solid var(--border2);background:rgba(255,255,255,.035);white-space:nowrap;}
      .atrib-v64-badge.site{color:#5bb8f5;border-color:rgba(91,184,245,.32);background:rgba(91,184,245,.08);}
      .atrib-v64-badge.zap{color:var(--ok);border-color:rgba(78,203,113,.32);background:rgba(78,203,113,.08);}
      .atrib-v64-badge.insta{color:var(--insta);border-color:rgba(225,48,108,.32);background:rgba(225,48,108,.08);}
      .atrib-v64-link{display:inline-flex;align-items:center;gap:4px;color:var(--text2)!important;text-decoration:none!important;border-bottom:1px solid transparent;white-space:nowrap;}
      .atrib-v64-link:hover{color:var(--accent)!important;border-bottom-color:var(--accent)!important;}
      .atrib-v64-link.zap{color:var(--ok)!important;}
      .atrib-v64-link.site{color:#8acfff!important;}
      .atrib-v64-link.insta{color:var(--insta)!important;}
      .atrib-v64-muted{color:var(--muted);font-size:9px;}
      .atrib-v64-actions{display:flex!important;align-items:center!important;gap:6px!important;justify-content:flex-end!important;flex-shrink:0!important;}
      .atrib-v64-insta-input-wrap{min-width:260px;max-width:360px;flex:0 1 320px;}
      .atrib-v64-insta-input-wrap input{width:100%;background:rgba(225,48,108,0.06);border:1px solid rgba(225,48,108,0.25);border-radius:7px;color:var(--text);font-family:'DM Mono',monospace;font-size:9px;padding:7px 9px;outline:none;}
      @media(max-width:900px){.atrib-v64-card{align-items:flex-start!important;flex-direction:column!important}.atrib-v64-actions{width:100%;justify-content:flex-start!important}.atrib-v64-insta-input-wrap{width:100%;max-width:none;min-width:0;}}
    `;
    document.head.appendChild(st);
  }

  async function render(){
    applyStyles();
    await refreshCounts();
    ['atribTabZap','atribTabComSite','atribTabInsta'].forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('active'); });
    const activeId=currentTab==='com-site'?'atribTabComSite':currentTab==='insta'?'atribTabInsta':'atribTabZap';
    const active=document.getElementById(activeId); if(active) active.classList.add('active');
    const isInsta=currentTab==='insta';
    const panelZap=document.getElementById('atribPanelZap');
    const panelInsta=document.getElementById('atribPanelInsta');
    if(panelZap) panelZap.style.display=isInsta?'none':'flex';
    if(panelInsta) panelInsta.style.display=isInsta?'flex':'none';
    const list=document.getElementById(isInsta?'atribInstaList':'atribList');
    const pag=document.getElementById(isInsta?'atribInstaPagination':'atribPagination');
    const badgeEl=document.getElementById(isInsta?'atribInstaFilaTotalBadge':'atribTotalBadge');
    if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// carregando...</div>`;
    const {rows,total,error}=await fetchRows();
    if(badgeEl) badgeEl.textContent=`${total} lead${total!==1?'s':''}`;
    if(error){ if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--error);text-align:center;padding:32px">// erro: ${esc(error.message)}</div>`; return; }
    if(!rows.length){ if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead em ${esc(stage())}</div>`; if(pag) pag.innerHTML=''; return; }
    if(list) list.innerHTML='<div class="ext-list atrib-v64-list">'+rows.map(card).join('')+'</div>';
    const totalPages=Math.max(1,Math.ceil(total/PER_PAGE));
    if(page>totalPages) page=totalPages;
    if(pag) pag.innerHTML=`<div style="display:flex;justify-content:center;gap:6px;margin-top:12px;font-family:'DM Mono',monospace;font-size:10px"><button class="btn btn-ghost" onclick="atribGoPageV31(${Math.max(1,page-1)})">←</button><span style="padding:8px;color:var(--muted)">Página ${page} de ${totalPages} · ${total} leads</span><button class="btn btn-ghost" onclick="atribGoPageV31(${Math.min(totalPages,page+1)})">→</button></div>`;
  }

  window.setAtribTab=function(tab){ currentTab=(tab==='com-site'||tab==='insta')?tab:'zap'; page=1; render(); };
  window.atribGoPageV31=function(p){ page=Math.max(1,Number(p)||1); render(); };
  window.renderAtribuicaoPanelV31=render;
  window.renderAtribuicao=render;
  window.__V64_ATRIBUICAO_CARDS_LINKS__=VERSION;

  document.addEventListener('DOMContentLoaded',()=>{ applyStyles(); if(document.getElementById('panel-atribuicao')?.classList.contains('active')) render(); });
  if(document.readyState!=='loading') setTimeout(()=>{ applyStyles(); if(document.getElementById('panel-atribuicao')?.classList.contains('active')) render(); },150);
})();
