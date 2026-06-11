/* ════════════════════════════
   PAGINAÇÃO — HELPERS
════════════════════════════ */
function buildPageNumbers(cur, total) {
  if (total <= 7) return Array.from({length:total},(_,i)=>i+1);
  const pages=[], delta=2;
  const left=Math.max(2,cur-delta), right=Math.min(total-1,cur+delta);
  pages.push(1);
  if (left>2) pages.push('…');
  for(let i=left;i<=right;i++) pages.push(i);
  if(right<total-1) pages.push('…');
  pages.push(total);
  return pages;
}
function renderPagination(containerId, cur, total, totalItems, pgSize, onPage, onSize, anchor) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (totalItems === 0) { el.innerHTML=''; return; }
  const start = (cur-1)*pgSize+1;
  const end   = Math.min(cur*pgSize, totalItems);
  const pgNums = buildPageNumbers(cur, total);
  el.innerHTML = `<div class="pagination-bar">
    <div class="pagination-info">Exibindo <strong>${start}–${end}</strong> de <strong>${totalItems}</strong></div>
    <div class="pagination-controls">
      <button class="pg-btn" onclick="${onPage}(${cur-1})" ${cur===1?'disabled':''}>‹</button>
      ${pgNums.map(p=>p==='…'?`<span class="pg-ellipsis">…</span>`:`<button class="pg-btn${p===cur?' active':''}" onclick="${onPage}(${p})">${p}</button>`).join('')}
      <button class="pg-btn" onclick="${onPage}(${cur+1})" ${cur===total?'disabled':''}>›</button>
    </div>
    <select class="pg-size-select" onchange="${onSize}(+this.value)" title="Itens por página">
      ${[10,20,50,100].map(n=>`<option value="${n}"${pgSize===n?' selected':''}>${n}/pág</option>`).join('')}
    </select>
  </div>`;
}

/* goPage functions per panel */
function goInicioPage(p)   { inicioPage=p;  renderInicio(); }
function changeInicioPgSize(n){ INICIO_PG=n; inicioPage=1; renderInicio(); }
function goImportPage(p)   { importPage=p;  importPreview(); }
function changeImportPgSize(n){ IMPORT_PG=n; importPage=1; importPreview(); }
function goValPage(p)      { valPage=p;     renderValidacao(); }
function changeValPgSize(n){ VAL_PG=n; valPage=1; renderValidacao(); }
function goAtribPage(p)    { atribPage=p;   renderAtribuicao(); }
function changeAtribPgSize(n){ ATRIB_PG=n; atribPage=1; renderAtribuicao(); }
function goDisparoPage(p)  { disparoPage=p; renderDisparoEmpresas(); }
function changeDisparoPgSize(n){ DISPARO_PG=n; disparoPage=1; renderDisparoEmpresas(); }

function showMsg(id, day) {
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;
  msgEmpresaId = id;
  const { text, idx } = pickTemplate(emp.nome, emp.ramoId || null);
  document.getElementById('msgPanelEmpresa').innerHTML = `empresa: <span>${escHtml(emp.nome)}</span>`;
  document.getElementById('msgBody').textContent = text;
  document.getElementById('msgCopyBtn').disabled = false;
  document.getElementById('msgModal').classList.add('open');
}
function fecharMsgModal() {
  document.getElementById('msgModal').classList.remove('open');
}
function copyMsg() {
  const text = document.getElementById('msgBody').textContent;
  navigator.clipboard.writeText(text).then(() => notify('✓ Mensagem copiada'));
}
function shuffleMsg() {
  if (!msgEmpresaId) return;
  const data = ensureWeekData();
  const emp  = Object.values(data.days).flat().find(e => e.id === msgEmpresaId);
  if (!emp) return;
  const { text, idx } = pickOtherTemplate(emp.nome, msgTemplateIdx, emp.ramoId || null);
  msgTemplateIdx = idx;
  document.getElementById('msgBody').textContent = text;
}
// Opções de status disponíveis dependendo do status atual
const STATUS_FORWARD_ONLY = ['Respondida','Não respondida','Recusada','Fechada'];
function getStatusOptions(currentStatus) {
  if (currentStatus === 'Enviada' || STATUS_FORWARD_ONLY.includes(currentStatus)) {
    // Não pode voltar — só status à frente + o atual
    return ['Enviada', ...STATUS_FORWARD_ONLY];
  }
  return STATUS_OPTIONS;
}

function updateStatus(id, day, status) {
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;
  // Bloquear retroação a partir de Enviada
  const curr = emp.status || 'Não enviada';
  const lockedForward = curr === 'Enviada' || STATUS_FORWARD_ONLY.includes(curr);
  if (lockedForward && !STATUS_FORWARD_ONLY.includes(status) && status !== 'Enviada') {
    notify('// não é possível retroceder após Enviada','warn');
    return;
  }
  emp.status = status;
  if (status === 'Enviada') emp.enviadoEm = todayStr();
  saveWeekData(data);
  updateBadges();
  renderInicio(); // re-render para atualizar o select corretamente
}
function editWhatsapp(id, day) {
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;
  const currentNum = emp.whatsapp || '';
  const allRows = document.querySelectorAll('#inicioTbody tr');
  let targetCell = null;
  allRows.forEach(row => {
    const delBtn = row.querySelector('.del-btn');
    if (delBtn && delBtn.getAttribute('onclick') && delBtn.getAttribute('onclick').includes(`'${id}'`)) targetCell = row.cells[3];
  });
  if (!targetCell) return;
  targetCell.innerHTML = `<div style="display:flex;align-items:center;gap:5px">
    <input id="waInput_${id}" type="text" value="${escHtml(currentNum)}" placeholder="ex: 11999999999"
      style="background:var(--bg);border:1px solid var(--accent);border-radius:6px;color:var(--text);font-family:'DM Mono',monospace;font-size:10px;padding:4px 8px;width:130px;outline:none"
      onkeydown="if(event.key==='Enter')saveWhatsapp('${id}','${day}');if(event.key==='Escape')renderInicio();"/>
    <button onclick="saveWhatsapp('${id}','${day}')" style="background:var(--accent);border:none;color:#0a0a0d;border-radius:5px;font-size:10px;padding:4px 8px;cursor:pointer;font-weight:700">✓</button>
    <button onclick="renderInicio()" style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:5px;font-size:10px;padding:4px 8px;cursor:pointer">✕</button>
  </div>`;
  document.getElementById(`waInput_${id}`).focus();
}
function normalizeWhatsappForLeadSaveV43(value = '') {
  let digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  if (!digits.startsWith('55') && digits.length > 11) {
    const last11 = digits.slice(-11);
    if (last11.length === 11) return '55' + last11;
  }
  return digits;
}

function applyWhatsappToLeadV43(lead, phone) {
  if (!lead) return lead;
  lead.whatsapp = phone;
  lead.phone = phone;
  lead.telefone = phone;
  lead.updatedAt = new Date().toISOString();
  return lead;
}

function updateWhatsappInLocalCollectionsV43(id, phone) {
  if (!id) return;

  const patchLead = lead => {
    if (lead && String(lead.id) === String(id)) applyWhatsappToLeadV43(lead, phone);
    return lead;
  };

  try {
    const base = typeof getLeadBaseData === 'function' ? getLeadBaseData() : [];
    if (Array.isArray(base) && base.some(lead => String(lead?.id) === String(id))) {
      const patched = base.map(patchLead);
      localStorage.setItem(LEADS_BASE_KEY, JSON.stringify(patched));
    }
  } catch (err) { console.warn('[inicio][whatsapp] base local:', err); }

  try {
    const atrib = typeof getAtribuicaoData === 'function' ? getAtribuicaoData() : [];
    if (Array.isArray(atrib) && atrib.some(lead => String(lead?.id) === String(id))) {
      localStorage.setItem(ATRIBUICAO_KEY, JSON.stringify(atrib.map(patchLead)));
    }
  } catch (err) { console.warn('[inicio][whatsapp] atribuição:', err); }

  try {
    const val = typeof getValData === 'function' ? getValData() : [];
    if (Array.isArray(val) && val.some(lead => String(lead?.id) === String(id))) {
      localStorage.setItem(VAL_KEY, JSON.stringify(val.map(patchLead)));
    }
  } catch (err) { console.warn('[inicio][whatsapp] validação:', err); }

  try {
    const acomp = typeof getAcompData === 'function' ? getAcompData() : {};
    let touched = false;
    Object.keys(acomp || {}).forEach(month => {
      if (!Array.isArray(acomp[month])) return;
      acomp[month] = acomp[month].map(lead => {
        if (String(lead?.id) === String(id)) { touched = true; return patchLead(lead); }
        return lead;
      });
    });
    if (touched) localStorage.setItem(ACOMP_KEY, JSON.stringify(acomp));
  } catch (err) { console.warn('[inicio][whatsapp] acompanhamento:', err); }
}

async function persistWhatsappLeadUpdateV43(lead) {
  if (!lead?.id) return { skipped:true };
  try {
    if (typeof upsertLeadToSupabase === 'function') {
      const result = await upsertLeadToSupabase(lead);
      console.log('[inicio][whatsapp] lead atualizado no Supabase', { id: lead.id, phone: lead.phone || lead.whatsapp, result });
      return result;
    }
    if (window.supabaseDataAdapter?.saveLead) {
      uiSyncLogV426('supabase-save-start', { entity:'lead', id:lead.id, action:'whatsapp-update' });
      const result = await window.supabaseDataAdapter.saveLead(lead);
      if (result?.error) {
        uiSyncLogV426('supabase-save-error', { entity:'lead', id:lead.id, action:'whatsapp-update', error:result.error?.message || result.error });
      } else {
        uiSyncLogV426('supabase-save-success', { entity:'lead', id:lead.id, action:'whatsapp-update' });
      }
      console.log('[inicio][whatsapp] lead atualizado no Supabase via adapter', { id: lead.id, phone: lead.phone || lead.whatsapp, result });
      return result;
    }
  } catch (err) {
    console.warn('[inicio][whatsapp] falha ao salvar número no Supabase:', err);
    return { error: err };
  }
  return { skipped:true };
}

function saveWhatsapp(id, day) {
  const input = document.getElementById(`waInput_${id}`);
  if (!input) return;
  const raw = input.value.trim();
  const phone = normalizeWhatsappForLeadSaveV43(raw);
  const data = ensureWeekData();
  const emp  = (data.days[day]||[]).find(e => e.id === id);
  if (!emp) return;

  applyWhatsappToLeadV43(emp, phone);
  updateWhatsappInLocalCollectionsV43(id, phone);
  saveWeekData(data);
  updateBadges();
  renderInicio();

  uiSyncLogV426('optimistic-update', { entity:'lead', action:'whatsapp-update', id, phone });
  if (typeof setLeadPersistenceStatusV426 === 'function') setLeadPersistenceStatusV426(id, 'saving');
  persistWhatsappLeadUpdateV43(emp).then(result => {
    if (result?.error) {
      if (typeof setLeadPersistenceStatusV426 === 'function') setLeadPersistenceStatusV426(id, 'pending', result.error?.message || result.error);
      notify('Número atualizado na tela. Salvamento no Supabase pendente.', 'warn');
      return;
    }
    if (typeof setLeadPersistenceStatusV426 === 'function') setLeadPersistenceStatusV426(id, 'saved');
  }).catch(error => {
    if (typeof setLeadPersistenceStatusV426 === 'function') setLeadPersistenceStatusV426(id, 'pending', error?.message || error);
    uiSyncLogV426('supabase-save-error', { entity:'lead', action:'whatsapp-update', id, error:error?.message || error });
    notify('Número atualizado na tela. Salvamento no Supabase pendente.', 'warn');
  });
  notify(phone ? '✓ Número atualizado' : '✓ Número removido');
}
function deleteEmpresa(id, day) {
  const data = ensureWeekData();
  const emp = (data.days[day]||[]).find(e => e.id === id);
  abrirModalConfirm(
    `Remover <strong>${emp ? escHtml(emp.nome) : 'esta empresa'}</strong> da semana?`,
    () => {
      const d = ensureWeekData();
      if (!d.days[day]) return;
      d.days[day] = d.days[day].filter(e => e.id !== id);
      saveWeekData(d); renderInicio(); updateBadges();
      notify('Empresa removida');
    }
  );
}
function clearAll() { document.getElementById('clearModal').classList.add('open'); }
function confirmClear() {
  const data = ensureWeekData();
  const flat = flattenWeekData(data);

  // Leads pós-envio → migrar para base mensal
  const STATUS_MENSAIS = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];
  const paraMes = flat.filter(e => STATUS_MENSAIS.includes(e.status||''));
  if (paraMes.length) migrarParaMes(paraMes);

  // Leads sem status (Não enviada) voltam para a Base de Atribuição
  const semStatus = flat.filter(e => !e.status || e.status === 'Não enviada' || e.status === 'Em fila');
  if (semStatus.length) {
    const atrib = getAtribuicaoData();
    const atribIds = new Set(atrib.map(a => a.id));
    const novosNaAtrib = semStatus
      .filter(e => !atribIds.has(e.id))
      .map(e => ({ ...e, voltouDaSemana: todayStr(), diaDestino: null }));
    saveAtribuicaoData([...atrib, ...novosNaAtrib]);
  }

  // Zera os dias da semana
  data.days = {};
  saveWeekData(data);
  document.getElementById('clearModal').classList.remove('open');
  renderInicio(); updateBadges();
  const msgs = [];
  if (paraMes.length) msgs.push(`${paraMes.length} lead${paraMes.length!==1?'s':''} → Acompanhamento`);
  if (semStatus.length) msgs.push(`${semStatus.length} → Atribuição`);
  notify('Semana limpa' + (msgs.length ? ' · ' + msgs.join(' · ') : ''));
}

function clearDayModal() {
  const weekDays = currentWeekDays();
  const data = ensureWeekData();
  const sel = document.getElementById('clearDaySelect');
  sel.innerHTML = weekDays.map(day => {
    const count = (data.days[day]||[]).length;
    return `<option value="${day}"${day===selectedDay?' selected':''}>${dayLabel(day)} — ${count} empresa${count!==1?'s':''}</option>`;
  }).join('');
  document.getElementById('clearDayModalOverlay').classList.add('open');
}

function confirmClearDay() {
  const day = document.getElementById('clearDaySelect').value;
  if (!day) return;
  const data = ensureWeekData();
  const emps = data.days[day] || [];

  // Leads pós-envio → migrar para base mensal
  const STATUS_MENSAIS = ['Enviada','Respondida','Não respondida','Recusada','Fechada'];
  const paraMes = emps.filter(e => STATUS_MENSAIS.includes(e.status||''));
  if (paraMes.length) migrarParaMes(paraMes);

  // Leads sem status voltam para Atribuição
  const semStatus = emps.filter(e => !e.status || e.status === 'Não enviada' || e.status === 'Em fila');
  if (semStatus.length) {
    const atrib = getAtribuicaoData();
    const atribIds = new Set(atrib.map(a => a.id));
    const novos = semStatus.filter(e => !atribIds.has(e.id)).map(e => ({ ...e, voltouDaSemana: todayStr(), diaDestino: null }));
    saveAtribuicaoData([...atrib, ...novos]);
  }

  // Remove todos do dia
  data.days[day] = [];
  saveWeekData(data);
  document.getElementById('clearDayModalOverlay').classList.remove('open');
  renderInicio(); updateBadges();
  const msgs = [];
  if (paraMes.length) msgs.push(`${paraMes.length} → Acompanhamento`);
  if (semStatus.length) msgs.push(`${semStatus.length} → Atribuição`);
  notify(`${dayLabel(day)} limpo` + (msgs.length ? ' · ' + msgs.join(' · ') : ''));
}
