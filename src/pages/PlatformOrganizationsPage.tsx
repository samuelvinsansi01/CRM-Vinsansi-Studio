import { useEffect, useState } from 'react';
import { Building2, Plus, RefreshCcw } from 'lucide-react';
import { Button, ConfirmDialog, Drawer, Field, MetricCard, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useNotificationContext } from '../providers/NotificationProvider';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import {
  createOrganization,
  listPlatformOrganizations,
  setPlatformOrganizationActive,
  type PlatformOrganization,
} from '../services/organization/organization.service';

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function PlatformOrganizationsPage() {
  const { isPlatformOwner, switchOrganization, refreshOrganization } = useOrganizationContext();
  const { push } = useNotificationContext();
  const [items, setItems] = useState<PlatformOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<PlatformOrganization | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try { setItems(await listPlatformOrganizations()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao carregar organizações.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (isPlatformOwner) void refresh(); }, [isPlatformOwner]);

  if (!isPlatformOwner) {
    return <div className="configuration-state configuration-state--error">Acesso exclusivo do Platform Owner.</div>;
  }

  const create = async () => {
    setSaving(true);
    try {
      await createOrganization(name);
      setCreateOpen(false);
      setName('');
      await refreshOrganization();
      await refresh();
      push({ type: 'success', message: 'Organização criada. Você é o Dono inicial até transferir a propriedade.' });
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao criar organização.' });
    } finally { setSaving(false); }
  };

  const toggle = async () => {
    if (!toggleTarget) return;
    setSaving(true);
    try {
      await setPlatformOrganizationActive(toggleTarget.id, !toggleTarget.active);
      push({ type: 'success', message: `Organização ${toggleTarget.active ? 'desativada' : 'reativada'}.` });
      setToggleTarget(null);
      await refresh();
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao alterar organização.' });
    } finally { setSaving(false); }
  };

  return (
    <div className="organization-page">
      <PageHeader
        title="Organizações da plataforma"
        description="Administração global exclusiva do Platform Owner. Donos de organizações não acessam esta área."
        action={<div className="organization-page__actions"><Button variant="secondary" iconLeft={RefreshCcw} loading={loading} onClick={() => void refresh()}>Atualizar</Button><Button iconLeft={Plus} onClick={() => setCreateOpen(true)}>Nova organização</Button></div>}
      />
      <section className="metric-grid metric-grid--3">
        <MetricCard icon={Building2} value={String(items.filter((item) => item.active).length)} label="Organizações ativas" tone="primary" />
        <MetricCard value={String(items.reduce((sum, item) => sum + item.memberCount, 0))} label="Membros ativos" />
        <MetricCard value={String(items.length)} label="Total cadastrado" />
      </section>
      <Panel title="Organizações" className="organization-panel">
        {error ? <div className="configuration-state configuration-state--error">{error}</div> : null}
        {loading && !items.length ? <div className="configuration-state">Carregando organizações...</div> : null}
        {items.length ? <div className="organization-table-wrap"><table className="organization-table">
          <thead><tr><th>Organização</th><th>Dono</th><th>Membros</th><th>Status</th><th>Criada em</th><th>Ações</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}>
            <td><strong>{item.name}</strong><span>ID {item.id}</span></td>
            <td><strong>{item.ownerName || '—'}</strong><span>{item.ownerEmail || '—'}</span></td>
            <td>{item.memberCount}</td>
            <td><Tag tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Ativa' : 'Inativa'}</Tag></td>
            <td>{formatDate(item.createdAt)}</td>
            <td><div className="organization-table__actions">
              {item.active ? <Button size="sm" variant="secondary" onClick={() => void switchOrganization(item.id)}>Abrir</Button> : null}
              <Button size="sm" variant={item.active ? 'danger' : 'ghost'} onClick={() => setToggleTarget(item)}>{item.active ? 'Desativar' : 'Reativar'}</Button>
            </div></td>
          </tr>)}</tbody>
        </table></div> : null}
      </Panel>

      <Drawer open={createOpen} title="Nova organização" description="A organização nasce isolada, com funções Gestor e SDR predefinidas. Você será o Dono inicial." onClose={() => setCreateOpen(false)} footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button loading={saving} disabled={!name.trim()} onClick={() => void create()}>Criar organização</Button></>}>
        <div className="organization-form-stack"><Field label="Nome da organização" value={name} onChange={setName} placeholder="Ex.: Prospect Pro" /></div>
      </Drawer>

      <ConfirmDialog open={Boolean(toggleTarget)} title={`${toggleTarget?.active ? 'Desativar' : 'Reativar'} ${toggleTarget?.name ?? 'organização'}?`} description={toggleTarget?.active ? 'A organização deixa de operar até ser reativada. Os dados e a auditoria permanecem preservados.' : 'O acesso da organização será restaurado.'} danger={Boolean(toggleTarget?.active)} confirmLabel={toggleTarget?.active ? 'Desativar organização' : 'Reativar organização'} onClose={() => setToggleTarget(null)} onConfirm={() => void toggle()} />
    </div>
  );
}
