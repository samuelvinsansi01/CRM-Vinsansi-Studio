/* ════════════════════════════
   REDIRECIONAMENTOS
════════════════════════════ */
const API_BASE = '';

async function criarRedirecionamento() {
  const nome   = document.getElementById('rdNomeEmpresa').value.trim();
  const desk   = document.getElementById('rdDeskUrl').value.trim();
  const mob    = document.getElementById('rdMobUrl').value.trim();
  if (!nome || !desk || !mob) { notify('// preencha todos os campos','err'); return; }

  const spinner = document.getElementById('rdSpinner');
  spinner.style.display = 'block';
  try {
    const res = await fetch(`${API_BASE}/api/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: nome, deskUrl: desk, mobUrl: mob })
    });
    const data = await res.json();
    if (!res.ok) { notify(data.error || '// erro ao criar link','err'); return; }
    const result = document.getElementById('rdResultado');
    const link   = document.getElementById('rdLinkGerado');
    result.style.display = 'block';
    link.href = data.shortUrl; link.textContent = data.shortUrl;
    notify('✓ Link criado!');
  } catch(e) {
    notify('// erro de conexão','err');
  } finally {
    spinner.style.display = 'none';
  }
}

function copiarLinkRd() {
  const link = document.getElementById('rdLinkGerado').textContent;
  navigator.clipboard.writeText(link).then(() => notify('✓ Link copiado'));
}

async function atualizarRedirecionamento() {
  const alias = document.getElementById('rdAliasUpdate').value.trim();
  const desk  = document.getElementById('rdDeskUrlUpdate').value.trim();
  const mob   = document.getElementById('rdMobUrlUpdate').value.trim();
  if (!alias) { notify('// informe o alias','err'); return; }
  if (!desk && !mob) { notify('// informe ao menos um link','err'); return; }
  try {
    const res = await fetch(`${API_BASE}/api/update`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias, deskUrl: desk||undefined, mobUrl: mob||undefined })
    });
    const data = await res.json();
    if (!res.ok) { notify(data.error || '// erro','err'); return; }
    notify('✓ Link atualizado!');
  } catch(e) { notify('// erro de conexão','err'); }
}

