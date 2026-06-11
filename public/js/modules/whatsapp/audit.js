/* ════════════════════════════
   AUDITORIA V35
════════════════════════════ */
function getAuditQueueItemsV35() {
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  return queue.map(item => ({
    id: item.id,
    leadId: item.leadId,
    nome: item.nome || 'Lead',
    telefone: item.telefone || '',
    campaign: item.campaign || '',
    templateName: item.templateName || '',
    chipName: item.chipName || '',
    status: item.status || 'Pendente',
    error: item.error || '',
    createdAt: item.createdAtLabel || item.createdAt || '',
    sentAt: item.sentAtLabel || item.sentAt || '',
    block: item.sentBlock || ''
  }));
}

function getAuditStatsV35() {
  const items = getAuditQueueItemsV35();
  return {
    total: items.length,
    enviados: items.filter(i => i.status === 'Enviado').length,
    erros: items.filter(i => i.status === 'Erro').length,
    prontos: items.filter(i => i.status === 'Pronto').length
  };
}

function renderAuditCardsV35() {
  const box = document.getElementById('auditCardsV35');
  if (!box) return;

  const s = getAuditStatsV35();

  box.innerHTML = `
    <div class="audit-v35-card"><div class="audit-v35-label">Total na fila</div><div class="audit-v35-value">${s.total}</div></div>
    <div class="audit-v35-card"><div class="audit-v35-label">Enviados</div><div class="audit-v35-value">${s.enviados}</div></div>
    <div class="audit-v35-card"><div class="audit-v35-label">Erros</div><div class="audit-v35-value">${s.erros}</div></div>
    <div class="audit-v35-card"><div class="audit-v35-label">Prontos</div><div class="audit-v35-value">${s.prontos}</div></div>
  `;
}

function renderAuditListV35() {
  const box = document.getElementById('auditListV35');
  if (!box) return;

  const filter = document.getElementById('auditFilterV35')?.value || 'todos';
  let items = getAuditQueueItemsV35();

  if (filter !== 'todos') {
    items = items.filter(item => item.status === filter);
  }

  if (!items.length) {
    box.innerHTML = '<div class="audit-v35-empty">// nenhum registro encontrado</div>';
    return;
  }

  box.innerHTML = items.map(item => {
    const cls = normalizeStr(item.status || '').replace(/[^a-z0-9]+/g,'');
    return `
      <div class="audit-v35-row">
        <div>
          <div class="audit-v35-title">${escHtml(item.nome)}</div>
          <div class="audit-v35-meta">${escHtml(item.telefone)} · ${escHtml(item.createdAt || '')}</div>
        </div>
        <div class="audit-v35-meta">Campanha<br>${escHtml(item.campaign || '-')}</div>
        <div class="audit-v35-meta">Template<br>${escHtml(item.templateName || '-')}</div>
        <div class="audit-v35-meta">Chip<br>${escHtml(item.chipName || '-')}</div>
        <div>
          <span class="audit-v35-status ${cls}">${escHtml(item.status)}</span>
          ${item.error ? `<div class="audit-v35-meta">${escHtml(item.error)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderAuditV35() {
  renderAuditCardsV35();
  renderAuditListV35();
}

function exportAuditCsvV35() {
  const items = getAuditQueueItemsV35();
  const header = ['Nome','Telefone','Campanha','Template','Chip','Status','Erro','Criado','Enviado','Bloco'];
  const rows = items.map(i => [
    i.nome, i.telefone, i.campaign, i.templateName, i.chipName, i.status, i.error, i.createdAt, i.sentAt, i.block
  ]);

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell || '').replace(/"/g,'""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `auditoria-disparos-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function updateAuditBadgeV35() {
  const badge = document.getElementById('badge-audit');
  if (!badge) return;
  const s = getAuditStatsV35();
  badge.textContent = s.erros ? `${s.erros}!` : 'LOG';
}


