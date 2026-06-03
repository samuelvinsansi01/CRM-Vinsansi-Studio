/* ════════════════════════════
   HISTÓRICO
════════════════════════════ */
function renderHistory() {
  const hist = getHistoryData();
  const section = document.getElementById('historySection');
  if (!hist) { section.style.display = 'none'; return; }
  const flat = Object.keys(hist.days).sort().flatMap(d => (hist.days[d]||[]).map(e => ({ date: d, ...e })));
  if (!flat.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  document.getElementById('historyBadge').textContent = `${flat.length} empresa${flat.length!==1?'s':''}`;
  document.getElementById('historyToggleBtn').textContent = historyOpen ? 'Ocultar' : 'Mostrar';
  document.getElementById('historyContent').classList.toggle('open', historyOpen);
  if (!historyOpen) return;
  document.getElementById('historyTbody').innerHTML = flat.map(e => `<tr>
    <td style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(e.date)}</td>
    <td class="td-name">${escHtml(e.nome)}</td>
    <td class="td-link">${e.site?`<a href="${escHtml(e.site)}" target="_blank">${escHtml(e.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a>`:'<span class="td-missing">—</span>'}</td>
    <td style="font-family:'DM Mono',monospace;font-size:9px">${e.whatsapp||'—'}</td>
    <td style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(e.status||'Não enviada')}</td>
  </tr>`).join('');
}
function toggleHistory() { historyOpen = !historyOpen; renderHistory(); }
function archiveHistory() {
  if (!confirm('Arquivar semana anterior?')) return;
  localStorage.removeItem(HISTORY_KEY); renderHistory(); notify('Semana arquivada');
}

/* ════════════════════════════
   EXCLUDED DOMAINS
════════════════════════════ */
function renderExcluidos() {
  const domains = getExcludedDomains();
  const countEl = document.getElementById('excludedCount');
  const listEl  = document.getElementById('excludedList');
  if (!countEl || !listEl) return;
  countEl.textContent = `(${domains.length} domínio${domains.length!==1?'s':''})`;
  if (!domains.length) { listEl.innerHTML = '<span style="color:var(--muted)">// nenhum domínio excluído ainda</span>'; return; }
  listEl.innerHTML = domains.map(d =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
      <span>${escHtml(d)}</span>
      <button onclick="removerExcluido('${escHtml(d)}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:2px 5px;border-radius:4px" onmouseover="this.style.color='var(--error)'" onmouseout="this.style.color='var(--muted)'">✕</button>
    </div>`
  ).join('');
}
function removerExcluido(domain) {
  saveExcludedDomains(getExcludedDomains().filter(d => d !== domain));
  renderExcluidos(); notify(`✓ ${domain} removido`);
}
/* limparExcluidos: delegated to abrirModalLimparExcluidos() */

