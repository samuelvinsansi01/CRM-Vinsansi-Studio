import { RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Panel, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useDispatchSettings } from '../hooks/useDispatchSettings';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../services/settings';

function toNumber(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  onUpdate: (input: UpdateDispatchSettingsInput) => Promise<void>;
  onSave: (kind: ChannelKey) => void;
};

function ChannelFields({ kind, settings, saving, onUpdate, onSave }: ChannelFieldsProps) {
  const current = settings[kind];

  const updateChannel = (input: Record<string, unknown>) => onUpdate({ [kind]: input });

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
        onChange={(value) => updateChannel({ delayMinSeconds: toNumber(value, current.delayMinSeconds) })}
      />
      <Field
        label="Delay maximo entre leads (segundos)"
        value={String(current.delayMaxSeconds)}
        onChange={(value) => updateChannel({ delayMaxSeconds: toNumber(value, current.delayMaxSeconds) })}
      />
      <Field
        label="Quantidade por lote"
        value={String(current.perBatch)}
        onChange={(value) => updateChannel({ perBatch: toNumber(value, current.perBatch) })}
      />
      <Field
        label="Quantidade de lotes"
        value={String(current.batches)}
        onChange={(value) => updateChannel({ batches: toNumber(value, current.batches) })}
      />
      <Field
        label="Espera entre lotes (minutos)"
        value={String(current.batchDelayMinutes)}
        onChange={(value) => updateChannel({ batchDelayMinutes: toNumber(value, current.batchDelayMinutes), delayMinutes: toNumber(value, current.batchDelayMinutes) })}
      />
      <Field
        label="Limite diario"
        value={String(current.dailyLimit)}
        onChange={(value) => updateChannel({ dailyLimit: toNumber(value, current.dailyLimit) })}
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
        <Button iconLeft={Save} loading={saving} onClick={() => onSave(kind)}>Salvar</Button>
      </div>
    </>
  );
}

export function SettingsPage() {
  const { settings, loading, saving, error, updateSettings, resetSettings } = useDispatchSettings();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const update = async (input: UpdateDispatchSettingsInput) => {
    try {
      await updateSettings(input);
    } catch (err) {
      pushToast({ title: 'Erro ao salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const save = (kind: ChannelKey) => {
    pushToast({ title: 'Configuracoes salvas', description: `${kind === 'whatsapp' ? 'WhatsApp' : 'Instagram'} atualizado com sucesso.`, tone: 'success' });
  };

  const reset = async () => {
    try {
      await resetSettings();
      pushToast({ title: 'Configuracoes restauradas', description: 'Os valores de disparo voltaram para o padrao legado.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao restaurar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  if (loading || !settings) {
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
      <section className="settings-grid">
        <Panel title="WhatsApp" className="settings-card">
          <ChannelFields kind="whatsapp" settings={settings} saving={saving} onUpdate={update} onSave={save} />
        </Panel>
        <Panel title="Instagram" className="settings-card">
          <ChannelFields kind="instagram" settings={settings} saving={saving} onUpdate={update} onSave={save} />
        </Panel>
      </section>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
