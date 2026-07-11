import { RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Panel, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useDispatchSettings } from '../hooks/useDispatchSettings';
import { CHIP_LEVEL_OPTIONS, chipLevelDefaults } from '../services/config/chipOperational';
import type { DispatchSettings, UpdateDispatchSettingsInput } from '../services/settings';

type InstagramFieldsProps = {
  settings: DispatchSettings;
  saving: boolean;
  onUpdate: (input: UpdateDispatchSettingsInput) => Promise<void>;
};

type DispatchPatch = Partial<DispatchSettings['whatsapp']>;
type InstagramPatch = Partial<DispatchSettings['instagram']>;

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

function InstagramFields({ settings, saving, onUpdate }: InstagramFieldsProps) {
  const updateInstagram = (input: InstagramPatch) => void onUpdate({ instagram: input });

  return (
    <Panel title="Instagram" className="settings-card settings-card--compact">
      <Field
        label="Perfil principal"
        value={settings.instagram.profile}
        density="compact"
        onChange={(profile) => updateInstagram({ profile, profiles: toList(profile, settings.instagram.profiles) })}
      />
      <Field
        label="Perfis Instagram"
        value={formatList(settings.instagram.profiles)}
        density="compact"
        onChange={(value) => {
          const profiles = toList(value, settings.instagram.profiles);
          updateInstagram({ profiles, profile: profiles[0] ?? settings.instagram.profile });
        }}
      />
      <p className="settings-note">Usado pelo Pré-Envio e pela fila Instagram, sem depender dos níveis dos chips.</p>
      <div className="settings-card__actions">
        <Button iconLeft={Save} loading={saving} onClick={() => void onUpdate({ instagram: settings.instagram })}>
          Salvar
        </Button>
      </div>
    </Panel>
  );
}

function SharedDispatchFields({ settings, saving, onUpdate }: { settings: DispatchSettings; saving: boolean; onUpdate: (input: UpdateDispatchSettingsInput) => Promise<void>; }) {
  const current = settings.whatsapp;

  const updateShared = (input: DispatchPatch) =>
    void onUpdate({
      whatsapp: input,
      instagram: {
        delayMinSeconds: input.delayMinSeconds ?? current.delayMinSeconds,
        delayMaxSeconds: input.delayMaxSeconds ?? current.delayMaxSeconds,
        batchDelayMinutes: input.batchDelayMinutes ?? settings.instagram.batchDelayMinutes,
        delayMinutes: input.batchDelayMinutes ?? settings.instagram.delayMinutes,
      },
    });

  return (
    <Panel title="Parametros fixos globais" className="settings-card settings-card--compact">
      <Field
        label="Delay minimo entre leads (segundos)"
        value={String(current.delayMinSeconds)}
        density="compact"
        onChange={(value) => updateShared({ delayMinSeconds: toNumber(value, current.delayMinSeconds) })}
      />
      <Field
        label="Delay maximo entre leads (segundos)"
        value={String(current.delayMaxSeconds)}
        density="compact"
        onChange={(value) => updateShared({ delayMaxSeconds: toNumber(value, current.delayMaxSeconds) })}
      />
      <Field
        label="Espera entre lotes (minutos)"
        value={String(current.batchDelayMinutes)}
        density="compact"
        onChange={(value) => updateShared({ batchDelayMinutes: toNumber(value, current.batchDelayMinutes) })}
      />
      <div className="settings-card__actions">
        <Button iconLeft={Save} loading={saving} onClick={() => void onUpdate({ whatsapp: current, instagram: settings.instagram })}>
          Salvar
        </Button>
      </div>
    </Panel>
  );
}

function ChipLevelPresets({ settings, saving, onUpdate }: { settings: DispatchSettings; saving: boolean; onUpdate: (input: UpdateDispatchSettingsInput) => Promise<void>; }) {
  const updateLevel = (level: string, patch: Partial<NonNullable<DispatchSettings['chipLevels']>[string]>) => {
    void onUpdate({
      chipLevels: {
        ...(settings.chipLevels ?? {}),
        [level]: {
          ...(settings.chipLevels?.[level] ?? {}),
          ...patch,
        },
      } as UpdateDispatchSettingsInput['chipLevels'],
    });
  };

  return (
    <Panel title="Niveis dos chips" className="settings-card settings-card--compact settings-card--chip-levels">
      <p className="settings-note">
        Cada nivel define o volume base do chip. O sistema calcula automaticamente a quantidade por lote a partir de <strong>Limite diário ÷ Qtd de lotes</strong>.
      </p>
      <div className="settings-chip-level-grid settings-chip-level-grid--cards">
        {CHIP_LEVEL_OPTIONS.map((option) => {
          const defaults = chipLevelDefaults(option.value, settings.chipLevels);
          const current = settings.chipLevels?.[option.value] ?? {};
          const batchCount = Number(current.batchCount ?? defaults.batchCount);
          const dailyLimit = Number(current.dailyLimit ?? defaults.dailyLimit);
          const blockSize = Math.max(1, Math.floor(dailyLimit / Math.max(1, batchCount)));

          return (
            <article className="settings-chip-level-card" key={option.value}>
              <header className="settings-chip-level-card__header">
                <strong>{option.label}</strong>
                <span>{blockSize} por lote • {dailyLimit} por dia</span>
              </header>
              <div className="settings-chip-level-card__fields">
                <Field
                  label="Qtd de lotes"
                  value={String(batchCount)}
                  density="compact"
                  onChange={(value) => updateLevel(option.value, { batchCount: toNumber(value, defaults.batchCount) })}
                />
                <Field
                  label="Limite diário"
                  value={String(dailyLimit)}
                  density="compact"
                  onChange={(value) => updateLevel(option.value, { dailyLimit: toNumber(value, defaults.dailyLimit) })}
                />
              </div>
            </article>
          );
        })}
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
      <section className="settings-grid settings-grid--three">
        <SharedDispatchFields settings={settings} saving={saving} onUpdate={update} />
        <InstagramFields settings={settings} saving={saving} onUpdate={update} />
        <ChipLevelPresets settings={settings} saving={saving} onUpdate={update} />
      </section>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
