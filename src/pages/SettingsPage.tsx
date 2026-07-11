import { RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Field, Panel, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useDispatchSettings } from '../hooks/useDispatchSettings';
import type { DispatchSettings } from '../services/settings';

function cloneSettings(settings: DispatchSettings): DispatchSettings {
  return {
    whatsapp: {
      ...settings.whatsapp,
      activeDays: [...settings.whatsapp.activeDays],
    },
    instagram: {
      ...settings.instagram,
      activeDays: [...settings.instagram.activeDays],
      profiles: [...settings.instagram.profiles],
    },
  };
}

function toNumber(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function toPositiveNumber(value: string, fallback: number) {
  return Math.max(1, toNumber(value, fallback));
}

function toList(value: string, fallback: string[]) {
  const list = value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

function formatList(value: string[]) {
  return value.join(', ');
}

type ChannelKey = 'whatsapp' | 'instagram';

type ChannelFieldsProps = {
  kind: ChannelKey;
  settings: DispatchSettings;
  saving: boolean;
  onDraftChange: (kind: ChannelKey, input: Record<string, unknown>) => void;
  onSave: (kind: ChannelKey) => void;
};

function ChannelFields({ kind, settings, saving, onDraftChange, onSave }: ChannelFieldsProps) {
  const current = settings[kind];
  const updateChannel = (input: Record<string, unknown>) => onDraftChange(kind, input);

  return (
    <>
      {kind === 'instagram' ? (
        <>
          <Field
            label="Perfil principal"
            value={settings.instagram.profile}
            onChange={(profile) => updateChannel({ profile, profiles: toList(profile, settings.instagram.profiles) })}
          />
          <Field
            label="Perfis Instagram"
            value={formatList(settings.instagram.profiles)}
            onChange={(value) => {
              const profiles = toList(value, settings.instagram.profiles);
              updateChannel({ profiles, profile: profiles[0] ?? settings.instagram.profile });
            }}
          />
        </>
      ) : null}
      <Field
        label="Horario inicial"
        value={current.startTime}
        onChange={(startTime) => updateChannel({ startTime })}
      />
      <Field
        label="Horario final"
        value={current.endTime}
        onChange={(endTime) => updateChannel({ endTime })}
      />
      <Field
        label="Delay minimo entre leads (segundos)"
        value={String(current.delayMinSeconds)}
        onChange={(value) => updateChannel({ delayMinSeconds: toPositiveNumber(value, current.delayMinSeconds) })}
      />
      <Field
        label="Delay maximo entre leads (segundos)"
        value={String(current.delayMaxSeconds)}
        onChange={(value) => updateChannel({ delayMaxSeconds: toPositiveNumber(value, current.delayMaxSeconds) })}
      />
      <Field
        label="Quantidade por lote"
        value={String(current.perBatch)}
        onChange={(value) => updateChannel({ perBatch: toPositiveNumber(value, current.perBatch) })}
      />
      <Field
        label="Quantidade de lotes"
        value={String(current.batches)}
        onChange={(value) => updateChannel({ batches: toPositiveNumber(value, current.batches) })}
      />
      <Field
        label="Espera entre lotes (minutos)"
        value={String(current.batchDelayMinutes)}
        onChange={(value) => updateChannel({ batchDelayMinutes: toNumber(value, current.batchDelayMinutes), delayMinutes: toNumber(value, current.batchDelayMinutes) })}
      />
      <Field
        label="Limite diario"
        value={String(current.dailyLimit)}
        onChange={(value) => updateChannel({ dailyLimit: toPositiveNumber(value, current.dailyLimit) })}
      />
      <Field
        label="Dias ativos"
        value={formatList(current.activeDays)}
        onChange={(value) => updateChannel({ activeDays: toList(value, current.activeDays) })}
      />
      <Field
        label="Comportamento do lote"
        value={current.batchBehavior}
        onChange={(batchBehavior) => updateChannel({ batchBehavior })}
      />
      <div className="settings-card__actions">
        <Button iconLeft={Save} loading={saving} onClick={() => onSave(kind)}>Salvar {kind === 'whatsapp' ? 'WhatsApp' : 'Instagram'}</Button>
      </div>
    </>
  );
}

export function SettingsPage() {
  const { settings, loading, saving, error, updateSettings, resetSettings } = useDispatchSettings();
  const [draft, setDraft] = useState<DispatchSettings | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (settings) setDraft(cloneSettings(settings));
  }, [settings]);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const updateDraft = (kind: ChannelKey, input: Record<string, unknown>) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        [kind]: {
          ...current[kind],
          ...input,
        },
      };
    });
  };

  const save = async (kind: ChannelKey) => {
    if (!draft) return;
    try {
      const nextSettings = await updateSettings({ [kind]: draft[kind] });
      setDraft(cloneSettings(nextSettings));
      pushToast({ title: 'Configuracoes salvas', description: `${kind === 'whatsapp' ? 'WhatsApp' : 'Instagram'} atualizado com sucesso.`, tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const reset = async () => {
    try {
      const nextSettings = await resetSettings();
      setDraft(cloneSettings(nextSettings));
      pushToast({ title: 'Configuracoes restauradas', description: 'Os valores de disparo voltaram para o padrao legado.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao restaurar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  if (loading || !settings || !draft) {
    return (
      <div className="settings-page">
        <PageHeader title="Disparos" />
        <div className="table-message">Carregando configuracoes de disparo...</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <PageHeader
        title="Disparos"
        action={
          <Button variant="secondary" iconLeft={RotateCcw} disabled={saving} onClick={reset}>
            Restaurar padrao
          </Button>
        }
      />
      {error ? <div className="table-message">{error}</div> : null}
      <p className="settings-note">Os campos ficam em rascunho nesta tela. A configuracao so e aplicada quando voce clicar em Salvar.</p>
      <section className="settings-grid">
        <Panel title="WhatsApp" className="settings-card">
          <ChannelFields kind="whatsapp" settings={draft} saving={saving} onDraftChange={updateDraft} onSave={save} />
        </Panel>
        <Panel title="Instagram" className="settings-card">
          <ChannelFields kind="instagram" settings={draft} saving={saving} onDraftChange={updateDraft} onSave={save} />
        </Panel>
      </section>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
