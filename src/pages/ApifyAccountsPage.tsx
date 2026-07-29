import { Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Panel, SelectField, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useApifyAccounts } from '../hooks/useApifyAccounts';

export function ApifyAccountsPage() {
  const { accounts, loading, saving, checkingId, error, save, check, remove } = useApifyAccounts();
  const [editingId, setEditingId] = useState<number | undefined>();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [active, setActive] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3600);
  };

  const resetForm = () => {
    setEditingId(undefined);
    setName('');
    setToken('');
    setActive(true);
  };

  const edit = (account: (typeof accounts)[number]) => {
    setEditingId(account.id);
    setName(account.name);
    setToken('');
    setActive(account.active);
  };

  const submit = async () => {
    if (!name.trim()) return;
    if (!editingId && !token.trim()) {
      pushToast({ title: 'Token obrigatório', description: 'Informe o token da conta Apify.', tone: 'warning' });
      return;
    }

    try {
      const wasEditing = Boolean(editingId);
      const savedId = await save({ id: editingId, name, token: token || undefined, active });
      resetForm();
      if (!active) {
        pushToast({ title: wasEditing ? 'Conta atualizada' : 'Conta adicionada', description: 'A conta foi salva desativada.', tone: 'success' });
        return;
      }
      try {
        const result = await check(savedId);
        pushToast({
          title: wasEditing ? 'Conta atualizada e verificada' : 'Conta adicionada e verificada',
          description: result.username ? `Conectada como ${result.username}.` : 'Token validado com sucesso na Apify.',
          tone: 'success',
        });
      } catch (checkError) {
        pushToast({
          title: 'Conta salva, mas não conectada',
          description: checkError instanceof Error ? checkError.message : 'Teste o token novamente.',
          tone: 'warning',
        });
      }
    } catch (err) {
      pushToast({ title: 'Não foi possível salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const deleteAccount = async (id: number) => {
    try {
      await remove(id);
      if (editingId === id) resetForm();
      pushToast({ title: 'Conta removida', description: 'A conexão Apify foi removida.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível remover', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const checkAccount = async (id: number) => {
    try {
      const result = await check(id);
      pushToast({ title: 'Conta conectada', description: result.username ? `Token válido para ${result.username}.` : 'Token validado com sucesso na Apify.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Falha na conexão Apify', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  return (
    <div className="settings-page import-settings-page apify-accounts-page">
      <PageHeader
        title="Contas Apify"
        description="Cadastre, teste e gerencie as contas usadas nas importações do Google Maps."
      />

      <Panel title="Contas Apify" className="settings-card import-settings-card import-apify-accounts">
        <p className="settings-note">A conta usada no Google Maps Extractor será escolhida manualmente. O sistema não alterna contas sozinho.</p>
        <div className="import-apify-form">
          <Field label="Nome da conta" placeholder="Ex.: Apify principal" value={name} onChange={setName} />
          <Field label={editingId ? 'Novo token (opcional)' : 'Token Apify'} placeholder={editingId ? 'Deixe vazio para manter o token atual' : 'apify_api_...'} value={token} onChange={setToken} />
          <label className="drawer-field">
            <span>Status</span>
            <SelectField value={String(active)} options={[{ label: 'Ativa', value: 'true' }, { label: 'Desativada', value: 'false' }]} onChange={(value) => setActive(value === 'true')} />
          </label>
          <div className="import-apify-form__actions">
            {editingId ? <Button variant="secondary" onClick={resetForm}>Cancelar</Button> : null}
            <Button iconLeft={editingId ? Save : Plus} loading={saving} disabled={!name.trim()} onClick={() => void submit()}>
              {editingId ? 'Salvar conta' : 'Adicionar conta'}
            </Button>
          </div>
        </div>

        {error ? <div className="table-message">{error}</div> : null}
        {loading ? <div className="table-message">Carregando contas...</div> : null}
        {!loading && !accounts.length ? <div className="table-message">Nenhuma conta Apify cadastrada.</div> : null}
        {!loading && accounts.length ? (
          <div className="import-apify-list">
            {accounts.map((account) => (
              <div className="import-apify-account" key={account.id}>
                <div>
                  <strong>{account.name}</strong>
                  <span>{account.tokenMask || 'Token protegido'} · {account.active ? 'Ativa' : 'Desativada'} · {account.connectionStatus === 'connected' ? 'Conectada' : account.connectionStatus === 'error' ? 'Com erro' : 'Não verificada'}{account.externalUsername ? ` · ${account.externalUsername}` : ''}</span>
                  {account.lastError ? <small className="settings-note">{account.lastError}</small> : null}
                </div>
                <div className="import-apify-account__actions">
                  <Button size="sm" variant="secondary" loading={checkingId === account.id} onClick={() => void checkAccount(account.id)}>Testar</Button>
                  <Button size="sm" variant="secondary" onClick={() => edit(account)}>Editar</Button>
                  <Button size="sm" variant="danger" iconLeft={Trash2} onClick={() => void deleteAccount(account.id)}>Remover</Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
