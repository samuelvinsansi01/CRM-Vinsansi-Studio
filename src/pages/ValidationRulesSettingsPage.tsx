import { useEffect, useState } from 'react';
import { Route, Save, ShieldCheck } from 'lucide-react';
import { Button, Field, Panel, SelectField, Tag, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import {
  listChannelOptions,
  listContactSourceOptions,
  loadValidationRules,
  saveValidationRules,
  type ChannelOption,
  type ValidationRulesRecord,
} from '../repositories/configuration';

const yesNoOptions = [
  { label: 'Sim', value: 'true' },
  { label: 'Não', value: 'false' },
];
const activeOptions = [
  { label: 'Ativa', value: '1' },
  { label: 'Inativa', value: '2' },
];

type SourceOption = { id: string; name: string; key: string };

function FormSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <SelectField value={value} options={options} onChange={onChange} />
    </label>
  );
}

export function ValidationRulesSettingsPage() {
  const [rules, setRules] = useState<ValidationRulesRecord | null>(null);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadValidationRules(), listChannelOptions(), listContactSourceOptions()])
      .then(([rulesData, channelData, sourceData]) => {
        if (!active) return;
        setRules(rulesData);
        setChannels(channelData);
        setSources(sourceData);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar regras.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const patch = <K extends keyof ValidationRulesRecord,>(key: K, value: ValidationRulesRecord[K]) => {
    setRules((current) => current ? { ...current, [key]: value } : current);
  };
  const notify = (toast: Omit<ToastItem, 'id'>) => setToasts((current) => [...current, { ...toast, id: crypto.randomUUID() }]);

  const save = async () => {
    if (!rules) return;
    setSaving(true);
    try {
      await saveValidationRules(rules);
      notify({ title: 'Regras salvas', description: 'A validação e o roteamento foram atualizados.', tone: 'success' });
    } catch (cause) {
      notify({ title: 'Falha ao salvar', description: cause instanceof Error ? cause.message : 'Erro inesperado.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const channelOptions = channels.map((item) => ({ label: item.name, value: item.id }));
  const sourceOptions = sources.map((item) => ({ label: `${item.name} (${item.key})`, value: item.id }));

  return (
    <div className="settings-page validation-rules-settings-page">
      <PageHeader
        title="Regras de validação e roteamento"
        description="Configure quais leads entram na validação WhatsApp e qual destino recebem quando o número não é encontrado."
        action={<Button iconLeft={Save} size="lg" loading={saving} disabled={!rules} onClick={() => void save()}>Salvar regras</Button>}
      />

      {loading ? <Panel title="Carregando"><p className="settings-note">Carregando regras e catálogos...</p></Panel> : null}
      {error ? <Panel title="Não foi possível carregar"><p className="configuration-state configuration-state--error">{error}</p></Panel> : null}

      {rules ? (
        <>
          <Panel title="Situação da regra" className="settings-card settings-card--readiness">
            <div className="settings-readiness__header">
              <Tag tone={rules.statusId === '1' ? 'success' : 'warning'}>{rules.statusId === '1' ? 'Regra ativa' : 'Regra inativa'}</Tag>
              <span className="settings-note">A capacidade continua sendo calculada pelo nível do chip e pela fila existente.</span>
            </div>
          </Panel>

          <section className="settings-grid settings-grid--two">
            <Panel title="Validação WhatsApp" className="settings-card">
              <FormSelect label="Fonte elegível" value={rules.sourceId} options={sourceOptions} onChange={(value) => patch('sourceId', value)} />
              <FormSelect label="Canal validado" value={rules.channelId} options={channelOptions} onChange={(value) => patch('channelId', value)} />
              <Field
                label="Tentativas máximas em erro técnico"
                type="number"
                min="1"
                max="10"
                value={rules.maxTechnicalAttempts}
                onChange={(value) => patch('maxTechnicalAttempts', value)}
              />
              <FormSelect label="Status da regra" value={rules.statusId} options={activeOptions} onChange={(value) => patch('statusId', value)} />
            </Panel>

            <Panel title="Roteamento" className="settings-card">
              <FormSelect label="Canal de fallback" value={rules.fallbackChannelId} options={channelOptions} onChange={(value) => patch('fallbackChannelId', value)} />
              <FormSelect
                label="Instagram exige aprovação manual"
                value={String(rules.instagramRequiresApproval)}
                options={yesNoOptions}
                onChange={(value) => patch('instagramRequiresApproval', value === 'true')}
              />
              <div className="configuration-info-callout configuration-info-callout--stacked">
                <Route size={18} strokeWidth={1.8} />
                <span>WhatsApp não encontrado: o lead permanece importado e recebe o canal de fallback. Nenhuma fila é criada para esse resultado.</span>
              </div>
              <div className="configuration-info-callout configuration-info-callout--stacked">
                <ShieldCheck size={18} strokeWidth={1.8} />
                <span>Erro técnico: status e canal do lead permanecem inalterados. A invalidação continua sendo manual.</span>
              </div>
            </Panel>
          </section>
        </>
      ) : null}

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
