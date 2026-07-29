import { useEffect, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { Button, Field, Panel, SelectField, Tag, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { loadImportRules, saveImportRules, type ImportRulesRecord } from '../repositories/configuration';

const activeOptions = [
  { label: 'Ativa', value: '1' },
  { label: 'Inativa', value: '2' },
];
const yesNoOptions = [
  { label: 'Sim', value: 'true' },
  { label: 'Não', value: 'false' },
];

function FormSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <SelectField value={value} options={options} onChange={onChange} />
    </label>
  );
}

function BooleanRule({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="settings-toggle-row">
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <SelectField value={String(value)} options={yesNoOptions} onChange={(next) => onChange(next === 'true')} />
    </div>
  );
}

export function ImportRulesPage() {
  const [rules, setRules] = useState<ImportRulesRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    let active = true;
    void loadImportRules().then((data) => {
      if (active) setRules(data);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar critérios.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const patch = <K extends keyof ImportRulesRecord,>(key: K, value: ImportRulesRecord[K]) => {
    setRules((current) => current ? { ...current, [key]: value } : current);
  };

  const notify = (toast: Omit<ToastItem, 'id'>) => setToasts((current) => [...current, { ...toast, id: crypto.randomUUID() }]);

  const save = async () => {
    if (!rules) return;
    setSaving(true);
    try {
      await saveImportRules(rules);
      notify({ title: 'Critérios salvos', description: 'As regras globais de importação foram atualizadas.', tone: 'success' });
    } catch (cause) {
      notify({ title: 'Falha ao salvar', description: cause instanceof Error ? cause.message : 'Erro inesperado.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page import-rules-page">
      <PageHeader
        title="Critérios de importação"
        description="Defina uma única regra global aplicada a todas as importações do usuário."
        action={<Button iconLeft={Save} size="lg" loading={saving} disabled={!rules} onClick={() => void save()}>Salvar critérios</Button>}
      />

      {loading ? <Panel title="Carregando"><p className="settings-note">Carregando critérios globais...</p></Panel> : null}
      {error ? <Panel title="Não foi possível carregar"><p className="configuration-state configuration-state--error">{error}</p></Panel> : null}

      {rules ? (
        <>
          <Panel title="Situação da regra" className="settings-card settings-card--readiness">
            <div className="settings-readiness__header">
              <Tag tone={rules.statusId === '1' ? 'success' : 'warning'}>{rules.statusId === '1' ? 'Regra ativa' : 'Regra inativa'}</Tag>
              <span className="settings-note">A configuração é global e não varia por ramo.</span>
            </div>
          </Panel>

          <section className="settings-grid settings-grid--two">
            <Panel title="Qualidade mínima" className="settings-card">
              <div className="settings-card__fields-grid">
                <Field
                  label="Nota mínima"
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={rules.minRating}
                  placeholder="Sem limite"
                  onChange={(value) => patch('minRating', value)}
                />
                <Field
                  label="Quantidade mínima de avaliações"
                  type="number"
                  min="0"
                  value={rules.minReviews}
                  placeholder="Sem limite"
                  onChange={(value) => patch('minReviews', value)}
                />
              </div>
              <BooleanRule label="Exigir nome da empresa" description="Rejeita registros sem nome identificável." value={rules.requireName} onChange={(value) => patch('requireName', value)} />
              <FormSelect label="Status da regra" value={rules.statusId} options={activeOptions} onChange={(value) => patch('statusId', value)} />
            </Panel>

            <Panel title="Dados mínimos de contato" className="settings-card">
              <BooleanRule label="Exigir ao menos um contato" description="Aceita telefone, Instagram ou site como contato disponível." value={rules.requireAnyContact} onChange={(value) => patch('requireAnyContact', value)} />
              <BooleanRule label="Exigir telefone" description="O telefone passa a ser obrigatório mesmo quando houver outro contato." value={rules.requirePhone} onChange={(value) => patch('requirePhone', value)} />
              <BooleanRule label="Exigir Instagram" description="O perfil do Instagram passa a ser obrigatório." value={rules.requireInstagram} onChange={(value) => patch('requireInstagram', value)} />
              <BooleanRule label="Exigir site" description="O site passa a ser obrigatório para a importação." value={rules.requireWebsite} onChange={(value) => patch('requireWebsite', value)} />
            </Panel>
          </section>

          <Panel title="Deduplicação" className="settings-card import-rules-dedup-card">
            <div className="import-rules-dedup-grid">
              <BooleanRule label="Telefone" description="Evita inserir novamente o mesmo telefone." value={rules.deduplicatePhone} onChange={(value) => patch('deduplicatePhone', value)} />
              <BooleanRule label="Instagram" description="Evita inserir novamente o mesmo perfil." value={rules.deduplicateInstagram} onChange={(value) => patch('deduplicateInstagram', value)} />
              <BooleanRule label="Site" description="Evita inserir novamente o mesmo domínio ou endereço." value={rules.deduplicateWebsite} onChange={(value) => patch('deduplicateWebsite', value)} />
              <BooleanRule label="Google Maps" description="Evita inserir novamente o mesmo registro do Maps." value={rules.deduplicateMaps} onChange={(value) => patch('deduplicateMaps', value)} />
            </div>
            <div className="configuration-info-callout">
              <ShieldCheck size={18} strokeWidth={1.8} />
              <span>Duplicidades continuam sendo contabilizadas no trabalho de importação e não geram um novo lead.</span>
            </div>
          </Panel>
        </>
      ) : null}

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
