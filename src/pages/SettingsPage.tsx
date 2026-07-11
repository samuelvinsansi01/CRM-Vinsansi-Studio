import { RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Panel, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useDispatchSettings } from '../hooks/useDispatchSettings';
import { CHIP_LEVEL_OPTIONS } from '../services/config/chipOperational';
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
      ) : (
        <p className="settings-note">Os parametros fixos de disparo sao compartilhados na secao acima.</p>
      )}
      {kind === 'instagram' ? (
        <div className="settings-card__actions">
          <Button iconLeft={Save} loading={saving} onClick={() => onSave(kind)}>Salvar</Button>
        </div>
      ) : null}
    </>
  );
}

function SharedDispatchFields({ settings, saving, onUpdate }: { settings: DispatchSettings; saving: boolean; onUpdate: (input: UpdateDispatchSettingsInput) => Promise<void>; }) {
  const current = settings.whatsapp;
  const updateBoth = (input: Record<string, unknown>) =>
    void onUpdate({ whatsapp: input, instagram: input as UpdateDispatchSettingsInput['instagram'] });

  return (
    <Panel title="Parametros fixos" className="settings-card">
      <Field
        label="Delay minimo entre leads (segundos)"
        value={String(current.delayMinSeconds)}
        onChange={(value) => updateBoth({ delayMinSeconds: toNumber(value, current.delayMinSeconds) })}
      />
      <Field
        label="Delay maximo entre leads (segundos)"
        value={String(current.delayMaxSeconds)}
        onChange={(value) => updateBoth({ delayMaxSeconds: toNumber(value, current.delayMaxSeconds) })}
      />
      <Field
        label="Quantidade de lotes"
        value={String(current.batches)}
        onChange={(value) => updateBoth({ batches: toNumber(value, current.batches) })}
      />
      <Field
        label="Espera entre lotes (minutos)"
        value={String(current.batchDelayMinutes)}
        onChange={(value) => updateBoth({ batchDelayMinutes: toNumber(value, current.batchDelayMinutes), delayMinutes: toNumber(value, current.batchDelayMinutes) })}
      />
      <div className="settings-card__actions">
        <Button iconLeft={Save} loading={saving} onClick={() => void onUpdate({ whatsapp: current, instagram: settings.instagram })}>Salvar</Button>
      </div>
    </Panel>
  );
}

function ChipLevelPresets({ settings, saving, onUpdate }: { settings: DispatchSettings; saving: boolean; onUpdate: (input: UpdateDispatchSettingsInput) => Promise<void>; }) {
  const updateLevel = (level: string, blockSize: string) => {
    const nextBlockSize = toNumber(blockSize, Number(settings.chipLevels?.[level]?.blockSize ?? 0), 1);
    void onUpdate({ chipLevels: { ...(settings.chipLevels ?? {}), [level]: { ...(settings.chipLevels?.[level] ?? {}), blockSize: nextBlockSize } } as UpdateDispatchSettingsInput['chipLevels'] });
  };

  return (
    <Panel title="Niveis dos chips" className="settings-card">
      <p className="settings-note">O nivel do chip define a quantidade por lote usada como base na montagem dos chips e das filas.</p>
      <div className="settings-chip-level-grid">
        {CHIP_LEVEL_OPTIONS.map((option) => (
          <label className="drawer-field" key={option.value}>
            <span>{option.label}</span>
            <Field
              value={String(settings.chipLevels?.[option.value]?.blockSize ?? '')}
              readOnly={saving}
              onChange={(value) => updateLevel(option.value, value)}
              placeholder="Quantidade por lote"
            />
          </label>
        ))}
      </div>
    </Panel>
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
      <SharedDispatchFields settings={settings} saving={saving} onUpdate={update} />
      <section className="settings-grid">
        <Panel title="WhatsApp" className="settings-card">
          <ChannelFields kind="whatsapp" settings={settings} saving={saving} onUpdate={update} onSave={save} />
        </Panel>
        <Panel title="Instagram" className="settings-card">
          <ChannelFields kind="instagram" settings={settings} saving={saving} onUpdate={update} onSave={save} />
        </Panel>
      </section>
      <ChipLevelPresets settings={settings} saving={saving} onUpdate={update} />

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
