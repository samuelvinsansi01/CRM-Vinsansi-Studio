import {
  Activity, Boxes, Download, PackageCheck, Power, RefreshCw, RotateCcw, Save, Settings2, ShieldCheck, Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Field, Panel, SegmentedControl, SelectField, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useNotificationContext } from '../providers/NotificationProvider';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import {
  toolsService,
  type OrganizationToolDetails,
  type OrganizationToolSettings,
  type OrganizationToolSummary,
  type ToolCompatibility,
  type ToolId,
  type ToolPresence,
} from '../services/tools/tools.service';

type ToolRelease = { id: string; name: string; description: string; version: string; path: string; fileName: string; size: number };
type ToolsManifest = { updatedAt: string; tools: ToolRelease[] };
type DetailTab = 'Visão geral' | 'Instalações' | 'Configurações';

const tabs: DetailTab[] = ['Visão geral', 'Instalações', 'Configurações'];
const settingsPermissions: Record<ToolId, string> = {
  vinsansi_capture: 'capture.settings',
  vinsansi_instagram: 'instagram.settings',
  vinsansi_whatsapp_manager: 'whatsapp.settings',
};

const labels: Record<string, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', chipLevels: 'Níveis dos chips', operationalTimezone: 'Fuso operacional',
  operationalCutoffHour: 'Hora limite operacional', minRating: 'Avaliação mínima', minReviews: 'Avaliações mínimas',
  safeMode: 'Modo seguro', simulationMode: 'Modo de simulação', instagramLowRating: 'Instagram para avaliação baixa',
  enabled: 'Habilitado', maxRatingExclusive: 'Avaliação máxima (exclusiva)', branchRules: 'Regras por ramo',
  deduplication: 'Deduplicação', byPhone: 'Por telefone', bySite: 'Por site', blockBasePermanent: 'Bloquear Base Permanente',
  allowSmartReimport: 'Permitir reimportação inteligente', incrementalImport: 'Importação incremental', routes: 'Rotas',
  ownSite: 'Site próprio', aggregators: 'Agregadores', blockFacebookAsSite: 'Não tratar Facebook como site',
  requireConfiguredCategory: 'Exigir categoria configurada', rejectOutOfProfile: 'Rejeitar fora do perfil', logs: 'Logs',
  logRejected: 'Registrar rejeitados', logRejectionReason: 'Registrar motivo da rejeição', profile: 'Perfil', profiles: 'Perfis',
  startTime: 'Início', endTime: 'Fim', delayMinSeconds: 'Atraso mínimo (segundos)', delayMaxSeconds: 'Atraso máximo (segundos)',
  perBatch: 'Itens por lote', batches: 'Lotes', batchDelayMinutes: 'Intervalo entre lotes (minutos)', delayMinutes: 'Intervalo (minutos)',
  dailyLimit: 'Limite diário', activeDays: 'Dias ativos', batchBehavior: 'Comportamento dos lotes',
};

function labelFor(key: string) { return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2'); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function updatePath(root: Record<string, unknown>, path: string[], value: unknown) {
  const next = clone(root);
  let cursor: Record<string, unknown> = next;
  path.slice(0, -1).forEach((part) => { cursor = cursor[part] as Record<string, unknown>; });
  cursor[path[path.length - 1]] = value;
  return next;
}

function SettingsFields({ value, path = [], onChange }: { value: Record<string, unknown>; path?: string[]; onChange: (path: string[], value: unknown) => void }) {
  return (
    <div className={`tool-settings-fields ${path.length ? 'tool-settings-fields--nested' : ''}`}>
      {Object.entries(value).map(([key, fieldValue]) => {
        const fieldPath = [...path, key];
        if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
          return (
            <fieldset className="tool-settings-group" key={key}>
              <legend>{labelFor(key)}</legend>
              <SettingsFields value={fieldValue as Record<string, unknown>} path={fieldPath} onChange={onChange} />
            </fieldset>
          );
        }
        if (Array.isArray(fieldValue)) {
          const primitive = fieldValue.every((item) => ['string', 'number', 'boolean'].includes(typeof item));
          return primitive ? (
            <Field key={key} label={labelFor(key)} value={fieldValue.join(', ')} onChange={(input) => onChange(fieldPath, input.split(',').map((item) => item.trim()).filter(Boolean))} />
          ) : (
            <label className="field field--textarea" key={key}>
              <span className="field__label">{labelFor(key)}</span>
              <span className="field__control">
                <textarea defaultValue={JSON.stringify(fieldValue, null, 2)} onBlur={(event) => {
                  try { const parsed: unknown = JSON.parse(event.currentTarget.value); if (Array.isArray(parsed)) onChange(fieldPath, parsed); } catch { /* Validado no salvamento. */ }
                }} />
              </span>
            </label>
          );
        }
        if (typeof fieldValue === 'boolean') {
          return (
            <label className="field" key={key}>
              <span className="field__label">{labelFor(key)}</span>
              <SelectField value={String(fieldValue)} options={[{ label: 'Sim', value: 'true' }, { label: 'Não', value: 'false' }]} onChange={(input) => onChange(fieldPath, input === 'true')} />
            </label>
          );
        }
        return <Field key={key} label={labelFor(key)} type={typeof fieldValue === 'number' ? 'number' : 'text'} value={String(fieldValue ?? '')} onChange={(input) => onChange(fieldPath, typeof fieldValue === 'number' ? Number(input) : input)} />;
      })}
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function presenceLabel(value: ToolPresence) {
  return ({ online: 'Online', offline: 'Offline', never_seen: 'Nunca visto', not_supported: 'Não suportado' } as const)[value] ?? 'Não suportado';
}
function presenceTone(value: ToolPresence): 'success' | 'warning' | 'neutral' { return value === 'online' ? 'success' : value === 'offline' ? 'warning' : 'neutral'; }
function compatibilityLabel(value: ToolCompatibility) {
  return ({ compatible: 'Compatível', update_available: 'Atualização disponível', incompatible: 'Incompatível', unknown: 'Desconhecida' } as const)[value] ?? 'Desconhecida';
}
function compatibilityTone(value: ToolCompatibility): 'success' | 'warning' | 'danger' | 'neutral' {
  return value === 'compatible' ? 'success' : value === 'incompatible' ? 'danger' : value === 'update_available' ? 'warning' : 'neutral';
}
function administrativeLabel(value: OrganizationToolSummary['administrativeStatus']) {
  return ({ registered: 'Registrada', disabled: 'Desabilitada', revoked: 'Revogada', not_registered: 'Não registrada' } as const)[value] ?? value;
}

export function ToolsPage() {
  const { organizationId, hasPermission } = useOrganizationContext();
  const { push } = useNotificationContext();
  const [tools, setTools] = useState<OrganizationToolSummary[]>([]);
  const [manifest, setManifest] = useState<ToolsManifest | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<ToolId | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('Visão geral');
  const [details, setDetails] = useState<OrganizationToolDetails | null>(null);
  const [toolSettings, setToolSettings] = useState<OrganizationToolSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canManageTools = hasPermission('tools.manage');
  const canViewSettings = hasPermission('settings.view');
  const canEditSelected = selectedToolId ? hasPermission(settingsPermissions[selectedToolId]) : false;

  const loadTools = useCallback(async () => {
    setLoading(true); setError('');
    try { setTools(await toolsService.list()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as ferramentas.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadTools(); }, [loadTools, organizationId]);
  useEffect(() => {
    void fetch(`/tools/manifest.json?v=${Date.now()}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<ToolsManifest> : Promise.reject(new Error('Manifesto indisponível.')))
      .then(setManifest).catch(() => setManifest(null));
  }, []);

  const loadDetails = useCallback(async (toolId: ToolId) => {
    setDetailLoading(true); setError('');
    try {
      const [nextDetails, nextSettings] = await Promise.all([
        toolsService.details(toolId),
        canViewSettings ? toolsService.settings(toolId) : Promise.resolve(null),
      ]);
      setDetails(nextDetails);
      setToolSettings(nextSettings);
      setDraft(clone(nextSettings?.settings ?? {}));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a ferramenta.'); }
    finally { setDetailLoading(false); }
  }, [canViewSettings]);

  useEffect(() => { if (selectedToolId) void loadDetails(selectedToolId); }, [loadDetails, selectedToolId]);

  const selectedSummary = useMemo(() => tools.find((tool) => tool.toolId === selectedToolId) ?? null, [selectedToolId, tools]);

  async function changeEnabled(tool: OrganizationToolSummary) {
    setSaving(true);
    try {
      await toolsService.setEnabled(tool.toolId, !tool.enabled);
      push({ type: 'success', message: `Ferramenta ${tool.enabled ? 'desabilitada' : 'habilitada'} com auditoria.` });
      await loadTools();
      if (selectedToolId === tool.toolId) await loadDetails(tool.toolId);
    } catch (cause) { push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao alterar ferramenta.' }); }
    finally { setSaving(false); }
  }

  async function saveSettings() {
    if (!selectedToolId || !toolSettings) return;
    setSaving(true);
    try {
      await toolsService.saveSettings(selectedToolId, draft, toolSettings.settingsVersion);
      push({ type: 'success', message: 'Configurações atualizadas no control plane.' });
      await Promise.all([loadDetails(selectedToolId), loadTools()]);
    } catch (cause) { push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao salvar configurações.' }); }
    finally { setSaving(false); }
  }

  async function resetSettings() {
    if (!selectedToolId || !toolSettings) return;
    setSaving(true);
    try {
      await toolsService.resetSettings(selectedToolId, toolSettings.settingsVersion);
      push({ type: 'success', message: 'Configurações restauradas para o default canônico.' });
      await Promise.all([loadDetails(selectedToolId), loadTools()]);
    } catch (cause) { push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao restaurar configurações.' }); }
    finally { setSaving(false); }
  }

  async function changeInstallation(id: string, status: 'disabled' | 'revoked') {
    if (!selectedToolId) return;
    setSaving(true);
    try {
      await toolsService.setInstallationStatus(id, status);
      push({ type: 'success', message: `Instalação ${status === 'revoked' ? 'revogada' : 'desabilitada'}.` });
      await Promise.all([loadDetails(selectedToolId), loadTools()]);
    } catch (cause) { push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao alterar instalação.' }); }
    finally { setSaving(false); }
  }

  return (
    <div className="settings-page tools-page">
      <PageHeader title="Central de Ferramentas" description="Control plane organizacional de configurações, instalações, versões, capabilities e limites do ecossistema."
        action={<Button variant="secondary" iconLeft={RefreshCw} loading={loading} onClick={() => void loadTools()}>Atualizar</Button>} />

      {error ? <div className="table-message table-message--error">{error}</div> : null}
      {loading && !tools.length ? <div className="table-message">Carregando catálogo canônico...</div> : null}

      <div className="tools-control-grid">
        {tools.map((tool) => (
          <article className={`tool-control-card ${selectedToolId === tool.toolId ? 'tool-control-card--selected' : ''}`} key={tool.toolId}>
            <header className="tool-control-card__header">
              <span className="tool-card__icon">{tool.toolId === 'vinsansi_capture' ? <Wrench size={24} /> : tool.toolId === 'vinsansi_instagram' ? <Activity size={24} /> : <Boxes size={24} />}</span>
              <div><strong>{tool.displayName}</strong><small>{tool.toolId}</small></div>
            </header>
            <p>{tool.description}</p>
            <dl className="tool-status-grid">
              <div><dt>Registro</dt><dd><Tag tone={tool.enabled ? 'success' : 'neutral'}>{administrativeLabel(tool.administrativeStatus)}</Tag></dd></div>
              <div><dt>Presença</dt><dd><Tag tone={presenceTone(tool.presence)}>{presenceLabel(tool.presence)}</Tag></dd></div>
              <div><dt>Versão</dt><dd>{tool.installedVersion ?? 'Não reportada'}</dd></div>
              <div><dt>Compatibilidade</dt><dd><Tag tone={compatibilityTone(tool.compatibility)}>{compatibilityLabel(tool.compatibility)}</Tag></dd></div>
              <div><dt>Instalações</dt><dd>{tool.installationCount}</dd></div>
              <div><dt>Última atividade</dt><dd>{formatDate(tool.lastActivityAt)}</dd></div>
            </dl>
            <div className="tool-control-card__actions">
              <Button variant="secondary" iconLeft={Settings2} onClick={() => { setSelectedToolId(tool.toolId); setActiveTab('Visão geral'); }}>Abrir central</Button>
              {canManageTools ? <Button variant={tool.enabled ? 'danger' : 'primary'} iconLeft={Power} loading={saving} onClick={() => void changeEnabled(tool)}>{tool.enabled ? 'Desabilitar' : 'Habilitar'}</Button> : null}
            </div>
          </article>
        ))}
      </div>

      {selectedToolId ? (
        <Panel className="settings-card tool-detail-panel" title={selectedSummary?.displayName ?? 'Ferramenta'}
          actions={<SegmentedControl items={tabs} active={activeTab} onChange={(tab) => setActiveTab(tab as DetailTab)} />}>
          {detailLoading ? <div className="table-message">Carregando detalhes...</div> : null}
          {!detailLoading && details && activeTab === 'Visão geral' ? (
            <div className="tool-overview-grid">
              <article><ShieldCheck size={20} /><div><strong>Registro administrativo</strong><span>{administrativeLabel(details.administrativeStatus)}</span></div></article>
              <article><PackageCheck size={20} /><div><strong>Versões suportadas</strong><span>Mínima {details.minimumSupportedVersion ?? '—'} · Atual {details.latestVersion ?? '—'}</span></div></article>
              <article><Boxes size={20} /><div><strong>Instalações</strong><span>{details.installations.length} registro(s) canônico(s)</span></div></article>
              <article><Activity size={20} /><div><strong>Entitlements</strong><code>{JSON.stringify(details.entitlements)}</code></div></article>
              <p className="tool-stage-boundary">Presença usa heartbeat de 60s e TTL de 180s somente quando a capability <code>presence.heartbeat</code> é suportada. A adoção completa pelos executores pertence à Etapa 4.</p>
            </div>
          ) : null}

          {!detailLoading && details && activeTab === 'Instalações' ? (
            details.installations.length ? <div className="tool-installations-wrap"><table className="tool-installations-table"><thead><tr><th>Instalação</th><th>Registro</th><th>Presença</th><th>Versão</th><th>Compatibilidade</th><th>Vista / atividade</th><th>Capabilities</th>{canManageTools ? <th>Ações</th> : null}</tr></thead><tbody>
              {details.installations.map((installation) => <tr key={installation.id}>
                <td><strong>{installation.externalInstallationId.slice(0, 24)}</strong><small>{installation.id.slice(0, 8)}</small></td>
                <td><Tag tone={installation.registrationStatus === 'registered' ? 'success' : 'neutral'}>{administrativeLabel(installation.registrationStatus)}</Tag></td>
                <td><Tag tone={presenceTone(installation.presence)}>{presenceLabel(installation.presence)}</Tag></td>
                <td>{installation.installedVersion ?? '—'}</td>
                <td><Tag tone={compatibilityTone(installation.compatibility)}>{compatibilityLabel(installation.compatibility)}</Tag></td>
                <td><span>Vista: {formatDate(installation.lastSeenAt)}</span><small>Atividade: {formatDate(installation.lastActivityAt)}</small></td>
                <td><div className="tool-capabilities">{installation.reportedCapabilities.length ? installation.reportedCapabilities.map((capability) => <code key={capability}>{capability}</code>) : 'Nenhuma reportada'}</div></td>
                {canManageTools ? <td><div className="tool-installation-actions"><Button size="sm" variant="secondary" disabled={installation.registrationStatus !== 'registered'} onClick={() => void changeInstallation(installation.id, 'disabled')}>Desabilitar</Button><Button size="sm" variant="danger" disabled={installation.registrationStatus === 'revoked'} onClick={() => void changeInstallation(installation.id, 'revoked')}>Revogar</Button></div></td> : null}
              </tr>)}
            </tbody></table></div> : <div className="table-message">Nenhuma instalação física confiável foi registrada. Isso não é apresentado como “online”.</div>
          ) : null}

          {!detailLoading && activeTab === 'Configurações' ? (
            !canViewSettings ? <div className="table-message">A permissão settings.view é necessária para visualizar configurações.</div>
              : toolSettings ? <div className="tool-settings-editor">
                <div className="tool-settings-editor__meta"><span>Schema v{toolSettings.settingsSchemaVersion}</span><span>Settings v{toolSettings.settingsVersion}</span><span>Atualizado em {formatDate(toolSettings.updatedAt)}</span></div>
                <SettingsFields value={draft} onChange={(path, value) => setDraft((current) => updatePath(current, path, value))} />
                <div className="tool-settings-editor__actions">
                  <Button variant="secondary" iconLeft={RotateCcw} loading={saving} disabled={!canEditSelected} onClick={() => void resetSettings()}>Restaurar padrão</Button>
                  <Button iconLeft={Save} loading={saving} disabled={!canEditSelected} onClick={() => void saveSettings()}>Salvar configuração</Button>
                </div>
                {!canEditSelected ? <p className="settings-note">Sua função pode visualizar, mas não editar as configurações desta ferramenta.</p> : null}
              </div> : <div className="table-message">Configuração indisponível.</div>
          ) : null}
        </Panel>
      ) : null}

      {manifest?.tools.length ? (
        <Panel title="Downloads e manifestos" className="settings-card tools-panel" actions={<span className="tools-updated-at">Atualizado em {formatDate(manifest.updatedAt)}</span>}>
          <p className="settings-note">Pacotes operacionais permanecem nesta Central; não constituem uma segunda arquitetura de ferramentas.</p>
          <div className="tools-download-grid">{manifest.tools.map((release) => <article className="tool-download-card" key={release.id}>
            <div><PackageCheck size={20} /><span><strong>{release.name}</strong><small>Versão {release.version} · {formatFileSize(release.size)}</small></span></div>
            <a className="button button--secondary button--md" href={`${release.path}?v=${encodeURIComponent(release.version)}`} download={release.fileName}><Download size={16} /><span>Baixar ZIP</span></a>
          </article>)}</div>
        </Panel>
      ) : null}
    </div>
  );
}
