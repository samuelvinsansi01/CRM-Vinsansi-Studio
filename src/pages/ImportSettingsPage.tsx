import { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { Button, Field, Panel, SelectField, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { useImportSettings } from '../hooks/useImportSettings';
import { defaultImportSettings, type ImportSettings, type UpdateImportSettingsInput } from '../services/import-settings';

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

export function ImportSettingsPage() {
  const { hasPermission } = useOrganizationContext();
  const canManage = hasPermission('settings.manage');
  const { settings, loading, saving, error, updateSettings } = useImportSettings();
  const [draft, setDraft] = useState<ImportSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (settings && !dirty) setDraft(structuredClone(settings));
  }, [dirty, settings]);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const updateNumber = (key: 'minRating' | 'minReviews', value: string) => {
    if (!canManage) return;
    const nextValue = key === 'minRating' ? Number(value.replace(',', '.')) : Number.parseInt(value, 10);
    if (!Number.isFinite(nextValue)) return;
    setDraft((current) => current ? { ...current, [key]: nextValue } : current);
    setDirty(true);
  };

  const updateBoolean = (path: BooleanPath, value: boolean) => {
    if (!canManage) return;
    const [group, key] = path.split('.') as ['safeMode' | 'instagramLowRating' | 'deduplication' | 'routes' | 'logs', string];
    setDraft((current) => current ? {
      ...current,
      [group]: { ...current[group], [key]: value },
    } : current);
    setDirty(true);
  };

  const updateInstagramLowRatingNumber = (key: 'minRating' | 'minReviews', value: string) => {
    const parsed = key === 'minReviews' ? Number.parseInt(value, 10) : Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    setDraft((current) => current ? {
      ...current,
      instagramLowRating: { ...current.instagramLowRating, [key]: parsed },
    } : current);
    setDirty(true);
  };

  const updateBranchRule = (id: string, key: 'minRating' | 'minReviews' | 'enabled', value: string | boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const branchRules = current.branchRules.map((rule) => {
        if (rule.id !== id) return rule;
        if (key === 'enabled') return { ...rule, enabled: Boolean(value) };
        const parsed = key === 'minRating' ? Number(String(value).replace(',', '.')) : Number.parseInt(String(value), 10);
        return Number.isFinite(parsed) ? { ...rule, [key]: parsed } : rule;
      });
      return { ...current, branchRules };
    });
    setDirty(true);
  };

  const reset = () => {
    if (!canManage) return;
    setDraft((current) => current ? {
      ...structuredClone(defaultImportSettings),
      branchRules: current.branchRules,
    } : current);
    setDirty(true);
  };

  const save = async () => {
    if (!canManage) return;
    if (!draft || !settings || !dirty) return;
    try {
      const input: UpdateImportSettingsInput = {};
      if (draft.minRating !== settings.minRating) input.minRating = draft.minRating;
      if (draft.minReviews !== settings.minReviews) input.minReviews = draft.minReviews;
      if (JSON.stringify(draft.safeMode) !== JSON.stringify(settings.safeMode)) input.safeMode = draft.safeMode;
      if (JSON.stringify(draft.instagramLowRating) !== JSON.stringify(settings.instagramLowRating)) input.instagramLowRating = draft.instagramLowRating;
      if (JSON.stringify(draft.branchRules) !== JSON.stringify(settings.branchRules)) input.branchRules = draft.branchRules;
      if (JSON.stringify(draft.deduplication) !== JSON.stringify(settings.deduplication)) input.deduplication = draft.deduplication;
      if (JSON.stringify(draft.routes) !== JSON.stringify(settings.routes)) input.routes = draft.routes;
      if (JSON.stringify(draft.logs) !== JSON.stringify(settings.logs)) input.logs = draft.logs;

      const saved = await updateSettings(input);
      setDraft(structuredClone(saved));
      setDirty(false);
      pushToast({ title: 'Configurações salvas', description: 'As próximas importações já usarão estas regras.', tone: 'success' });
    } catch (cause) {
      pushToast({ title: 'Falha ao salvar', description: cause instanceof Error ? cause.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  if (loading || !draft) {
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
        action={(
          <div className="import-settings-actions">
            {canManage ? <>
              <Button variant="secondary" iconLeft={RotateCcw} onClick={reset} disabled={saving}>Restaurar padrão</Button>
              <Button iconLeft={Save} loading={saving} disabled={!dirty} onClick={() => void save()}>Salvar</Button>
            </> : null}
          </div>
        )}
      />

      {error ? <div className="table-message">{error}</div> : null}
      {dirty ? <div className="configuration-info-callout"><span>Existem alterações não salvas.</span></div> : null}

      <section className="settings-grid import-settings-grid">
        <Panel title="Critérios mínimos" className="settings-card import-settings-card">
          <Field label="Nota mínima global" value={String(draft.minRating)} onChange={(value) => updateNumber('minRating', value)} />
          <Field label="Reviews mínimos global" value={String(draft.minReviews)} onChange={(value) => updateNumber('minReviews', value)} />
          <BooleanSetting
            label="Modo simulação"
            description="Executa validações e relatório sem gravar leads no banco. Nenhuma fonte ativa persiste leads enquanto a simulação estiver habilitada."
            value={getBoolean(draft, 'safeMode.simulationMode')}
            onChange={(value) => updateBoolean('safeMode.simulationMode', value)}
          />
          <p className="settings-note">Leads abaixo desses critérios entram em Recusados com motivo automático. Regras por ramo têm prioridade sobre o global.</p>
        </Panel>

        <Panel title="Exceção de qualificação para Instagram" className="settings-card import-settings-card">
          <BooleanSetting
            label="Ativar exceção"
            description="Direciona ao Instagram os leads que não atingem nota ou avaliações do fluxo normal, mas atingem os mínimos desta exceção."
            value={getBoolean(draft, 'instagramLowRating.enabled')}
            onChange={(value) => updateBoolean('instagramLowRating.enabled', value)}
          />
          <Field label="Nota mínima da exceção" value={String(draft.instagramLowRating.minRating)} onChange={(value) => updateInstagramLowRatingNumber('minRating', value)} />
          <Field label="Mínimo de avaliações" value={String(draft.instagramLowRating.minReviews)} onChange={(value) => updateInstagramLowRatingNumber('minReviews', value)} />
          <p className="settings-note">Fluxo normal: atende aos mínimos gerais ou do ramo. A exceção do Instagram preserva as regras atuais de ramo, duplicidade e Base Permanente.</p>
        </Panel>

        <Panel title="Regras por ramo" className="settings-card import-settings-card import-branch-rules">
          {!draft.branchRules.length ? <div className="table-message">Nenhum ramo configurado. Cadastre ramos para liberar regras por categoria e subcategoria.</div> : null}
          {draft.branchRules.map((rule) => (
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
          <BooleanSetting label="Deduplicação geral" description="Evita entrada de leads repetidos no mesmo lote e na base." value={getBoolean(draft, 'deduplication.enabled')} onChange={(value) => updateBoolean('deduplication.enabled', value)} />
          <BooleanSetting label="Deduplicar por telefone" description="Compara telefone normalizado/WhatsApp." value={getBoolean(draft, 'deduplication.byPhone')} onChange={(value) => updateBoolean('deduplication.byPhone', value)} />
          <BooleanSetting label="Deduplicar por site" description="Compara domínio/site informado no JSON." value={getBoolean(draft, 'deduplication.bySite')} onChange={(value) => updateBoolean('deduplication.bySite', value)} />
          <BooleanSetting label="Bloquear Base Permanente" description="Impede reimportar identidades presentes na Base Permanente ou na lista de supressão." value={getBoolean(draft, 'deduplication.blockBasePermanent')} onChange={(value) => updateBoolean('deduplication.blockBasePermanent', value)} />
          <BooleanSetting label="Reimportação inteligente" description="Permite reaproveitar lead existente quando houver melhoria de dados." value={getBoolean(draft, 'deduplication.allowSmartReimport')} onChange={(value) => updateBoolean('deduplication.allowSmartReimport', value)} />
          <BooleanSetting label="Importação incremental" description="Importa apenas novos itens e registra duplicados como ignorados/recusados." value={getBoolean(draft, 'deduplication.incrementalImport')} onChange={(value) => updateBoolean('deduplication.incrementalImport', value)} />
        </Panel>

        <Panel title="Classificação automática" className="settings-card import-settings-card">
          <BooleanSetting label="WhatsApp" description="Enviar leads com telefone válido para validação WhatsApp." value={getBoolean(draft, 'routes.whatsapp')} onChange={(value) => updateBoolean('routes.whatsapp', value)} />
          <BooleanSetting label="Instagram" description="Enviar leads sem WhatsApp e com Instagram para fluxo Instagram." value={getBoolean(draft, 'routes.instagram')} onChange={(value) => updateBoolean('routes.instagram', value)} />
          <BooleanSetting label="Site próprio" description="Separar leads com site próprio para aprovação manual." value={getBoolean(draft, 'routes.ownSite')} onChange={(value) => updateBoolean('routes.ownSite', value)} />
          <BooleanSetting label="Agregadores" description="Identificar linktr.ee, beacons, carrd, taplink, msha.ke e bio.site." value={getBoolean(draft, 'routes.aggregators')} onChange={(value) => updateBoolean('routes.aggregators', value)} />
          <BooleanSetting label="Bloquear Facebook como site" description="Facebook não será tratado como site próprio." value={getBoolean(draft, 'routes.blockFacebookAsSite')} onChange={(value) => updateBoolean('routes.blockFacebookAsSite', value)} />
        </Panel>

        <Panel title="Categorias e logs" className="settings-card import-settings-card">
          <BooleanSetting label="Exigir categoria/subcategoria" description="Leads sem ramo/subramo identificável entram em Recusados." value={getBoolean(draft, 'routes.requireConfiguredCategory')} onChange={(value) => updateBoolean('routes.requireConfiguredCategory', value)} />
          <BooleanSetting label="Invalidar fora do perfil" description="Marca fora do perfil quando a categoria não atende os critérios." value={getBoolean(draft, 'routes.rejectOutOfProfile')} onChange={(value) => updateBoolean('routes.rejectOutOfProfile', value)} />
          <BooleanSetting label="Registrar logs" description="Mantém resumo das importações e motivos de recusa." value={getBoolean(draft, 'logs.enabled')} onChange={(value) => updateBoolean('logs.enabled', value)} />
          <BooleanSetting label="Registrar recusados" description="Salva recusados para auditoria posterior." value={getBoolean(draft, 'logs.logRejected')} onChange={(value) => updateBoolean('logs.logRejected', value)} />
          <BooleanSetting label="Registrar motivo" description="Armazena o motivo calculado para cada recusa." value={getBoolean(draft, 'logs.logRejectionReason')} onChange={(value) => updateBoolean('logs.logRejectionReason', value)} />
        </Panel>
      </section>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
