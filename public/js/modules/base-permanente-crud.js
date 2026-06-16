/* V34 — Base Permanente CRUD
   Substitui a visão simples de Já Enviados por uma base editável de proteção.
   Fonte principal: public.base_permanente. Fallback visual: public.sent_contacts. */
(function(){
  const STATUS_LABELS = {
    ja_enviado: 'Já enviado',
    duplicado: 'Duplicado',
    invalido: 'Inválido',
    arquivado: 'Arquivado'
  };
  const STATUS_OPTIONS = ['ja_enviado','duplicado','invalido','arquivado'];
  let editingRow = null;
  let currentStatus = 'all';

  function sb(){ try { return window.sbClient || sbClient || null; } catch(_) { return window.sbClient || null; } }
  function uid(){ try { return window.currentUser?.id || currentUser?.id || ''; } catch(_) { return window.currentUser?.id || ''; } }
  function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
  function todayIso(){ return new Date().toISOString(); }
  function onlyDigits(v){ return String(v||'').replace(/\D/g,''); }
  function normPhone(v){
    let d = onlyDigits(v);
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('55')) return d;
    if (d.length === 10 || d.length === 11) return '55' + d;
    return d;
  }
  function normSite(v){
    let raw = String(v||'').trim();
    if (!raw) return '';
    try {
      const u = raw.startsWith('http') ? new URL(raw) : new URL('https://' + raw);
      return u.hostname.replace(/^www\./i,'').toLowerCase();
    } catch(_) {
      return raw.replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
    }
  }
  function normInsta(v){
    let raw = String(v||'').trim();
    if (!raw) return '';
    raw = raw.replace(/^@/,'');
    try {
      if (raw.includes('instagram.com')) {
        const u = raw.startsWith('http') ? new URL(raw) : new URL('https://' + raw);
        return (u.pathname.split('/').filter(Boolean)[0] || '').replace(/^@/,'').toLowerCase();
      }
    } catch(_) {}
    return raw.split('?')[0].split('/')[0].replace(/^@/,'').toLowerCase();
  }
  function normUrl(v){ return String(v||'').trim().replace(/\/+$/,'').toLowerCase(); }
  function fmtDate(v){
    if (!v) return '—';
    try { return new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch(_) { return v; }
  }
  function channelLabel(ch){ return ({whatsapp:'WhatsApp',instagram:'Instagram',email:'Email',manual:'Manual'})[String(ch||'').toLowerCase()] || (ch || '—'); }
  function channelIcon(ch){ return ({whatsapp:'💬',instagram:'📸',email:'✉️',manual:'✍️'})[String(ch||'').toLowerCase()] || '•'; }
  function channelsFromRow(r){
    const arr = Array.isArray(r.sent_channels) ? r.sent_channels : [];
    const out = [...arr];
    if (r.last_channel && !out.includes(r.last_channel)) out.unshift(r.last_channel);
    if (r.whatsapp_sent_at && !out.includes('whatsapp')) out.push('whatsapp');
    if (r.instagram_sent_at && !out.includes('instagram')) out.push('instagram');
    if (r.email_sent_at && !out.includes('email')) out.push('email');
    return out.filter(Boolean);
  }
  function notifyMsg(msg,type){ if (typeof window.notify === 'function') window.notify(msg,type||''); else console.log(msg); }

  async function fetchRows(){
    const c = sb(); const user = uid();
    if (!c || !user) return [];
    const q = (document.getElementById('sentContactsSearch')?.value || '').trim().toLowerCase();
    let query = c.from('base_permanente')
      .select('id,user_id,company_name,normalized_phone,website,instagram_url,maps_url,street,city,state,country_code,category,category_name,categories,rating,reviews_count,status,notes,raw_payload,last_channel,source_account,source_instance,last_contact_at,whatsapp_sent_at,instagram_sent_at,email_sent_at,manual_sent_at,sent_channels,last_event_type,last_event_status,created_at,updated_at')
      .eq('user_id', user)
      .order('updated_at', { ascending:false });
    if (currentStatus !== 'all') query = query.eq('status', currentStatus);
    const { data, error } = await query;
    if (error) {
      console.warn('[base_permanente][load-error]', error.message || error);
      // fallback para tabela antiga, sem CRUD completo
      const old = await c.from('sent_contacts')
        .select('id,company_name,phone,normalized_phone,block_type,source,reason,active,dispatched_at,created_at,raw_payload')
        .eq('user_id', user).eq('active', true).order('created_at',{ascending:false});
      if (old.error) return [];
      return (old.data || []).map(r => ({
        id:r.id, company_name:r.company_name, normalized_phone:r.normalized_phone || r.phone,
        website:'', instagram_url:'', maps_url:'', street:'', city:'', state:'', country_code:'', category:'', category_name:'', categories:[], rating:null, reviews_count:null, status:'ja_enviado', notes:r.reason || r.source || '', raw_payload:r.raw_payload || {},
        created_at:r.created_at, updated_at:r.dispatched_at || r.created_at, last_channel:'whatsapp', source_account:r.source||'sent_contacts', last_contact_at:r.dispatched_at||r.created_at, whatsapp_sent_at:r.dispatched_at||r.created_at, sent_channels:['whatsapp'], _fallback:true
      }));
    }
    let rows = data || [];
    if (q) {
      rows = rows.filter(r => `${r.company_name||''} ${r.normalized_phone||''} ${r.website||''} ${r.instagram_url||''} ${r.maps_url||''} ${r.status||''} ${r.notes||''} ${r.city||''} ${r.state||''} ${r.category||''} ${r.category_name||''} ${(Array.isArray(r.categories)?r.categories.join(' '):'')}`.toLowerCase().includes(q));
    }
    return rows;
  }

  function formHtml(row = {}){
    const isEdit = !!row.id;
    return `<div class="base-perm-form" style="border:1px solid rgba(184,240,89,.24);background:rgba(184,240,89,.04);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:10px">
        <div class="field-group"><label>Empresa</label><input id="bpCompany" value="${esc(row.company_name||'')}" placeholder="Nome da empresa"></div>
        <div class="field-group"><label>Telefone</label><input id="bpPhone" value="${esc(row.normalized_phone||'')}" placeholder="5511999999999"></div>
        <div class="field-group"><label>Website</label><input id="bpWebsite" value="${esc(row.website||'')}" placeholder="dominio.com.br"></div>
        <div class="field-group"><label>Instagram</label><input id="bpInstagram" value="${esc(row.instagram_url||'')}" placeholder="@perfil ou link"></div>
        <div class="field-group"><label>Google Maps</label><input id="bpMaps" value="${esc(row.maps_url||'')}" placeholder="link do Google Maps"></div>
        <div class="field-group"><label>Status</label><select id="bpStatus">${STATUS_OPTIONS.map(st=>`<option value="${st}" ${String(row.status||'ja_enviado')===st?'selected':''}>${STATUS_LABELS[st]}</option>`).join('')}</select></div>
        <div class="field-group"><label>Canal do último envio</label><select id="bpLastChannel"><option value="">Não informado</option>${['whatsapp','instagram','email','manual'].map(ch=>`<option value="${ch}" ${String(row.last_channel||'')===ch?'selected':''}>${channelLabel(ch)}</option>`).join('')}</select></div>
        <div class="field-group"><label>Conta/chip/perfil</label><input id="bpSourceAccount" value="${esc(row.source_account||row.source_instance||'')}" placeholder="Chip 8457, @perfil, etc."></div>
        <div class="field-group"><label>Endereço</label><input id="bpStreet" value="${esc(row.street||'')}" placeholder="Rua, avenida, número"></div>
        <div class="field-group"><label>Cidade</label><input id="bpCity" value="${esc(row.city||'')}" placeholder="Cidade"></div>
        <div class="field-group"><label>Estado</label><input id="bpState" value="${esc(row.state||'')}" placeholder="Estado"></div>
        <div class="field-group"><label>País</label><input id="bpCountry" value="${esc(row.country_code||'')}" placeholder="BR"></div>
        <div class="field-group"><label>Categoria principal</label><input id="bpCategory" value="${esc(row.category_name||row.category||'')}" placeholder="Categoria"></div>
        <div class="field-group"><label>Avaliação</label><input id="bpRating" value="${esc(row.rating ?? '')}" placeholder="4.8"></div>
        <div class="field-group"><label>Reviews</label><input id="bpReviews" value="${esc(row.reviews_count ?? '')}" placeholder="16"></div>
        <div class="field-group"><label>Subcategorias</label><input id="bpCategories" value="${esc(Array.isArray(row.categories)?row.categories.join(', '):'')}" placeholder="Marceneiro, Moveleiro"></div>
      </div>
      <div class="field-group" style="margin-top:10px"><label>Observação</label><textarea id="bpNotes" rows="2" placeholder="Observações internas">${esc(row.notes||'')}</textarea></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
        <button class="btn btn-ghost" onclick="cancelBasePermanenteFormV34()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveBasePermanenteV34('${esc(row.id||'')}')">${isEdit?'Salvar alterações':'Criar registro'}</button>
      </div>
    </div>`;
  }

  function rowHtml(r){
    if (editingRow && editingRow.id === r.id) return formHtml(r);
    const status = r.status || 'ja_enviado';
    const label = STATUS_LABELS[status] || status;
    const statusColor = status === 'arquivado' ? 'var(--muted)' : status === 'invalido' ? 'var(--error)' : status === 'duplicado' ? '#f2b84b' : 'var(--ok)';
    return `<div class="empresa-card base-perm-card" style="border-color:rgba(184,240,89,.12)">
      <div class="empresa-info">
        <div class="empresa-nome">${esc(r.company_name || 'Sem nome')}</div>
        <div class="empresa-meta" style="gap:8px;flex-wrap:wrap">
          <span style="color:${statusColor};border:1px solid rgba(255,255,255,.12);border-radius:4px;padding:2px 7px">${esc(label)}</span>
          ${channelsFromRow(r).map(ch=>`<span style="border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 7px">${channelIcon(ch)} ${esc(channelLabel(ch))}</span>`).join('')}
          ${r.last_contact_at?`<span>Último contato: ${fmtDate(r.last_contact_at)}</span>`:''}
          ${r.normalized_phone?`<span>📱 ${esc(r.normalized_phone)}</span>`:''}
          ${r.website?`<span>🌐 ${esc(r.website)}</span>`:''}
          ${r.instagram_url?`<span>📸 ${esc(r.instagram_url)}</span>`:''}
          ${r.maps_url?`<span>🗺️ Maps</span>`:''}
          ${r.city||r.state?`<span>📍 ${esc([r.city,r.state].filter(Boolean).join(' · '))}</span>`:''}
          ${r.category_name||r.category?`<span>🏷️ ${esc(r.category_name||r.category)}</span>`:''}
          ${r.rating||r.reviews_count?`<span>⭐ ${esc(r.rating ?? '—')} (${esc(r.reviews_count ?? 0)})</span>`:''}
          <span>${fmtDate(r.updated_at || r.created_at)}</span>
          ${r._fallback?`<span style="color:#f2b84b">fallback sent_contacts</span>`:''}
        </div>
        ${r.notes?`<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:6px">${esc(r.notes)}</div>`:''}
      </div>
      <div class="empresa-actions" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="openLeadDrawer('${esc(r.id)}')">Ficha</button>
        <button class="btn btn-ghost" onclick="editBasePermanenteV34('${esc(r.id)}')">Editar</button>
        ${status === 'arquivado'
          ? `<button class="btn btn-primary" onclick="setBasePermanenteStatusV34('${esc(r.id)}','ja_enviado')">Reativar</button>`
          : `<button class="btn btn-ghost" onclick="setBasePermanenteStatusV34('${esc(r.id)}','arquivado')">Arquivar</button>`}
        <button class="btn btn-danger" onclick="deleteBasePermanenteV34('${esc(r.id)}')">Excluir</button>
      </div>
    </div>`;
  }

  async function render(){
    installLabels();
    const list = document.getElementById('sentContactsList');
    const badge = document.getElementById('badge-ja-enviados');
    const countEl = document.getElementById('sentContactsCount');
    if (!list) return;
    list.innerHTML = `<div style="padding:24px;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px">// carregando base permanente...</div>`;
    const rows = await fetchRows();
    try { window.__basePermanenteRowsV34 = rows; } catch (_) {}
    if (badge) badge.textContent = String(rows.length);
    if (countEl) countEl.textContent = `${rows.length} registro${rows.length!==1?'s':''}`;
    const filters = `<div class="base-perm-tabs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${['all',...STATUS_OPTIONS].map(st=>`<button class="chip-tab ${currentStatus===st?'active':''}" onclick="setBasePermanenteFilterV34('${st}')">${st==='all'?'Todos':STATUS_LABELS[st]}</button>`).join('')}
    </div>`;
    const form = editingRow === 'new' ? formHtml({}) : '';
    if (!rows.length) {
      list.innerHTML = filters + form + `<div style="padding:32px;text-align:center;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px">// nenhum registro encontrado na Base Permanente</div>`;
      return;
    }
    list.innerHTML = filters + form + `<div class="ext-list">${rows.map(rowHtml).join('')}</div>`;
  }

  async function save(id=''){
    const c=sb(); const user=uid();
    if(!c || !user) return notifyMsg('// Supabase/usuário indisponível','err');
    const row = {
      user_id:user,
      company_name:document.getElementById('bpCompany')?.value?.trim() || null,
      normalized_phone:normPhone(document.getElementById('bpPhone')?.value || '') || null,
      website:normSite(document.getElementById('bpWebsite')?.value || '') || null,
      instagram_url:normInsta(document.getElementById('bpInstagram')?.value || '') || null,
      maps_url:normUrl(document.getElementById('bpMaps')?.value || '') || null,
      street:document.getElementById('bpStreet')?.value?.trim() || null,
      city:document.getElementById('bpCity')?.value?.trim() || null,
      state:document.getElementById('bpState')?.value?.trim() || null,
      country_code:document.getElementById('bpCountry')?.value?.trim() || null,
      category:document.getElementById('bpCategory')?.value?.trim() || null,
      category_name:document.getElementById('bpCategory')?.value?.trim() || null,
      categories:(document.getElementById('bpCategories')?.value || '').split(',').map(v=>v.trim()).filter(Boolean),
      rating:Number(document.getElementById('bpRating')?.value || '') || null,
      reviews_count:Number(String(document.getElementById('bpReviews')?.value || '').replace(/\D/g,'')) || null,
      status:document.getElementById('bpStatus')?.value || 'ja_enviado',
      last_channel:document.getElementById('bpLastChannel')?.value || null,
      source_account:document.getElementById('bpSourceAccount')?.value?.trim() || null,
      source_instance:document.getElementById('bpSourceAccount')?.value?.trim() || null,
      notes:document.getElementById('bpNotes')?.value?.trim() || null,
      updated_at:todayIso()
    };
    if(row.last_channel){
      row.last_contact_at = row.last_contact_at || todayIso();
      row.sent_channels = [row.last_channel];
      if(row.last_channel === 'whatsapp') row.whatsapp_sent_at = row.last_contact_at;
      if(row.last_channel === 'instagram') row.instagram_sent_at = row.last_contact_at;
      if(row.last_channel === 'email') row.email_sent_at = row.last_contact_at;
      if(row.last_channel === 'manual') row.manual_sent_at = row.last_contact_at;
      row.last_event_type = 'sent';
      row.last_event_status = 'sent';
    }
    if(!row.company_name && !row.normalized_phone && !row.website && !row.instagram_url && !row.maps_url){
      return notifyMsg('// preencha pelo menos empresa, telefone, site, Instagram ou Maps','err');
    }
    let res;
    if(id){
      res = await c.from('base_permanente').update(row).eq('user_id',user).eq('id',id).select('id').maybeSingle();
    } else {
      row.created_at = todayIso();
      res = await c.from('base_permanente').insert(row).select('id').maybeSingle();
    }
    if(res.error) return notifyMsg('// erro ao salvar: '+res.error.message,'err');
    editingRow=null; notifyMsg('✓ Base Permanente atualizada'); render();
  }
  async function setStatus(id,status){
    const c=sb(); const user=uid(); if(!c||!user) return;
    const { error } = await c.from('base_permanente').update({status,updated_at:todayIso()}).eq('user_id',user).eq('id',id);
    if(error) return notifyMsg('// erro: '+error.message,'err');
    render();
  }
  async function remove(id){
    if(!confirm('Remover este registro da Base Permanente? Ele deixará de proteger a importação.')) return;
    const c=sb(); const user=uid(); if(!c||!user) return;
    const { error } = await c.from('base_permanente').delete().eq('user_id',user).eq('id',id);
    if(error) return notifyMsg('// erro ao excluir: '+error.message,'err');
    render();
  }
  function installLabels(){
    document.querySelectorAll('[data-label="Já enviados"],[data-label="Base Permanente"]').forEach(el=>{
      el.setAttribute('data-label','Base Permanente');
      const label=el.querySelector('.nav-label'); if(label) label.textContent='Base Permanente';
      const icon=el.querySelector('.nav-icon'); if(icon) icon.textContent='🛡️';
    });
    const title=document.querySelector('#panel-ja-enviados .page-title');
    if(title) title.innerHTML='Base <span>permanente.</span>';
    const sub=document.querySelector('#panel-ja-enviados .page-sub');
    if(sub) sub.textContent='// proteção ativa · telefone, site, Instagram e Google Maps com CRUD';
  }

  window.renderBasePermanentePanelV34 = render;
  window.openBasePermanenteFormV34 = function(){ editingRow='new'; render(); };
  window.cancelBasePermanenteFormV34 = function(){ editingRow=null; render(); };
  window.saveBasePermanenteV34 = save;
  window.editBasePermanenteV34 = async function(id){
    const rows=await fetchRows(); editingRow=rows.find(r=>String(r.id)===String(id)) || null; render();
  };
  window.setBasePermanenteStatusV34 = setStatus;
  window.deleteBasePermanenteV34 = remove;
  window.setBasePermanenteFilterV34 = function(st){ currentStatus=st||'all'; render(); };

  // Aliases antigos usados pela navegação existente.
  window.renderSentContactsPanelV31 = render;
  window.renderSentContactsPanel = render;
  window.loadSentContactsPanel = render;

  const oldSwitch = window.switchPanel;
  window.switchPanel = function(name){
    const key = String(name || '').toLowerCase();
    if (key === 'ja-enviados' || key === 'base-permanente') {
      if (typeof oldSwitch === 'function') oldSwitch.call(this, 'ja-enviados');
      setTimeout(render, 40);
      return;
    }
    return typeof oldSwitch === 'function' ? oldSwitch.apply(this, arguments) : undefined;
  };
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ installLabels(); if(document.getElementById('panel-ja-enviados')?.classList.contains('active')) render(); },700));
})();
