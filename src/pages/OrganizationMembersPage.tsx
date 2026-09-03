import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, UserPlus, UsersRound } from 'lucide-react';
import { Button, ConfirmDialog, DataTable, Drawer, Field, FiltersBar, MetricCard, RowsPerPageControl, SearchInput, SelectField, TableCard, Tag, type TableAction, type TableColumn } from '../design-system/components';
import { useClientPagination } from '../hooks/useClientPagination';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useNotificationContext } from '../providers/NotificationProvider';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import {
  cancelOrganizationInvitation,
  inviteOrganizationMember,
  listOrganizationInvitations,
  listOrganizationMembers,
  listOrganizationRoles,
  setOrganizationMemberActive,
  transferOrganizationOwnership,
  updateOrganizationMember,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrganizationRole,
} from '../services/organization/organization.service';

function accessLabel(value: string) {
  if (value === 'owner') return 'Dono';
  if (value === 'manager') return 'Gestor';
  return 'Membro';
}

function accessTone(value: string): 'success' | 'warning' | 'neutral' {
  if (value === 'owner') return 'success';
  if (value === 'manager') return 'warning';
  return 'neutral';
}

function formatDate(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function OrganizationMembersPage() {
  const { organizationName, accessLevel, isPlatformOwner, refreshOrganization } = useOrganizationContext();
  const { push } = useNotificationContext();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [roles, setRoles] = useState<OrganizationRole[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLevel, setInviteLevel] = useState<'manager' | 'member'>('member');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [savingInvite, setSavingInvite] = useState(false);
  const [editMember, setEditMember] = useState<OrganizationMember | null>(null);
  const [editLevel, setEditLevel] = useState<'manager' | 'member'>('member');
  const [editRoleId, setEditRoleId] = useState('');
  const [savingMember, setSavingMember] = useState(false);
  const [deactivateMember, setDeactivateMember] = useState<OrganizationMember | null>(null);
  const [reassignMemberId, setReassignMemberId] = useState('');
  const [workingId, setWorkingId] = useState('');
  const [transferTarget, setTransferTarget] = useState<OrganizationMember | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const canManage = isPlatformOwner || accessLevel === 'owner' || accessLevel === 'manager';
  const canPromoteManager = isPlatformOwner || accessLevel === 'owner';
  const canTransferOwnership = isPlatformOwner || accessLevel === 'owner';

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextMembers, nextRoles, nextInvites] = await Promise.all([
        listOrganizationMembers(),
        listOrganizationRoles(),
        listOrganizationInvitations(),
      ]);
      setMembers(nextMembers);
      setRoles(nextRoles.filter((role) => role.active));
      setInvitations(nextInvites);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar membros.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [organizationName]);

  const activeMembers = members.filter((member) => member.active);
  const visibleMembers = useMemo(() => members.filter((member) => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    const matchesSearch = !query || [member.name, member.email, member.roleName, accessLabel(member.accessLevel)].some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(query));
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? member.active : !member.active);
    return matchesSearch && matchesStatus;
  }), [members, search, statusFilter]);
  const memberPagination = useClientPagination(visibleMembers, 20);
  const invitationPagination = useClientPagination(invitations, 20);
  const memberOptions = activeMembers
    .filter((member) => member.id !== deactivateMember?.id)
    .map((member) => ({ label: `${member.name} • ${member.roleName ?? accessLabel(member.accessLevel)}`, value: member.id }));

  const roleOptions = useMemo(() => roles.filter((role) => role.assignable).map((role) => ({ label: role.name, value: role.id })), [roles]);
  const defaultRoleFor = (level: 'manager' | 'member') => roles.find((role) => role.key === (level === 'manager' ? 'gestor' : 'sdr'))?.id ?? roles[0]?.id ?? '';
  const memberColumns: TableColumn<Record<string, React.ReactNode>>[] = [
    { key: 'member', label: 'Membro', render: (row) => <><strong>{row.name}</strong><span>{row.email}</span></> },
    { key: 'level', label: 'Nível', render: (row) => <Tag tone={accessTone(String(row.accessLevel))}>{row.level}</Tag> },
    { key: 'role', label: 'Função' },
    { key: 'status', label: 'Status', render: (row) => <Tag tone={row.active === 'true' ? 'success' : 'neutral'}>{row.status}</Tag> },
    { key: 'joinedAt', label: 'Entrada' },
  ];
  const invitationColumns: TableColumn<Record<string, React.ReactNode>>[] = [
    { key: 'email', label: 'E-mail', render: (row) => <strong>{row.email}</strong> },
    { key: 'level', label: 'Nível' }, { key: 'role', label: 'Função' },
    { key: 'status', label: 'Status', render: (row) => <Tag tone={row.status === 'pending' ? 'warning' : row.status === 'accepted' ? 'success' : 'neutral'}>{row.status}</Tag> },
    { key: 'expiresAt', label: 'Expira em' },
  ];

  const openInvite = () => {
    setInviteEmail('');
    setInviteLevel('member');
    setInviteRoleId(defaultRoleFor('member'));
    setInviteOpen(true);
  };

  const handleInvite = async () => {
    setSavingInvite(true);
    try {
      const result = await inviteOrganizationMember({ email: inviteEmail, accessLevel: inviteLevel, roleId: inviteRoleId || null });
      const existing = Boolean(result.existing_account);
      push({ type: 'success', message: existing ? 'Convite registrado. O usuário já possui conta e entrará na organização no próximo login.' : 'Convite enviado com sucesso.' });
      setInviteOpen(false);
      await refresh();
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao convidar membro.' });
    } finally {
      setSavingInvite(false);
    }
  };

  const openEdit = (member: OrganizationMember) => {
    setEditMember(member);
    setEditLevel(member.accessLevel === 'manager' ? 'manager' : 'member');
    setEditRoleId(member.roleId ?? defaultRoleFor(member.accessLevel === 'manager' ? 'manager' : 'member'));
  };

  const handleSaveMember = async () => {
    if (!editMember) return;
    setSavingMember(true);
    try {
      await updateOrganizationMember({ memberId: editMember.id, accessLevel: editLevel, roleId: editRoleId || null });
      push({ type: 'success', message: 'Acesso do membro atualizado.' });
      setEditMember(null);
      await refresh();
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao atualizar membro.' });
    } finally {
      setSavingMember(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateMember) return;
    setWorkingId(deactivateMember.id);
    try {
      await setOrganizationMemberActive({ memberId: deactivateMember.id, active: false, reassignToMemberId: reassignMemberId || null });
      push({ type: 'success', message: `${deactivateMember.name} foi desativado. A autoria histórica foi preservada.` });
      setDeactivateMember(null);
      setReassignMemberId('');
      await refresh();
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao desativar membro.' });
    } finally {
      setWorkingId('');
    }
  };

  const handleReactivate = async (member: OrganizationMember) => {
    setWorkingId(member.id);
    try {
      await setOrganizationMemberActive({ memberId: member.id, active: true });
      push({ type: 'success', message: `${member.name} foi reativado.` });
      await refresh();
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao reativar membro.' });
    } finally {
      setWorkingId('');
    }
  };

  const handleTransferOwnership = async () => {
    if (!transferTarget) return;
    setWorkingId(transferTarget.id);
    try {
      await transferOrganizationOwnership(transferTarget.id);
      push({ type: 'success', message: `A propriedade da organização foi transferida para ${transferTarget.name}.` });
      setTransferTarget(null);
      await refreshOrganization();
      await refresh();
    } catch (cause) {
      push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao transferir propriedade.' });
    } finally {
      setWorkingId('');
    }
  };

  return (
    <div className="organization-page">
      <PageHeader
        title="Membros"
        description={`Pessoas da ${organizationName || 'organização'}. Recursos pertencem à organização; o membro apenas recebe acesso e autoria.`}
        action={<div className="organization-page__actions"><Button variant="secondary" iconLeft={RefreshCcw} loading={loading} onClick={() => void refresh()}>Atualizar</Button>{canManage ? <Button iconLeft={UserPlus} onClick={openInvite}>Adicionar membro</Button> : null}</div>}
      />

      <section className="metric-grid metric-grid--3">
        <MetricCard icon={UsersRound} value={String(activeMembers.length)} label="Membros ativos" tone="primary" />
        <MetricCard value={String(activeMembers.filter((m) => m.accessLevel === 'manager').length)} label="Gestores" tone="warning" />
        <MetricCard value={String(invitations.filter((item) => item.status === 'pending').length)} label="Convites pendentes" />
      </section>

      <FiltersBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome, e-mail ou função" />
        <SelectField value={statusFilter} onChange={setStatusFilter} options={[{ label: 'Todos os status', value: 'all' }, { label: 'Ativos', value: 'active' }, { label: 'Inativos', value: 'inactive' }]} />
      </FiltersBar>

      <TableCard title="Membros da organização" footerText={`${visibleMembers.length} membro(s)`} page={memberPagination.page} totalPages={memberPagination.totalPages} onPageChange={memberPagination.setPage} footerLeft={<RowsPerPageControl value={memberPagination.rowsPerPage} onChange={memberPagination.setRowsPerPage} />}>
        {error ? <div className="configuration-state configuration-state--error">{error}</div> : null}
        {loading && !members.length ? <div className="configuration-state">Carregando membros...</div> : null}
        {!loading && !visibleMembers.length ? <div className="configuration-state">Nenhum membro encontrado.</div> : null}
        {visibleMembers.length ? <DataTable selectable={false} columns={memberColumns} rows={memberPagination.pageItems.map((member) => ({ id: member.id, name: member.name, email: member.email || '—', accessLevel: member.accessLevel, level: accessLabel(member.accessLevel), role: member.roleName || (member.accessLevel === 'owner' ? 'Acesso total' : '—'), active: String(member.active), status: member.active ? 'Ativo' : 'Inativo', joinedAt: formatDate(member.joinedAt) }))} getRowActions={(row) => {
          const member = members.find((item) => item.id === row.id); if (!member) return [];
          const editable = canManage && member.accessLevel !== 'owner' && (accessLevel !== 'manager' || member.accessLevel === 'member');
          return [...(editable ? [member.active ? 'edit' : 'activate', ...(member.active ? ['deactivate' as TableAction] : [])] : []), ...(canTransferOwnership && member.active && member.accessLevel !== 'owner' ? ['ownership' as TableAction] : [])] as TableAction[];
        }} onAction={(action, row) => { const member = members.find((item) => item.id === row.id); if (!member) return; if (action === 'edit') openEdit(member); if (action === 'deactivate') { setDeactivateMember(member); setReassignMemberId(''); } if (action === 'activate') void handleReactivate(member); if (action === 'ownership') setTransferTarget(member); }} /> : null}
      </TableCard>

      <TableCard title="Convites" footerText={`${invitations.length} convite(s)`} page={invitationPagination.page} totalPages={invitationPagination.totalPages} onPageChange={invitationPagination.setPage} footerLeft={<RowsPerPageControl value={invitationPagination.rowsPerPage} onChange={invitationPagination.setRowsPerPage} />}>
        {!invitations.length ? <div className="configuration-state">Nenhum convite registrado.</div> : (
          <DataTable selectable={false} columns={invitationColumns} rows={invitationPagination.pageItems.map((invite) => ({ id: invite.id, email: invite.email, level: accessLabel(invite.accessLevel), role: invite.roleName ?? '—', status: invite.status, expiresAt: formatDate(invite.expiresAt) }))} getRowActions={(row) => canManage && row.status === 'pending' ? ['cancel'] : []} onAction={(_, row) => void cancelOrganizationInvitation(String(row.id)).then(refresh).catch((cause) => push({ type: 'error', message: cause instanceof Error ? cause.message : 'Falha ao cancelar convite.' }))} />
        )}
      </TableCard>

      <Drawer
        open={inviteOpen}
        title="Adicionar membro"
        description="O convite já define o nível e a função que serão aplicados no primeiro acesso."
        onClose={() => setInviteOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancelar</Button><Button loading={savingInvite} disabled={!inviteEmail.trim()} onClick={() => void handleInvite()}>Enviar convite</Button></>}
      >
        <div className="organization-form-stack">
          <Field label="E-mail" type="email" placeholder="nome@empresa.com" value={inviteEmail} onChange={setInviteEmail} />
          <label className="organization-field-label">Nível de acesso</label>
          <SelectField
            value={inviteLevel}
            onChange={(value) => {
              const next = value as 'manager' | 'member';
              setInviteLevel(next);
              setInviteRoleId(defaultRoleFor(next));
            }}
            options={canPromoteManager ? [{ label: 'Membro', value: 'member' }, { label: 'Gestor', value: 'manager' }] : [{ label: 'Membro', value: 'member' }]}
          />
          <label className="organization-field-label">Função</label>
          <SelectField value={inviteRoleId} onChange={setInviteRoleId} options={roleOptions} searchable />
          <p className="settings-note">Gestores sempre mantêm os poderes mínimos de gestão de membros, mesmo que a função atribuída seja alterada.</p>
        </div>
      </Drawer>

      <Drawer
        open={Boolean(editMember)}
        title={`Editar ${editMember?.name ?? 'membro'}`}
        description="A alteração vale imediatamente para novas ações do membro."
        onClose={() => setEditMember(null)}
        footer={<><Button variant="secondary" onClick={() => setEditMember(null)}>Cancelar</Button><Button loading={savingMember} onClick={() => void handleSaveMember()}>Salvar</Button></>}
      >
        <div className="organization-form-stack">
          <label className="organization-field-label">Nível de acesso</label>
          <SelectField
            value={editLevel}
            onChange={(value) => { const next = value as 'manager' | 'member'; setEditLevel(next); setEditRoleId(defaultRoleFor(next)); }}
            options={canPromoteManager ? [{ label: 'Membro', value: 'member' }, { label: 'Gestor', value: 'manager' }] : [{ label: 'Membro', value: 'member' }]}
          />
          <label className="organization-field-label">Função</label>
          <SelectField value={editRoleId} onChange={setEditRoleId} options={roleOptions} searchable />
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deactivateMember)}
        title={`Desativar ${deactivateMember?.name ?? 'membro'}?`}
        description="O acesso será revogado. Capturas, disparos e respostas históricas continuarão atribuídos ao membro. Responsabilidades atuais podem ser transferidas."
        danger
        confirmLabel="Desativar membro"
        onClose={() => setDeactivateMember(null)}
        onConfirm={() => void handleDeactivate()}
      >
        <div className="organization-dialog-field">
          <span>Transferir leads/conversas responsáveis para</span>
          <SelectField value={reassignMemberId} onChange={setReassignMemberId} placeholder="Deixar sem responsável" options={[{ label: 'Deixar sem responsável', value: '' }, ...memberOptions]} searchable />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(transferTarget)}
        title={`Transferir a propriedade para ${transferTarget?.name ?? 'este membro'}?`}
        description="O novo Dono terá autoridade total sobre a organização. O Dono atual passa a Gestor. Esta operação é auditada."
        confirmLabel="Transferir propriedade"
        onClose={() => setTransferTarget(null)}
        onConfirm={() => void handleTransferOwnership()}
      />
    </div>
  );
}
