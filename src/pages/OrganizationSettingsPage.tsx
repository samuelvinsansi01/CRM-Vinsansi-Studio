import { useEffect, useState } from 'react';
import { Building2, RefreshCcw, Save } from 'lucide-react';
import { Button, Field, MetricCard, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useNotificationContext } from '../providers/NotificationProvider';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { updateCurrentOrganization } from '../services/organization/organization.service';

export function OrganizationSettingsPage() {
  const { context, organizationName, accessLevel, isPlatformOwner, refreshOrganization } = useOrganizationContext();
  const { push } = useNotificationContext();
  const [name, setName] = useState(organizationName);
  const [saving, setSaving] = useState(false);
  useEffect(() => setName(organizationName), [organizationName]);
  const canEdit = isPlatformOwner || accessLevel === 'owner' || context?.permissions.includes('organization.settings.manage');

  const save = async () => {
    setSaving(true);
    try {
      await updateCurrentOrganization(name);
      await refreshOrganization();
      push({ type: 'success', message: 'Organização atualizada.' });
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao atualizar organização.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="organization-page">
      <PageHeader title="Organização" description="A organização é a empresa/tenant e é proprietária de todos os recursos e dados comerciais." action={<Button variant="secondary" iconLeft={RefreshCcw} onClick={() => void refreshOrganization()}>Atualizar</Button>} />
      <section className="metric-grid metric-grid--3">
        <MetricCard icon={Building2} value={organizationName || '—'} label="Organização ativa" tone="primary" />
        <MetricCard value={accessLevel === 'owner' ? 'Dono' : accessLevel === 'manager' ? 'Gestor' : accessLevel === 'member' ? 'Membro' : 'Platform Owner'} label="Seu nível" tone="warning" />
        <MetricCard value={context?.member?.roleName ?? (accessLevel === 'owner' ? 'Acesso total' : '—')} label="Sua função" />
      </section>
      <Panel title="Identificação" className="organization-panel organization-settings-card">
        <div className="organization-form-stack">
          <Field label="Nome da organização" value={name} disabled={!canEdit} onChange={setName} />
          <div className="organization-readonly-row"><span>ID interno</span><code>{context?.organization?.id ?? '—'}</code></div>
          <div className="organization-readonly-row"><span>Slug</span><code>{context?.organization?.slug ?? '—'}</code></div>
          <div className="organization-readonly-row"><span>Escopo técnico legado</span><code>{context?.organization?.legacyScopeUsersId ?? '—'}</code></div>
          <p className="settings-note">O escopo técnico existe apenas para compatibilidade com módulos antigos. A propriedade canônica dos dados é da organização.</p>
          {canEdit ? <div><Button iconLeft={Save} loading={saving} disabled={!name.trim() || name.trim() === organizationName} onClick={() => void save()}>Salvar</Button></div> : <Tag tone="neutral">Somente leitura</Tag>}
        </div>
      </Panel>
    </div>
  );
}
