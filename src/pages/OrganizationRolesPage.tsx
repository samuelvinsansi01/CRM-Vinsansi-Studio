import { useEffect, useMemo, useState } from 'react';
import { CopyPlus, RefreshCcw, ShieldCheck } from 'lucide-react';
import { Button, ConfirmDialog, DataTable, Drawer, Field, FiltersBar, Panel, RowsPerPageControl, SearchInput, SelectField, TableCard, Tag, type TableColumn } from '../design-system/components';
import { useClientPagination } from '../hooks/useClientPagination';
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
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

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
  const visibleRoles = useMemo(() => roles.filter((role) => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return (!query || [role.name, role.description].some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(query)))
      && (typeFilter === 'all' || (typeFilter === 'system' ? role.systemTemplate : !role.systemTemplate));
  }), [roles, search, typeFilter]);
  const pagination = useClientPagination(visibleRoles, 20);
  const columns: TableColumn<Record<string, React.ReactNode>>[] = [
    { key: 'name', label: 'Função', render: (row) => <><strong>{row.name}</strong><span>{row.description}</span></> },
    { key: 'type', label: 'Tipo', render: (row) => <Tag tone={row.systemTemplate === 'true' ? 'primary' : 'neutral'}>{row.type}</Tag> },
    { key: 'memberCount', label: 'Membros' }, { key: 'permissionCount', label: 'Permissões' },
    { key: 'status', label: 'Status', render: (row) => <Tag tone={row.active === 'true' ? 'success' : 'neutral'}>{row.status}</Tag> },
  ];

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
        <div><Tag tone="warning">Gestor</Tag><p>Mantém o conjunto operacional e administrativo do CRM. A função atribuída pode acrescentar permissões, mas não remove esse mínimo.</p></div>
        <div><Tag tone="neutral">Membro</Tag><p>Recebe uma função, como SDR, e herda exatamente as permissões delegáveis daquela função.</p></div>
      </Panel>

      <FiltersBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar função" />
        <SelectField value={typeFilter} onChange={setTypeFilter} options={[{ label: 'Todos os tipos', value: 'all' }, { label: 'Predefinidas', value: 'system' }, { label: 'Personalizadas', value: 'custom' }]} />
      </FiltersBar>
      <TableCard title="Funções da organização" footerText={`${visibleRoles.length} função(ões)`} page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} footerLeft={<RowsPerPageControl value={pagination.rowsPerPage} onChange={pagination.setRowsPerPage} />}>
        {error ? <div className="configuration-state configuration-state--error">{error}</div> : null}
        {loading && !roles.length ? <div className="configuration-state">Carregando funções...</div> : null}
        {!loading && !visibleRoles.length ? <div className="configuration-state">Nenhuma função encontrada.</div> : null}
        {visibleRoles.length ? <DataTable selectable={false} columns={columns} rows={pagination.pageItems.map((role) => ({ id: role.id, name: role.name, description: role.description || 'Sem descrição.', systemTemplate: String(role.systemTemplate), type: role.systemTemplate ? 'Predefinida' : 'Personalizada', memberCount: role.memberCount, permissionCount: role.permissionKeys.length, active: String(role.active), status: role.active ? 'Ativa' : 'Inativa' }))} getRowActions={(row) => canManage ? ['edit', 'duplicate', ...(row.systemTemplate === 'false' && Number(row.memberCount) === 0 ? ['delete' as const] : [])] : []} onAction={(action, row) => { const role = roles.find((candidate) => candidate.id === row.id); if (!role) return; if (action === 'edit') openRole(role); if (action === 'duplicate') duplicateRole(role); if (action === 'delete') setDeleting(role); }} /> : null}
      </TableCard>

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
