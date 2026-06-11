/* ════════════════════════════
   VALIDAÇÃO
════════════════════════════ */
function setValTab(tab) {
  valTab = tab;
  const el = document.getElementById('valTabComSite');
  if (el) el.classList.toggle('active', tab==='com-site');
}

/* ── aba de resultado de validação (pendentes / validados) ── */
let valResultTab = 'pendentes'; // 'pendentes' | 'validados'
let validadorAba = 'pendentes'; // qual aba o validador de links vai operar

function setValResultTab(tab) {
  valResultTab = tab;
  valPage = 1;
  // estilo dos botões
  const btnP = document.getElementById('valResultTabPendentes');
  const btnV = document.getElementById('valResultTabValidados');
  if (btnP && btnV) {
    if (tab === 'pendentes') {
      btnP.style.cssText = 'padding:6px 14px;border:1px solid var(--accent-border);border-radius:8px;background:var(--accent-dim);color:var(--accent);font-family:\'DM Mono\',monospace;font-size:9px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px';
      btnV.style.cssText = 'padding:6px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--muted);font-family:\'DM Mono\',monospace;font-size:9px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px';
    } else {
      btnV.style.cssText = 'padding:6px 14px;border:1px solid var(--accent-border);border-radius:8px;background:var(--accent-dim);color:var(--accent);font-family:\'DM Mono\',monospace;font-size:9px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px';
      btnP.style.cssText = 'padding:6px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--muted);font-family:\'DM Mono\',monospace;font-size:9px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px';
    }
  }
  renderValidacao();
}

function setValidadorAba(aba) {
  validadorAba = aba;
  const btn0 = document.getElementById('validadorAbaBtn0');
  const btn1 = document.getElementById('validadorAbaBtn1');
  const info = document.getElementById('validadorAbaInfo');
  if (btn0 && btn1) {
    if (aba === 'pendentes') {
      btn0.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--accent-border);border-radius:6px;background:var(--accent-dim);color:var(--accent);font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;transition:all 0.18s;white-space:nowrap';
      btn1.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--muted);font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;transition:all 0.18s;white-space:nowrap';
    } else {
      btn1.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--accent-border);border-radius:6px;background:var(--accent-dim);color:var(--accent);font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;transition:all 0.18s;white-space:nowrap';
      btn0.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--muted);font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;transition:all 0.18s;white-space:nowrap';
    }
  }
  if (info) {
    const abaLabel = aba === 'pendentes' ? '<strong style="color:var(--accent)">Aguardando / Inválidos</strong>' : '<strong style="color:var(--ok)">Número Validado</strong>';
    info.innerHTML = `Cole os links que achar bons. Os sites <strong style="color:var(--text2)">não colados</strong> serão removidos apenas da aba ${abaLabel}.`;
  }
  // Recalcula badge ao trocar aba
  previewValidadorLinks();
}

function renderValidacao() {
  const val = getValData();
  // Suporta tanto 'sem-site' (novo fluxo) quanto 'com-site' (legado) — todos entram na validação
  const comSite = val.filter(v => v.tipo === 'sem-site' || v.tipo === 'com-site' || !v.tipo);

  const semZap = comSite.filter(v => v.numStatus !== 'valido');
  const comZap = comSite.filter(v => v.numStatus === 'valido');

  // atualiza contadores nas abas
  const countSem = document.getElementById('valCountSemZap');
  const countCom = document.getElementById('valCountComZap');
  if (countSem) countSem.textContent = semZap.length;
  if (countCom) countCom.textContent = comZap.length;

  const countEl = document.getElementById('valCountComSite');
  if (countEl) countEl.textContent = `(${comSite.length})`;

  // chip tabs para validação — prioridade chip 2 (final 8457)
  const chips = getChips();
  const chipPriority = chips.find(c => c.nome && c.nome.includes('8457')) || chips.find(c => c.nome && c.nome.toLowerCase().includes('ativação')) || chips[1] || chips[0];
  if (!activeChipId && chips.length) activeChipId = chipPriority ? chipPriority.id : chips[0].id;

  document.getElementById('valChipTabs').innerHTML = chips.length
    ? chips.map(c => `<div class="chip-tab${activeChipId===c.id?' active':''}" onclick="setValChip('${c.id}')">${escHtml(c.nome)}</div>`).join('')
    : '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">Nenhum chip configurado</span>';

  const comSiteEl = document.getElementById('valComSiteList');

  // seleciona qual grupo mostrar baseado na aba ativa
  const activeGroup = valResultTab === 'validados' ? comZap : semZap;
  const groupLabel = valResultTab === 'validados'
    ? `<div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--ok);letter-spacing:0.1em;text-transform:uppercase;padding:8px 4px 6px;border-bottom:1px solid var(--border);margin-bottom:6px">
        ✅ Número Validado <span style="background:rgba(78,203,113,0.1);border:1px solid rgba(78,203,113,0.3);color:var(--ok);padding:1px 6px;border-radius:100px;margin-left:4px">${comZap.length}</span>
       </div>`
    : `<div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;padding:8px 4px 6px;border-bottom:1px solid var(--border);margin-bottom:6px">
        📋 Aguardando / Sem WhatsApp <span style="background:rgba(255,92,92,0.1);border:1px solid rgba(255,92,92,0.3);color:var(--error);padding:1px 6px;border-radius:100px;margin-left:4px">${semZap.length}</span>
       </div>`;

  if (!comSite.length) {
    comSiteEl.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);padding:20px;text-align:center">// nenhuma empresa aguardando validação</div>';
  } else if (!activeGroup.length) {
    const emptyMsg = valResultTab === 'validados'
      ? '// nenhum número validado ainda'
      : '// nenhuma empresa pendente ou inválida';
    comSiteEl.innerHTML = `${groupLabel}<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:20px;text-align:center">${emptyMsg}</div>`;
  } else {
    // Pré-calcula os domínios dos links colados para mostrar indicador por card
    const _rawLinks = document.getElementById('validadorLinksInput')?.value || '';
    const _normLink = (url) => { try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return url.toLowerCase().trim(); } };
    const _linkDomains = new Set(_rawLinks.split('\n').map(l=>l.trim()).filter(l=>l.startsWith('http')).map(_normLink));

    const renderCard = (v) => {
      const statusColor = v.numStatus==='valido'?'var(--ok)':v.numStatus==='invalido'?'var(--error)':'var(--muted)';
      const statusLabel = v.numStatus==='valido'?'✓ número válido':v.numStatus==='invalido'?'✗ sem WhatsApp':'pendente';
      const chipId = v.chipValidacaoId || activeChipId;
      const chipNome = getChipById(chipId) ? getChipById(chipId).nome : '';
      const isMantido = v.site && _linkDomains.size > 0 && _linkDomains.has(_normLink(v.site));
      const mantidoBadge = isMantido
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-family:'DM Mono',monospace;font-size:7px;padding:2px 7px;border-radius:100px;border:1px solid rgba(91,184,245,0.35);background:rgba(91,184,245,0.07);color:#5bb8f5;white-space:nowrap"><span style="width:4px;height:4px;border-radius:50%;background:#5bb8f5;display:inline-block;flex-shrink:0"></span>mantido</span>`
        : '';
      return `<div class="empresa-card" id="val-card-${v.id}">
        <div class="empresa-info">
          <div class="empresa-nome">
            ${v.googleUrl?`<a href="${escHtml(v.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text)'">${escHtml(v.nome)}</a>`:escHtml(v.nome)}
          </div>
          <div class="empresa-meta">
            ${v.site?`<div class="empresa-site"><a href="${escHtml(v.site)}" target="_blank">${escHtml(v.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a></div>`:''}
            <div class="empresa-phone">📱
              <span id="val-phone-${v.id}" style="cursor:pointer" onclick="editValPhone('${v.id}')">${escHtml(v.whatsapp||'—')}</span>
            </div>
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:${statusColor}">${statusLabel}</span>
            ${chipNome?`<span class="q-badge ok" style="font-size:7px">📱 ${escHtml(chipNome)}</span>`:''}
            ${mantidoBadge}
          </div>
          <div class="empresa-meta" style="margin-top:4px">
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">importado em:</span>
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--text2)">${v.importadoEm || '—'}</span>
          </div>
        </div>
        <div class="empresa-actions">
          ${v.numStatus==='valido'
            ?`<button class="add-btn added" onclick="aprovarParaFila('${v.id}')">→ Atribuir</button>`
            : v.numStatus==='invalido'
              ?`<button class="add-btn added" onclick="aprovarParaInsta('${v.id}')">→ Instagram</button>
                <button class="add-btn" onclick="validarNumeroUnico('${v.id}')">Validar novamente</button>`
              :`<button class="add-btn" onclick="validarNumeroUnico('${v.id}')">Validar</button>`
          }
          <button class="del-btn" onclick="removerDaValidacao('${v.id}')">✕</button>
        </div>
      </div>`;
    };

    const totalVal = activeGroup.length;
    const totalValPages = Math.max(1, Math.ceil(totalVal / VAL_PG));
    if (valPage > totalValPages) valPage = totalValPages;
    const pageCards = activeGroup.slice((valPage-1)*VAL_PG, valPage*VAL_PG);

    comSiteEl.innerHTML = groupLabel + '<div class="ext-list">' + pageCards.map(renderCard).join('') + '</div>';
    renderPagination('valPagination', valPage, totalValPages, totalVal, VAL_PG, 'goValPage', 'changeValPgSize');
  }
  renderValidadorLinks();
}

function setValChip(id) { activeChipId = id; valPage = 1; renderValidacao(); }

function editValPhone(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  const el = document.getElementById(`val-phone-${id}`);
  if (!el) return;
  el.outerHTML = `<input id="val-phone-edit-${id}" type="text" value="${escHtml(v.whatsapp||'')}"
    style="background:var(--bg);border:1px solid var(--accent);border-radius:5px;color:var(--text);font-family:'DM Mono',monospace;font-size:9px;padding:3px 7px;width:120px;outline:none"
    onkeydown="if(event.key==='Enter')saveValPhone('${id}');if(event.key==='Escape')renderValidacao();" onblur="saveValPhone('${id}')"/>`;
  document.getElementById(`val-phone-edit-${id}`)?.focus();
}

function saveValPhone(id) {
  const input = document.getElementById(`val-phone-edit-${id}`);
  if (!input) return;
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  v.whatsapp = input.value.trim();
  v.numStatus = 'pendente';
  saveValData(val); renderValidacao(); notify('✓ Número atualizado');
  persistOptimisticLeadV426(v, 'validation-phone-update');
}

async function validarNumeroUnico(id) {
  const chip = getChipById(activeChipId);
  if (!chip) { notify('// selecione um chip primeiro','warn'); return; }
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  const phone = normalizePhone(v.whatsapp || '');
  if (!phone || phone.length < 10) { notify('// número inválido','err'); return; }
  const numero = phone.startsWith('55') ? phone : '55' + phone;

  const card = document.getElementById(`val-card-${id}`);
  if (card) card.style.opacity = '0.6';
  try {
    const res = await fetch(`${chip.url}/chat/whatsappNumbers/${chip.instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': chip.key },
      body: JSON.stringify({ numbers: [numero] })
    });
    const data = await res.json();
    const result = Array.isArray(data) ? data[0] : data;
    v.numStatus = result?.exists ? 'valido' : 'invalido';
    saveValData(val); renderValidacao();
    notify(result?.exists ? `✓ ${v.nome} — número válido` : `✗ ${v.nome} — sem WhatsApp`);
  } catch(e) {
    notify('// erro ao validar número','err');
    if (card) card.style.opacity = '1';
  }
}

async function validarTodosNumeros() {
  const chip = getChipById(activeChipId);
  if (!chip) { notify('// selecione um chip primeiro','warn'); return; }
  const val = getValData();
  const pendentes = val.filter(v => (v.tipo==='sem-site' || v.tipo==='com-site' || !v.tipo) && v.numStatus==='pendente');
  if (!pendentes.length) { notify('// nenhum número pendente','warn'); return; }

  document.getElementById('valSpinner').style.display = 'block';
  let validados = 0, invalidos = 0;

  for (let i = 0; i < pendentes.length; i += 10) {
    const lote = pendentes.slice(i, i + 10);
    const numbers = lote.map(v => {
      const ph = normalizePhone(v.whatsapp || '');
      return ph.startsWith('55') ? ph : '55' + ph;
    }).filter(n => n.length >= 12);
    if (!numbers.length) continue;
    try {
      const res = await fetch(`${chip.url}/chat/whatsappNumbers/${chip.instance}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': chip.key },
        body: JSON.stringify({ numbers })
      });
      const data = await res.json();
      const results = Array.isArray(data) ? data : [];
      lote.forEach(v => {
        const ph = normalizePhone(v.whatsapp || '');
        const numero = ph.startsWith('55') ? ph : '55' + ph;
        const found = results.find(r => r.jid && r.jid.includes(numero));
        v.numStatus = found?.exists ? 'valido' : 'invalido';
        if (v.numStatus === 'valido') validados++; else invalidos++;
      });
    } catch(e) { console.error(e); }
    await new Promise(r => setTimeout(r, 800));
  }

  const updated = getValData().map(v => {
    const p = pendentes.find(p => p.id === v.id);
    return p || v;
  });
  saveValData(updated);
  document.getElementById('valSpinner').style.display = 'none';
  renderValidacao(); updateBadges();
  notify(`✓ ${validados} válidos · ${invalidos} sem WhatsApp`);
}

function aprovarSemSiteParaZap(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  if (v.numStatus !== 'valido') { notify('// valide o número primeiro','warn'); return; }
  const phone = normalizePhone(v.whatsapp || '');
  if (!phone || phone.length < 10) { notify('// número inválido para WhatsApp','err'); return; }
  markLeadWhatsappValidatedForQueue(v);

  const data = ensureWeekData();
  const day = v.diaDestino || todayStr();
  if (!data.days[day]) data.days[day] = [];

  const diasSemana = currentWeekDays();
  let diaDestino = day;
  let idx = diasSemana.indexOf(day);
  while ((data.days[diaDestino]||[]).length >= getDailyLimit()) {
    idx++;
    if (idx >= diasSemana.length) { notify('// semana cheia','warn'); return; }
    diaDestino = diasSemana[idx];
    if (!data.days[diaDestino]) data.days[diaDestino] = [];
  }

  data.days[diaDestino].push({
    id: v.id, nome: v.nome, site: '', whatsapp: v.whatsapp,
    instagram: v.instagram, googleUrl: v.googleUrl,
    numStatus: 'valido', whatsappValidationStatus: 'valid',
    status: 'Não enviada', criadoEm: todayStr(), semSite: true,
  });
  saveWeekData(data);
  saveValData(getValData().filter(x => x.id !== id));
  renderValidacao(); updateBadges();
  notify(`✓ ${v.nome} → Fila WhatsApp (${dayLabel(diaDestino)})`);
}

function removerDaValidacao(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (v && v.site) addExcludedDomains([v.site]);
  saveValData(val.filter(x => x.id !== id));
  renderValidacao(); updateBadges();
  if (v && v.site) notify('\u2715 removido · ' + (extractDomain(v.site)||v.site) + ' → sites já vistos');
}

/* Passa lead para o dia seguinte (antes de entrar na fila) */
function passarProximoDia(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;
  const proxDia = nextWeekday(v.diaDestino || todayStr());
  v.diaDestino = proxDia;
  saveValData(val);
  renderValidacao();
  notify(`→ ${v.nome} movido para ${dayLabel(proxDia)}`);
}

