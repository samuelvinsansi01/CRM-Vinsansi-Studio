import { AlertTriangle, CheckCircle2, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Panel, Tag, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useConfigRecords } from '../hooks/useConfigRecords';
import { useDispatchSettings } from '../hooks/useDispatchSettings';
import { CHIP_LEVEL_OPTIONS, chipLevelDefaults } from '../services/config/chipOperational';
import { buildOperationalReadiness } from '../services/config/operationalConfig.rules';
import type { ConfigRecord, InstagramConfigRecord } from '../services/config/types';
import type { DispatchChannelSettings, DispatchSettings } from '../services/settings';

function toNumber(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toList(value: string, fallback: string[] = []) {
  const list = value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : fallback;
}

function channelPatch(
  draft: DispatchSettings,
  channel: 'whatsapp' | 'instagram',
  patch: Partial<DispatchChannelSettings>,
): DispatchSettings {
  return {
    ...draft,
    [channel]: {
      ...draft[channel],
      ...patch,
    },
  };
}

function ChannelPanel({
  title,
  channel,
  onChange,
}: {
  title: string;
  channel: DispatchChannelSettings;
  onChange: (patch: Partial<DispatchChannelSettings>) => void;
}) {
  return (
    <Panel title={title} className="settings-card settings-card--compact">
      <div className="settings-card__fields-grid">
        <Field label="Inicio" type="time" density="compact" value={channel.startTime} onChange={(startTime) => onChange({ startTime })} />
        <Field label="Fim" type="time" density="compact" value={channel.endTime} onChange={(endTime) => onChange({ endTime })} />
        <Field
          label="Delay minimo entre leads (s)"
          type="number"
          min={10}
          density="compact"
          value={String(channel.delayMinSeconds)}
          onChange={(value) => onChange({ delayMinSeconds: toNumber(value, channel.delayMinSeconds) })}
        />
        <Field
          label="Delay maximo entre leads (s)"
          type="number"
          min={10}
          density="compact"
          value={String(channel.delayMaxSeconds)}
          onChange={(value) => onChange({ delayMaxSeconds: toNumber(value, channel.delayMaxSeconds) })}
        />
        <Field
          label="Limite diario"
          type="number"
          min={1}
          density="compact"
          value={String(channel.dailyLimit)}
          onChange={(value) => onChange({ dailyLimit: toNumber(value, channel.dailyLimit) })}
        />
        <Field
          label="Quantidade de lotes"
          type="number"
          min={1}
          density="compact"
          value={String(channel.batches)}
          onChange={(value) => {
            const batches = Math.max(1, toNumber(value, channel.batches));
            onChange({ batches, perBatch: Math.max(1, Math.floor(channel.dailyLimit / batches)) });
          }}
        />
        <Field
          label="Quantidade por lote"
          type="number"
          min={1}
          density="compact"
          value={String(channel.perBatch)}
          onChange={(value) => onChange({ perBatch: toNumber(value, channel.perBatch) })}
        />
        <Field
          label="Espera entre lotes (min)"
          type="number"
          min={0}
          density="compact"
          value={String(channel.batchDelayMinutes)}
          onChange={(value) => onChange({ batchDelayMinutes: toNumber(value, channel.batchDelayMinutes) })}
        />
      </div>
      <Field
        label="Dias ativos"
        value={channel.activeDays.join(', ')}
        density="compact"
        placeholder="Segunda, Terca, Quarta, Quinta, Sexta"
        onChange={(value) => onChange({ activeDays: toList(value, channel.activeDays) })}
      />
      <p className="settings-note">Use os nomes: Segunda, Terca, Quarta, Quinta, Sexta, Sabado e Domingo.</p>
    </Panel>
  );
}

function ChipLevelPresets({ draft, onChange }: { draft: DispatchSettings; onChange: (next: DispatchSettings) => void }) {
  return (
    <Panel title="Niveis dos chips" className="settings-card settings-card--compact settings-card--chip-levels">
      <p className="settings-note">Cada nivel define limite diario e quantidade de lotes. O tamanho efetivo e calculado automaticamente.</p>
      <div className="settings-chip-level-grid settings-chip-level-grid--cards">
        {CHIP_LEVEL_OPTIONS.map((option) => {
          const defaults = chipLevelDefaults(option.value, draft.chipLevels);
          const current = draft.chipLevels?.[option.value] ?? {};
          const batchCount = Number(current.batchCount ?? defaults.batchCount);
          const dailyLimit = Number(current.dailyLimit ?? defaults.dailyLimit);
          const blockSize = Math.max(1, Math.floor(dailyLimit / Math.max(1, batchCount)));

          const updateLevel = (patch: { dailyLimit?: number; batchCount?: number }) => {
            onChange({
              ...draft,
              chipLevels: {
                ...draft.chipLevels,
                [option.value]: {
                  ...current,
                  ...patch,
                },
              },
            });
          };

          return (
            <article className="settings-chip-level-card" key={option.value}>
              <header className="settings-chip-level-card__header">
                <strong>{option.label}</strong>
                <span>{blockSize} por lote • {dailyLimit} por dia</span>
              </header>
              <div className="settings-chip-level-card__fields">
                <Field
                  label="Qtd de lotes"
                  type="number"
                  min={1}
                  value={String(batchCount)}
                  density="compact"
                  onChange={(value) => updateLevel({ batchCount: toNumber(value, defaults.batchCount) })}
                />
                <Field
                  label="Limite diario"
                  type="number"
                  min={1}
                  value={String(dailyLimit)}
                  density="compact"
                  onChange={(value) => updateLevel({ dailyLimit: toNumber(value, defaults.dailyLimit) })}
                />
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function activeInstagramProfiles(records: ConfigRecord[]) {
  return records
    .filter((record): record is InstagramConfigRecord => record.kind === 'instagram')
    .filter((record) => record.active && String(record.status).toLowerCase() === 'ativo')
    .map((record) => record.username)
    .filter(Boolean);
}

export function SettingsPage() {
  const { settings, loading, saving, error, updateSettings, resetSettings } = useDispatchSettings();
  const branches = useConfigRecords('branches', { status: 'Todos' });
  const templates = useConfigRecords('templates', { status: 'Todos' });
  const chips = useConfigRecords('chips', { status: 'Todos' });
  const instagram = useConfigRecords('instagram', { status: 'Todos' });
  const [draft, setDraft] = useState<DispatchSettings | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const allRecords = useMemo(
    () => [...branches.records, ...templates.records, ...chips.records, ...instagram.records],
    [branches.records, templates.records, chips.records, instagram.records],
  );
  const readiness = useMemo(() => buildOperationalReadiness(allRecords), [allRecords]);
  const profiles = useMemo(() => activeInstagramProfiles(instagram.records), [instagram.records]);
  const dirty = Boolean(settings && draft && JSON.stringify(settings) !== JSON.stringify(draft));

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const save = async () => {
    if (!draft) return;
    try {
      const instagramProfile = profiles[0] ?? '';
      const next = {
        ...draft,
        instagram: {
          ...draft.instagram,
          profile: instagramProfile,
          profiles,
        },
      };
      await updateSettings(next);
      setDraft(next);
      pushToast({ title: 'Configuracoes salvas', description: 'Os parametros foram salvos neste navegador para o usuario autenticado.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const reset = async () => {
    try {
      const next = await resetSettings();
      setDraft(next);
      pushToast({ title: 'Configuracoes restauradas', description: 'Os valores voltaram para o padrao operacional.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao restaurar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  if (loading || !draft) {
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
          <div className="settings-page__actions">
            <Button variant="secondary" iconLeft={RotateCcw} disabled={saving} onClick={reset}>Restaurar padrao</Button>
            <Button iconLeft={Save} loading={saving} disabled={!dirty} onClick={save}>Salvar alteracoes</Button>
          </div>
        }
      />

      {error ? <div className="table-message">{error}</div> : null}

      <Panel title="Prontidao operacional" className="settings-card settings-card--readiness">
        <div className="settings-readiness__header">
          {readiness.ready ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
          <Tag tone={readiness.ready ? 'success' : 'warning'}>{readiness.ready ? 'Configuracao minima completa' : 'Configuracao incompleta'}</Tag>
        </div>
        <div className="settings-readiness__metrics">
          <span>{readiness.activeBranches} ramo(s)</span>
          <span>{readiness.activeTemplates} template(s)</span>
          <span>{readiness.activeChips} chip(s)</span>
          <span>{readiness.activeInstagramProfiles} perfil(is) Instagram</span>
        </div>
        {readiness.issues.length ? <p className="settings-note">{readiness.issues.join(' ')}</p> : null}
        <p className="settings-note">Perfis ativos usados pelo Instagram: {profiles.length ? profiles.map((profile) => `@${profile}`).join(', ') : 'nenhum'}.</p>
      </Panel>

      <section className="settings-grid settings-grid--two">
        <ChannelPanel
          title="WhatsApp"
          channel={draft.whatsapp}
          onChange={(patch) => setDraft((current) => current ? channelPatch(current, 'whatsapp', patch) : current)}
        />
        <ChannelPanel
          title="Instagram"
          channel={draft.instagram}
          onChange={(patch) => setDraft((current) => current ? channelPatch(current, 'instagram', patch) : current)}
        />
      </section>

      <ChipLevelPresets draft={draft} onChange={setDraft} />

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
