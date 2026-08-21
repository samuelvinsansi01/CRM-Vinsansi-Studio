import { useEffect, useMemo, useState } from 'react';
import { CopyPlus, RefreshCcw, ShieldCheck } from 'lucide-react';
import { Button, ConfirmDialog, Drawer, Field, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useNotificationContext } from '../providers/NotificationProvider';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import {
  deleteOrganizationRole,
  listDelegablePermissions,
  listOrganizationRoles,
  saveOrganizationRole,
  type OrganizationRole,
  type PermissionOption,
} from '../services/organization/organization.service';

export function OrganizationRolesPage() {
  const { organizationName, accessLevel, isPlatformOwner } = useOrganizationContext();
  const { push } = useNotificationContext();
  const [roles, setRoles] = useState<OrganizationRole[]>([]);
  const [permissions, setPermissions] = useState<PermissionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrganizationRole | null | 'new'>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<OrganizationRole | null>(null);

  const canManage = isPlatformOwner || accessLevel === 'owner';

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextRoles, nextPermissions] = await Promise.all([listOrganizationRoles(), listDelegablePermissions()]);
      setRoles(nextRoles);
      setPermissions(nextPermissions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar funções.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [organizationName]);

  const grouped = useMemo(() => {
    const result = new Map<string, PermissionOption[]>();
    for (const permission of permissions) {
      const current = result.get(permission.category) ?? [];
      current.push(permission);
      result.set(permission.category, current);
    }
    return [...result.entries()];
  }, [permissions]);

  const openRole = (role?: OrganizationRole) => {
    setEditing(role ?? 'new');
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(new Set(role?.permissionKeys ?? []));
  };

  const duplicateRole = (role: OrganizationRole) => {
    setEditing('new');
    setName(`${role.name} - Cópia`);
    setDescription(role.description);
    setSelected(new Set(role.permissionKeys));
  };

  const togglePermission = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveOrganizationRole({
        id: editing && editing !== 'new' ? editing.id : null,
        name,
        description,
        permissionKeys: [...selected],
      });
      push({ type: 'success', message: 'Função e permissões salvas.' });
      setEditing(null);
      await refresh();
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao salvar função.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await deleteOrganizationRole(deleting.id);
      push({ type: 'success', message: 'Função excluída.' });
      setDeleting(null);
      await refresh();
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao excluir função.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="organization-page">
      <PageHeader
        title="Funções e acessos"
        description={`Funções da ${organizationName || 'organização'} são pacotes de permissões. Dono e Gestor continuam níveis hierárquicos protegidos.`}
        action={<div className="organization-page__actions"><Button variant="secondary" iconLeft={RefreshCcw} loading={loading} onClick={() => void refresh()}>Atualizar</Button>{canManage ? <Button iconLeft={CopyPlus} onClick={() => openRole()}>Nova função</Button> : null}</div>}
      />

      <Panel title="Modelo de acesso" className="organization-panel organization-access-summary">
        <div><Tag tone="success">Dono</Tag><p>Acesso total à organização. Propriedade só muda pelo fluxo de transferência.</p></div>
        <div><Tag tone="warning">Gestor</Tag><p>Mantém poderes mínimos de gestão de membros e pode receber uma função com permissões operacionais adicionais.</p></div>
        <div><Tag tone="neutral">Membro</Tag><p>Recebe uma função, como SDR, e herda exatamente as permissões delegáveis daquela função.</p></div>
      </Panel>

      {error ? <div className="configuration-state configuration-state--error">{error}</div> : null}
      {loading && !roles.length ? <div className="configuration-state">Carregando funções...</div> : null}

      <div className="organization-role-grid">
        {roles.map((role) => (
          <Panel key={role.id} className="organization-role-card" title={role.name} actions={role.systemTemplate ? <Tag tone="primary">Predefinida</Tag> : <Tag tone="neutral">Personalizada</Tag>}>
            <p>{role.description || 'Sem descrição.'}</p>
            <div className="organization-role-card__meta"><span><strong>{role.memberCount}</strong> membro(s)</span><span><strong>{role.permissionKeys.length}</strong> permissões</span></div>
            <div className="organization-role-card__actions">
              <Button size="sm" variant="secondary" disabled={!canManage} onClick={() => openRole(role)}>Editar</Button>
              <Button size="sm" variant="ghost" disabled={!canManage} onClick={() => duplicateRole(role)}>Duplicar</Button>
              {!role.systemTemplate ? <Button size="sm" variant="danger" disabled={!canManage || role.memberCount > 0} onClick={() => setDeleting(role)}>Excluir</Button> : null}
            </div>
          </Panel>
        ))}
      </div>

      <Drawer
        open={Boolean(editing)}
        size="wide"
        title={editing === 'new' ? 'Nova função' : `Editar ${editing?.name ?? 'função'}`}
        description="Alterar uma função atualiza imediatamente as permissões efetivas de todos os membros que a utilizam."
        onClose={() => setEditing(null)}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={saving} disabled={!name.trim()} onClick={() => void handleSave()}>Salvar função</Button></>}
      >
        <div className="organization-form-stack">
          <Field label="Nome da função" value={name} onChange={setName} placeholder="Ex.: SDR Sênior" />
          <Field label="Descrição" as="textarea" rows={3} value={description} onChange={setDescription} placeholder="Explique quando esta função deve ser usada." />
          <div className="organization-permissions-header"><div><ShieldCheck size={18} /><strong>Permissões</strong></div><span>{selected.size} selecionada(s)</span></div>
          <div className="organization-permission-groups">
            {grouped.map(([category, items]) => (
              <section key={category} className="organization-permission-group">
                <h3>{category}</h3>
                <div>{items.map((permission) => (
                  <label key={permission.key} className="organization-permission-option">
                    <input type="checkbox" checked={selected.has(permission.key)} onChange={() => togglePermission(permission.key)} />
                    <span><strong>{permission.name}</strong><small>{permission.description}</small></span>
                  </label>
                ))}</div>
              </section>
            ))}
          </div>
          <p className="settings-note">Permissões exclusivas do Dono e do Platform Owner não aparecem nesta lista e não podem ser concedidas por função.</p>
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Excluir ${deleting?.name ?? 'função'}?`}
        description="A função só pode ser excluída quando nenhum membro estiver associado a ela."
        danger
        confirmLabel="Excluir função"
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
