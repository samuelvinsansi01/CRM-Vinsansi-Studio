import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Database, Plus, RefreshCcw, SquareCheck, Wifi } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  FiltersBar,
  MetricCard,
  RowsPerPageControl,
  SearchInput,
  SelectField,
  TableCard,
  Tag,
  ToastViewport,
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useApifyAccounts } from '../hooks/useApifyAccounts';
import type { ApifyAccount } from '../services/apify-accounts';
import { useClientPagination } from '../hooks/useClientPagination';

type AccountRow = Record<string, ReactNode> & { id: string };

type AccountFilter = 'Todos' | 'Ativas' | 'Desativadas' | 'Conectadas' | 'Com erro' | 'Não verificadas';

const statusOptions = [
  { label: 'Todos', value: 'Todos' },
  { label: 'Ativas', value: 'Ativas' },
  { label: 'Desativadas', value: 'Desativadas' },
  { label: 'Conectadas', value: 'Conectadas' },
  { label: 'Com erro', value: 'Com erro' },
  { label: 'Não verificadas', value: 'Não verificadas' },
];

const columns: TableColumn<AccountRow>[] = [
  { key: 'name', label: 'Conta', width: '24%' },
  { key: 'token', label: 'Token', width: '15%' },
  { key: 'connection', label: 'Conexão', width: '15%' },
  { key: 'username', label: 'Usuário Apify', width: '18%' },
  { key: 'lastChecked', label: 'Última verificação', width: '18%' },
  { key: 'status', label: 'Status', width: '10%' },
];

function formatDate(value: string | null) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function connectionTag(account: ApifyAccount, checking: boolean) {
  if (checking) return <Tag tone="neutral">Testando...</Tag>;
  if (account.connectionStatus === 'connected') return <Tag tone="success">Conectada</Tag>;
  if (account.connectionStatus === 'error') return <Tag tone="danger">Com erro</Tag>;
  return <Tag tone="neutral">Não verificada</Tag>;
}

function statusTag(active: boolean) {
  return <Tag tone={active ? 'success' : 'warning'}>{active ? 'Ativa' : 'Desativada'}</Tag>;
}

export function ApifyAccountsPage() {
  const { accounts, loading, saving, checkingId, error, refresh, save, check, remove } = useApifyAccounts();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ApifyAccount | null>(null);
  const [deleting, setDeleting] = useState<ApifyAccount | null>(null);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [active, setActive] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AccountFilter>('Todos');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3600);
  };

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return accounts.filter((account) => {
      const matchesSearch = !query || [
        account.name,
        account.externalUsername,
        account.tokenMask,
        account.lastError,
      ].some((value) => value.toLocaleLowerCase('pt-BR').includes(query));

      const matchesStatus = status === 'Todos'
        || (status === 'Ativas' && account.active)
        || (status === 'Desativadas' && !account.active)
        || (status === 'Conectadas' && account.connectionStatus === 'connected')
        || (status === 'Com erro' && account.connectionStatus === 'error')
        || (status === 'Não verificadas' && account.connectionStatus === 'not_verified');

      return matchesSearch && matchesStatus;
    });
  }, [accounts, search, status]);

  const rows = useMemo<AccountRow[]>(() => filteredAccounts.map((account) => ({
    id: String(account.id),
    name: account.name,
    token: <code>{account.tokenMask || 'Protegido'}</code>,
    connection: connectionTag(account, checkingId === account.id),
    username: account.externalUsername || '—',
    lastChecked: formatDate(account.lastCheckedAt),
    status: statusTag(account.active),
  })), [checkingId, filteredAccounts]);

  const {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    totalPages,
    pageItems,
    resetPage,
  } = useClientPagination(rows, 20);

  const activeCount = accounts.filter((account) => account.active).length;
  const connectedCount = accounts.filter((account) => account.connectionStatus === 'connected').length;

  const resetForm = () => {
    setEditing(null);
    setName('');
    setToken('');
    setActive(true);
  };

  const openCreate = () => {
    resetForm();
    setDrawerOpen(true);
  };

  const openEdit = (account: ApifyAccount) => {
    setEditing(account);
    setName(account.name);
    setToken('');
    setActive(account.active);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    resetForm();
  };

  const submit = async () => {
    if (!name.trim()) {
      pushToast({ title: 'Nome obrigatório', description: 'Informe o nome da conta Apify.', tone: 'warning' });
      return;
    }
    if (!editing && !token.trim()) {
      pushToast({ title: 'Token obrigatório', description: 'Informe o token da conta Apify.', tone: 'warning' });
      return;
    }

    try {
      const wasEditing = Boolean(editing);
      const savedId = await save({ id: editing?.id, name, token: token || undefined, active });
      closeDrawer();
      if (!active) {
        pushToast({ title: wasEditing ? 'Conta atualizada' : 'Conta adicionada', description: 'A conta foi salva desativada.', tone: 'success' });
        return;
      }
      try {
        const result = await check(savedId);
        pushToast({
          title: wasEditing ? 'Conta atualizada e verificada' : 'Conta adicionada e verificada',
          description: result.username ? `Conectada como ${result.username}.` : 'Token validado com sucesso na Apify.',
          tone: 'success',
        });
      } catch (checkError) {
        pushToast({
          title: 'Conta salva, mas não conectada',
          description: checkError instanceof Error ? checkError.message : 'Teste o token novamente.',
          tone: 'warning',
        });
      }
    } catch (cause) {
      pushToast({ title: 'Não foi possível salvar', description: cause instanceof Error ? cause.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const checkAccount = async (account: ApifyAccount) => {
    try {
      const result = await check(account.id);
      pushToast({ title: 'Conta conectada', description: result.username ? `Token válido para ${result.username}.` : 'Token validado com sucesso na Apify.', tone: 'success' });
    } catch (cause) {
      pushToast({ title: 'Falha na conexão Apify', description: cause instanceof Error ? cause.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting.id);
      pushToast({ title: 'Conta removida', description: 'A conexão Apify foi removida.', tone: 'success' });
    } catch (cause) {
      pushToast({ title: 'Não foi possível remover', description: cause instanceof Error ? cause.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setDeleting(null);
    }
  };

  const onAction = (action: TableAction, row: AccountRow) => {
    const account = accounts.find((item) => item.id === Number(row.id));
    if (!account) return;
    if (action === 'edit') openEdit(account);
    if (action === 'test') void checkAccount(account);
    if (action === 'delete') setDeleting(account);
  };

  return (
    <div className="config-table-page configuration-crud-page apify-accounts-page">
      <PageHeader
        title="Contas Apify"
        description="Cadastre, teste e gerencie as contas usadas nas importações do Google Maps."
        action={<Button iconLeft={Plus} size="lg" onClick={openCreate}>Adicionar conta</Button>}
      />

      <section className="metric-grid metric-grid--3">
        <MetricCard icon={Database} value={String(accounts.length)} label="Total" />
        <MetricCard icon={SquareCheck} value={String(activeCount)} label="Ativas" tone="success" />
        <MetricCard icon={Wifi} value={String(connectedCount)} label="Conectadas" tone="primary" />
      </section>

      <FiltersBar>
        <SearchInput value={search} placeholder="Buscar contas" onChange={(value) => { setSearch(value); resetPage(); }} />
        <SelectField value={status} options={statusOptions} onChange={(value) => { setStatus(value as AccountFilter); resetPage(); }} />
        <Button variant="secondary" iconLeft={RefreshCcw} loading={loading} onClick={() => void refresh()}>Atualizar</Button>
      </FiltersBar>

      <TableCard
        title="Contas cadastradas"
        footerText={`Mostrando ${pageItems.length} de ${filteredAccounts.length} conta(s); ${accounts.length} no total.`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="configuration-state configuration-state--error">{error}</div> : null}
        {loading && !accounts.length ? <div className="configuration-state">Carregando contas...</div> : null}
        {!loading && !error && !rows.length ? <div className="configuration-state">Nenhuma conta Apify encontrada.</div> : null}
        {!error && pageItems.length ? (
          <DataTable<AccountRow>
            rows={pageItems}
            columns={columns}
            actions={['test', 'edit', 'delete']}
            selectable={false}
            onAction={onAction}
          />
        ) : null}
      </TableCard>

      <Drawer
        open={drawerOpen}
        title={editing ? 'Editar conta Apify' : 'Adicionar conta Apify'}
        description={editing ? 'Altere os dados da conta. Deixe o token vazio para preservar a credencial atual.' : 'Informe os dados da conta que será usada manualmente nas coletas.'}
        onClose={closeDrawer}
        footer={(
          <>
            <Button variant="secondary" onClick={closeDrawer}>Cancelar</Button>
            <Button loading={saving} disabled={!name.trim() || (!editing && !token.trim())} onClick={() => void submit()}>Salvar</Button>
          </>
        )}
      >
        <div className="drawer-form">
          <Field label="Nome da conta" placeholder="Ex.: Apify principal" value={name} onChange={setName} />
          <Field
            label={editing ? 'Novo token (opcional)' : 'Token Apify'}
            type="password"
            autoComplete="new-password"
            placeholder={editing ? 'Deixe vazio para manter o token atual' : 'apify_api_...'}
            value={token}
            onChange={setToken}
          />
          <label className="field">
            <span className="field__label">Status</span>
            <SelectField
              value={String(active)}
              options={[{ label: 'Ativa', value: 'true' }, { label: 'Desativada', value: 'false' }]}
              onChange={(value) => setActive(value === 'true')}
            />
          </label>
          <p className="configuration-form-note">O token permanece protegido e nunca é exibido integralmente na listagem.</p>
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remover conta Apify?"
        description="A remoção será bloqueada quando a conta possuir histórico de coletas. Nesse caso, desative-a."
        confirmLabel="Remover"
        danger
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
