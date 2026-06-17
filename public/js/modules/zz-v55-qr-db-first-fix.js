/* V55 — QR Code DB-first para chips WhatsApp
   - Não altera remoção/ativação.
   - Busca o chip fresco no Supabase antes de gerar QR, garantindo api_key/base_url atuais.
   - Mantém apenas chips active=true.
   - Exibe erro real da Evolution em vez de mensagem genérica. */
(function(){
  'use strict';
  const VERSION='v55-qr-db-first-fix';
  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function setQr(html){ const el=document.getElementById('qrWrap'); if(el) el.innerHTML=html; }
  function normalize(row){
    const instance=String(row?.instance || row?.name || row?.chip_id || '').trim();
    return {
      ...row,
      id:String(row?.chip_id || row?.id || instance),
      dbId:row?.id || null,
      nome:row?.name || row?.label || instance || 'WhatsApp',
      name:row?.name || row?.label || instance || 'WhatsApp',
      instance,
      url:String(row?.base_url || row?.evolution_url || row?.url || 'https://evolution.samuelvinsansi.com.br').replace(/\/$/,''),
      key:row?.api_key || row?.key || row?.apikey || row?.apiKey || '',
      apiKey:row?.api_key || row?.key || row?.apikey || row?.apiKey || ''
    };
  }
  async function getFreshChip(id){
    const local = (typeof window.getChipById==='function') ? window.getChipById(id) : null;
    const c=sb(), userId=uid();
    if(!c || !userId) return local;
    const select='id,user_id,chip_id,label,name,instance,base_url,evolution_url,url,api_key,status,connection_state,active';
    const candidates=[
      ['id', local?.dbId || id],
      ['chip_id', local?.id || id],
      ['instance', local?.instance || id]
    ].filter(x=>x[1]);
    for(const [field,value] of candidates){
      const {data,error}=await c.from('whatsapp_instances').select(select).eq('user_id',userId).eq('active',true).eq(field,String(value)).maybeSingle();
      if(error) console.warn(`[${VERSION}][${field}]`,error.message);
      if(data) return normalize(data);
    }
    return local;
  }
  async function fetchQr(chip){
    const url=`${String(chip.url||'').replace(/\/$/,'')}/instance/connect/${encodeURIComponent(chip.instance)}`;
    const res=await fetch(url,{ headers:{ apikey: chip.key || chip.apiKey || '' } });
    const text=await res.text();
    let data={};
    try { data=JSON.parse(text); } catch(e){ data={raw:text}; }
    if(!res.ok){
      const msg=data?.message || data?.error || data?.raw || `HTTP ${res.status}`;
      throw new Error(String(msg));
    }
    const qr=data?.qrcode?.base64 || data?.base64 || data?.qr || data?.qrcode || '';
    return qr;
  }
  window.verQRChip=async function(id){
    window.qrChipIdAtivo=id;
    const chip=await getFreshChip(id);
    if(!chip){ setQr('<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--error)">✗ Chip não encontrado ou desativado</div>'); return; }
    const nameEl=document.getElementById('qrChipNome');
    if(nameEl) nameEl.textContent=chip.nome || chip.name || chip.instance;
    const modal=document.getElementById('qrModal');
    if(modal) modal.classList.add('open');
    await window.carregarQR(chip);
  };
  window.carregarQR=async function(chip){
    setQr('<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">Gerando QR Code...</div>');
    try{
      const fresh=await getFreshChip(chip?.dbId || chip?.id || chip?.instance);
      if(!fresh?.instance) throw new Error('instância do chip não encontrada no Supabase');
      if(!fresh?.key && !fresh?.apiKey) throw new Error('api_key do chip não encontrada no Supabase');
      const qr=await fetchQr(fresh);
      if(qr){ setQr(`<img src="${String(qr).startsWith('data:')?qr:'data:image/png;base64,'+qr}" alt="QR Code"/>`); }
      else { setQr('<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--ok)">✓ Instância já conectada ou QR indisponível no momento</div>'); }
    }catch(e){
      console.warn(`[${VERSION}][qr]`,e);
      setQr(`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--error)">✗ Erro ao gerar QR Code<br><span style="color:var(--muted)">${esc(e?.message||e)}</span></div>`);
    }
  };
  window.atualizarQR=async function(){
    if(!window.qrChipIdAtivo) return;
    const chip=await getFreshChip(window.qrChipIdAtivo);
    if(chip) await window.carregarQR(chip);
  };
})();
