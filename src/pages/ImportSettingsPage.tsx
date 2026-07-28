import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Button, Field, Panel, SelectField, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useImportSettings } from '../hooks/useImportSettings';
import { useApifyAccounts } from '../hooks/useApifyAccounts';
import type { ImportSettings } from '../services/import-settings';
import { useState } from 'react';

type BooleanPath =
  | 'safeMode.simulationMode'
  | 'instagramLowRating.enabled'
  | 'deduplication.enabled'
  | 'deduplication.byPhone'
  | 'deduplication.bySite'
  | 'deduplication.blockBasePermanent'
  | 'deduplication.allowSmartReimport'
  | 'deduplication.incrementalImport'
  | 'routes.whatsapp'
  | 'routes.instagram'
  | 'routes.ownSite'
  | 'routes.aggregators'
  | 'routes.blockFacebookAsSite'
  | 'routes.requireConfiguredCategory'
  | 'routes.rejectOutOfProfile'
  | 'logs.enabled'
  | 'logs.logRejected'
  | 'logs.logRejectionReason';

const booleanOptions = [
  { label: 'Ligado', value: 'true' },
  { label: 'Desligado', value: 'false' },
];

function getBoolean(settings: ImportSettings, path: BooleanPath) {
  const [group, key] = path.split('.') as [keyof ImportSettings, string];
  const section = settings[group] as Record<string, unknown>;
  return Boolean(section[key]);
}

function BooleanSetting({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="settings-toggle-row">
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <SelectField value={String(value)} options={booleanOptions} onChange={(nextValue) => onChange(nextValue === 'true')} />
    </div>
  );
}


function ApifyAccountsPanel({ pushToast }: { pushToast: (toast: Omit<ToastItem, 'id'>) => void }) {
  const { accounts, loading, saving, checkingId, error, save, check, remove } = useApifyAccounts();
  const [editingId, setEditingId] = useState<number | undefined>();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [active, setActive] = useState(true);

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
        pushToast({ title: wasEditing ? 'Conta atualizada e verificada' : 'Conta adicionada e verificada', description: result.username ? `Conectada como ${result.username}.` : 'Token validado com sucesso na Apify.', tone: 'success' });
      } catch (checkError) {
        pushToast({ title: 'Conta salva, mas não conectada', description: checkError instanceof Error ? checkError.message : 'Teste o token novamente.', tone: 'warning' });
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
    <Panel title="Contas Apify" className="settings-card import-settings-card import-apify-accounts">
      <p className="settings-note">A conta usada no Google Maps Extractor será sempre escolhida manualmente. O sistema nunca troca de conta sozinho.</p>
      <div className="import-apify-form">
        <Field label="Nome da conta" placeholder="Ex.: Apify pessoal 1" value={name} onChange={setName} />
        <Field label={editingId ? 'Novo token (opcional)' : 'Token Apify'} placeholder={editingId ? 'Deixe vazio para manter o token atual' : 'apify_api_...'} value={token} onChange={setToken} />
        <label className="drawer-field">
          <span>Status</span>
          <SelectField value={String(active)} options={[{ label: 'Ativa', value: 'true' }, { label: 'Desativada', value: 'false' }]} onChange={(value) => setActive(value === 'true')} />
        </label>
        <div className="import-apify-form__actions">
          {editingId ? <Button variant="secondary" onClick={resetForm}>Cancelar</Button> : null}
          <Button iconLeft={editingId ? Save : Plus} loading={saving} disabled={!name.trim()} onClick={submit}>{editingId ? 'Salvar conta' : 'Adicionar conta'}</Button>
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
  );
}

export function ImportSettingsPage() {
  const { settings, loading, saving, error, updateSettings, resetSettings } = useImportSettings();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const updateNumber = async (key: 'minRating' | 'minReviews', value: string) => {
    const nextValue = key === 'minRating' ? Number(value.replace(',', '.')) : Number.parseInt(value, 10);
    if (!Number.isFinite(nextValue)) return;
    await updateSettings({ [key]: nextValue });
  };

  const updateBoolean = async (path: BooleanPath, value: boolean) => {
    const [group, key] = path.split('.') as ['safeMode' | 'instagramLowRating' | 'deduplication' | 'routes' | 'logs', string];
    await updateSettings({ [group]: { [key]: value } });
  };

  const updateInstagramLowRatingNumber = async (key: 'minRating' | 'minReviews', value: string) => {
    const parsed = key === 'minReviews' ? Number.parseInt(value, 10) : Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    await updateSettings({ instagramLowRating: { [key]: parsed } });
  };

  const updateBranchRule = async (id: string, key: 'minRating' | 'minReviews' | 'enabled', value: string | boolean) => {
    if (!settings) return;
    const nextRules = settings.branchRules.map((rule) => {
      if (rule.id !== id) return rule;
      if (key === 'enabled') return { ...rule, enabled: Boolean(value) };
      const parsed = key === 'minRating' ? Number(String(value).replace(',', '.')) : Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? { ...rule, [key]: parsed } : rule;
    });
    await updateSettings({ branchRules: nextRules });
  };

  const reset = async () => {
    await resetSettings();
    pushToast({ title: 'Configurações restauradas', description: 'Os critérios de importação voltaram para o padrão recomendado.', tone: 'success' });
  };

  const save = () => {
    pushToast({ title: 'Configurações salvas', description: 'As próximas importações já usarão estas regras.', tone: 'success' });
  };

  if (loading || !settings) {
    return (
      <div className="settings-page import-settings-page">
        <PageHeader title="Importação" />
        <div className="table-message">Carregando configurações de importação...</div>
      </div>
    );
  }

  return (
    <div className="settings-page import-settings-page">
      <PageHeader
        title="Importação"
        action={
          <div className="import-settings-actions">
            <Button variant="secondary" iconLeft={RotateCcw} onClick={reset} disabled={saving}>Restaurar padrão</Button>
            <Button iconLeft={Save} loading={saving} onClick={save}>Salvar</Button>
          </div>
        }
      />

      {error ? <div className="table-message">{error}</div> : null}

      <section className="settings-grid import-settings-grid">
        <ApifyAccountsPanel pushToast={pushToast} />
        <Panel title="Critérios mínimos" className="settings-card import-settings-card">
          <Field label="Nota mínima global" value={String(settings.minRating)} onChange={(value) => updateNumber('minRating', value)} />
          <Field label="Reviews mínimos global" value={String(settings.minReviews)} onChange={(value) => updateNumber('minReviews', value)} />
          <BooleanSetting label="Modo simulação" description="Executa validações e relatório sem gravar no banco. Recomendado para testar regras." value={getBoolean(settings, 'safeMode.simulationMode')} onChange={(value) => updateBoolean('safeMode.simulationMode', value)} />
          <p className="settings-note">Leads abaixo desses critérios entram em Recusados com motivo automático. Regras por ramo têm prioridade sobre o global.</p>
        </Panel>

        <Panel title="Exceção de qualificação para Instagram" className="settings-card import-settings-card">
          <BooleanSetting
            label="Ativar exceção"
            description="Direciona ao Instagram os leads que não atingem nota ou avaliações do fluxo normal, mas atingem os mínimos desta exceção."
            value={getBoolean(settings, 'instagramLowRating.enabled')}
            onChange={(value) => updateBoolean('instagramLowRating.enabled', value)}
          />
          <Field label="Nota mínima da exceção" value={String(settings.instagramLowRating.minRating)} onChange={(value) => updateInstagramLowRatingNumber('minRating', value)} />
          <Field label="Mínimo de avaliações" value={String(settings.instagramLowRating.minReviews)} onChange={(value) => updateInstagramLowRatingNumber('minReviews', value)} />
          <p className="settings-note">Fluxo normal: atende aos mínimos gerais ou do ramo. Exceção Instagram: nota mínima 3,7 e pelo menos 5 avaliações, quando não atingir o fluxo normal. As regras de ramo, duplicidade e Base Permanente continuam obrigatórias.</p>
        </Panel>

        <Panel title="Regras por ramo" className="settings-card import-settings-card import-branch-rules">
          {!settings.branchRules.length ? <div className="table-message">Nenhum ramo configurado. Cadastre ramos para liberar regras por categoria e subcategoria.</div> : null}
          {settings.branchRules.map((rule) => (
            <div className="import-branch-rule" key={rule.id}>
              <div>
                <strong>{rule.branch}</strong>
                <span>{rule.subcategories.join(', ')}</span>
              </div>
              <Field label="Nota mínima" value={String(rule.minRating)} onChange={(value) => updateBranchRule(rule.id, 'minRating', value)} />
              <Field label="Reviews mínimos" value={String(rule.minReviews)} onChange={(value) => updateBranchRule(rule.id, 'minReviews', value)} />
              <BooleanSetting label="Ramo ativo" description="Permite leads do ramo e subcategorias vinculadas." value={rule.enabled} onChange={(value) => updateBranchRule(rule.id, 'enabled', value)} />
            </div>
          ))}
        </Panel>

        <Panel title="Deduplicação" className="settings-card import-settings-card">
          <BooleanSetting label="Deduplicação geral" description="Evita entrada de leads repetidos no mesmo lote e na base." value={getBoolean(settings, 'deduplication.enabled')} onChange={(value) => updateBoolean('deduplication.enabled', value)} />
          <BooleanSetting label="Deduplicar por telefone" description="Compara telefone normalizado/WhatsApp." value={getBoolean(settings, 'deduplication.byPhone')} onChange={(value) => updateBoolean('deduplication.byPhone', value)} />
          <BooleanSetting label="Deduplicar por site" description="Compara domínio/site informado no JSON." value={getBoolean(settings, 'deduplication.bySite')} onChange={(value) => updateBoolean('deduplication.bySite', value)} />
          <BooleanSetting label="Bloquear Base Permanente" description="Impede reimportar qualquer contato já finalizado na tabela leads." value={getBoolean(settings, 'deduplication.blockBasePermanent')} onChange={(value) => updateBoolean('deduplication.blockBasePermanent', value)} />
          <BooleanSetting label="Reimportação inteligente" description="Permite reaproveitar lead existente quando houver melhoria de dados." value={getBoolean(settings, 'deduplication.allowSmartReimport')} onChange={(value) => updateBoolean('deduplication.allowSmartReimport', value)} />
          <BooleanSetting label="Importação incremental" description="Importa apenas novos itens e registra duplicados como ignorados/recusados." value={getBoolean(settings, 'deduplication.incrementalImport')} onChange={(value) => updateBoolean('deduplication.incrementalImport', value)} />
        </Panel>

        <Panel title="Classificação automática" className="settings-card import-settings-card">
          <BooleanSetting label="WhatsApp" description="Enviar leads com telefone válido para validação WhatsApp." value={getBoolean(settings, 'routes.whatsapp')} onChange={(value) => updateBoolean('routes.whatsapp', value)} />
          <BooleanSetting label="Instagram" description="Enviar leads sem WhatsApp e com Instagram para fluxo Instagram." value={getBoolean(settings, 'routes.instagram')} onChange={(value) => updateBoolean('routes.instagram', value)} />
          <BooleanSetting label="Site próprio" description="Separar leads com site próprio para aprovação manual." value={getBoolean(settings, 'routes.ownSite')} onChange={(value) => updateBoolean('routes.ownSite', value)} />
          <BooleanSetting label="Agregadores" description="Identificar linktr.ee, beacons, carrd, taplink, msha.ke e bio.site." value={getBoolean(settings, 'routes.aggregators')} onChange={(value) => updateBoolean('routes.aggregators', value)} />
          <BooleanSetting label="Bloquear Facebook como site" description="Facebook não será tratado como site próprio." value={getBoolean(settings, 'routes.blockFacebookAsSite')} onChange={(value) => updateBoolean('routes.blockFacebookAsSite', value)} />
        </Panel>

        <Panel title="Categorias e logs" className="settings-card import-settings-card">
          <BooleanSetting label="Exigir categoria/subcategoria" description="Leads sem ramo/subramo identificável entram em Recusados." value={getBoolean(settings, 'routes.requireConfiguredCategory')} onChange={(value) => updateBoolean('routes.requireConfiguredCategory', value)} />
          <BooleanSetting label="Invalidar fora do perfil" description="Marca fora do perfil quando a categoria não atende os critérios." value={getBoolean(settings, 'routes.rejectOutOfProfile')} onChange={(value) => updateBoolean('routes.rejectOutOfProfile', value)} />
          <BooleanSetting label="Registrar logs" description="Mantém resumo das importações e motivos de recusa." value={getBoolean(settings, 'logs.enabled')} onChange={(value) => updateBoolean('logs.enabled', value)} />
          <BooleanSetting label="Registrar recusados" description="Salva recusados para auditoria posterior." value={getBoolean(settings, 'logs.logRejected')} onChange={(value) => updateBoolean('logs.logRejected', value)} />
          <BooleanSetting label="Registrar motivo" description="Armazena o motivo calculado para cada recusa." value={getBoolean(settings, 'logs.logRejectionReason')} onChange={(value) => updateBoolean('logs.logRejectionReason', value)} />
        </Panel>
      </section>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
