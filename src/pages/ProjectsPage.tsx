import { CalendarDays, CircleCheck, DollarSign, FolderOpen, RefreshCcw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
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
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { projectsRepository } from '../repositories/projects';
import {
  PAYMENT_TERMS_LABELS,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGES,
  type CrmProject,
  type PaymentTerms,
  type ProjectFinancialInput,
  type ProjectStage,
  type ProjectSummary,
} from '../services/projects/project.types';

type Row = Record<string, ReactNode> & { id: string };
type ProjectForm = {
  stage: ProjectStage;
  stageStartedOn: string;
  stageDueOn: string;
  projectStartDate: string;
  projectDueDate: string;
  totalValue: string;
  paymentTerms: PaymentTerms | '';
  firstPaymentDueDate: string;
  secondPaymentDueDate: string;
};

const EMPTY_SUMMARY: ProjectSummary = { total: 0, active: 0, delivered: 0, overdue: 0, dueThisWeek: 0, totalValue: 0, received: 0, receivable: 0 };

function dateOnly(value?: string) {
  if (!value) return '—';
  const raw = value.slice(0, 10);
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return '—';
  return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day));
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function paymentTone(status: CrmProject['paymentStatus']) {
  if (status === 'pago') return 'success' as const;
  if (status === 'atrasado') return 'danger' as const;
  if (status === 'parcial') return 'warning' as const;
  return 'neutral' as const;
}

function paymentLabel(status: CrmProject['paymentStatus']) {
  return ({ nao_configurado: 'Não configurado', pendente: 'Pendente', parcial: 'Parcial', pago: 'Pago', atrasado: 'Atrasado' } as const)[status];
}

function toForm(project: CrmProject): ProjectForm {
  return {
    stage: project.stage,
    stageStartedOn: project.stageStartedOn,
    stageDueOn: project.stageDueOn,
    projectStartDate: project.projectStartDate,
    projectDueDate: project.projectDueDate,
    totalValue: project.totalValue > 0 ? String(project.totalValue) : '',
    paymentTerms: project.paymentTerms ?? '',
    firstPaymentDueDate: project.firstPaymentDueDate,
    secondPaymentDueDate: project.secondPaymentDueDate,
  };
}

export function ProjectsPage() {
  const { hasPermission } = useOrganizationContext();
  const canEdit = hasPermission('leads.edit');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [stage, setStage] = useState<ProjectStage | ''>('');
  const [status, setStatus] = useState<'ativos' | 'entregues' | 'atrasados' | ''>('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [items, setItems] = useState<CrmProject[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ProjectSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<CrmProject | null>(null);
  const [form, setForm] = useState<ProjectForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const requestRef = useRef(0);

  const toast = (item: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [{ id, ...item }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((currentToast) => currentToast.id !== id)), 3800);
  };

  const load = useCallback(async (mode: 'load' | 'refresh' = 'load') => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (mode === 'load') setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const result = await projectsRepository.page({ search: debouncedSearch, stage, status }, page, rowsPerPage);
      if (requestRef.current !== requestId) return;
      setItems(result.items);
      setTotal(result.total);
      setSummary(result.summary);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os projetos.');
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [debouncedSearch, page, rowsPerPage, stage, status]);

  useEffect(() => { void load('load'); }, [load]);
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const columns: TableColumn<Row>[] = [
    { key: 'company', label: 'Empresa', width: '18%' },
    { key: 'stage', label: 'Etapa', width: '17%' },
    { key: 'stageDue', label: 'Prazo da etapa', width: '11%' },
    { key: 'delivery', label: 'Entrega do projeto', width: '11%' },
    { key: 'value', label: 'Valor', width: '11%' },
    { key: 'received', label: 'Recebido', width: '11%' },
    { key: 'receivable', label: 'A receber', width: '11%' },
    { key: 'payment', label: 'Pagamento', width: '11%' },
  ];

  const rows = useMemo<Row[]>(() => items.map((project) => ({
    id: project.id,
    company: project.alternativeName ? <span title={`Nome original: ${project.company}`}><strong>{project.alternativeName}</strong></span> : project.company,
    stage: <Tag tone={project.stage === 'entregue' ? 'success' : project.stageDueOn && project.stageDueOn < todayInputValue() ? 'danger' : 'primary'}>{PROJECT_STAGE_LABELS[project.stage]}</Tag>,
    stageDue: project.stageDueOn ? <span className={project.stage !== 'entregue' && project.stageDueOn < todayInputValue() ? 'project-date--overdue' : ''}>{dateOnly(project.stageDueOn)}</span> : '—',
    delivery: project.projectDueDate ? <span className={project.stage !== 'entregue' && project.projectDueDate < todayInputValue() ? 'project-date--overdue' : ''}>{dateOnly(project.projectDueDate)}</span> : '—',
    value: project.totalValue ? money(project.totalValue) : '—',
    received: project.totalValue ? money(project.amountReceived) : '—',
    receivable: project.totalValue ? money(project.amountReceivable) : '—',
    payment: <Tag tone={paymentTone(project.paymentStatus)}>{paymentLabel(project.paymentStatus)}</Tag>,
  })), [items]);

  const openProject = (project: CrmProject) => {
    setEditingProject(project);
    setForm(toForm(project));
  };

  const saveProject = async () => {
    if (!editingProject || !form || !canEdit || saving) return;
    const totalValue = form.totalValue.trim() ? Number(form.totalValue.replace(',', '.')) : null;
    if (totalValue !== null && (!Number.isFinite(totalValue) || totalValue < 0)) {
      toast({ title: 'Valor inválido', description: 'Informe um valor de projeto válido.', tone: 'danger' });
      return;
    }
    if (form.projectStartDate && form.projectDueDate && form.projectDueDate < form.projectStartDate) {
      toast({ title: 'Datas inválidas', description: 'A entrega do projeto não pode ser anterior ao início.', tone: 'danger' });
      return;
    }
    if (form.stageStartedOn && form.stageDueOn && form.stageDueOn < form.stageStartedOn) {
      toast({ title: 'Datas inválidas', description: 'A entrega da etapa não pode ser anterior ao início da etapa.', tone: 'danger' });
      return;
    }
    if (form.paymentTerms === '50_50' && form.firstPaymentDueDate && form.secondPaymentDueDate && form.secondPaymentDueDate < form.firstPaymentDueDate) {
      toast({ title: 'Vencimentos inválidos', description: 'O vencimento do saldo não pode ser anterior ao vencimento da entrada.', tone: 'danger' });
      return;
    }
    setSaving(true);
    try {
      const financials: ProjectFinancialInput = {
        totalValue,
        paymentTerms: form.paymentTerms || null,
        projectStartDate: form.projectStartDate || null,
        projectDueDate: form.projectDueDate || null,
        firstPaymentDueDate: form.firstPaymentDueDate || null,
        secondPaymentDueDate: form.paymentTerms === '50_50' ? (form.secondPaymentDueDate || form.projectDueDate || null) : null,
      };
      await projectsRepository.updateFinancials(editingProject.id, financials);
      if (form.stage !== editingProject.stage) {
        await projectsRepository.setStage(editingProject.id, form.stage, form.stageStartedOn || null, form.stageDueOn || null);
      } else {
        await projectsRepository.updateStageDates(editingProject.id, form.stageStartedOn || null, form.stageDueOn || null);
      }
      await load('refresh');
      setEditingProject(null);
      setForm(null);
      toast({ title: 'Projeto atualizado', description: 'Valores, datas e andamento foram salvos.', tone: 'success' });
    } catch (err) {
      toast({ title: 'Não foi possível salvar o projeto', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const setPayment = async (installment: 1 | 2, received: boolean) => {
    if (!editingProject || !canEdit || saving) return;
    setSaving(true);
    try {
      await projectsRepository.setPaymentReceived(editingProject.id, installment, received);
      await load('refresh');
      setEditingProject(null);
      setForm(null);
      toast({ title: received ? 'Pagamento recebido' : 'Pagamento reaberto', description: 'O fluxo financeiro do projeto foi atualizado.', tone: 'success' });
    } catch (err) {
      toast({ title: 'Não foi possível atualizar o pagamento', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const handleAction = (action: TableAction, row: Row) => {
    if (action !== 'view' && action !== 'edit') return;
    const project = items.find((item) => item.id === row.id);
    if (project) openProject(project);
  };

  const paymentHalf = editingProject?.totalValue ? editingProject.totalValue / 2 : 0;
  const paymentFirstAmount = editingProject?.paymentTerms === '50_50' ? paymentHalf : (editingProject?.totalValue ?? 0);
  const paymentSecondAmount = editingProject?.paymentTerms === '50_50' ? paymentHalf : 0;

  return (
    <div className="dashboard-table-page projects-page">
      <PageHeader
        title="Projetos"
        description="Gestão simples dos trabalhos já fechados: andamento, datas de entrega e recebimentos. Sem tarefas, Kanban ou controle de horas."
        action={<Button variant="secondary" iconLeft={RefreshCcw} loading={refreshing} disabled={loading} onClick={() => void load('refresh')}>Atualizar</Button>}
      />

      <section className="metric-grid metric-grid--4">
        <MetricCard icon={FolderOpen} value={loading ? '—' : String(summary.active)} label="Projetos ativos" active={status === 'ativos'} onClick={() => { setStatus(status === 'ativos' ? '' : 'ativos'); setPage(1); }} />
        <MetricCard icon={CalendarDays} value={loading ? '—' : String(summary.dueThisWeek)} label="Entregas em 7 dias" tone="primary" />
        <MetricCard icon={TriangleAlert} value={loading ? '—' : String(summary.overdue)} label="Atrasados" tone="danger" active={status === 'atrasados'} onClick={() => { setStatus(status === 'atrasados' ? '' : 'atrasados'); setPage(1); }} />
        <MetricCard icon={DollarSign} value={loading ? '—' : money(summary.receivable)} label="A receber" tone="warning" />
      </section>

      <FiltersBar>
        <SelectField value={status} placeholder="Situação" options={[{ label: 'Todos', value: '' }, { label: 'Em andamento', value: 'ativos' }, { label: 'Entregues', value: 'entregues' }, { label: 'Atrasados', value: 'atrasados' }]} onChange={(value) => { setStatus(value as typeof status); setPage(1); }} />
        <SelectField value={stage} placeholder="Etapa" options={[{ label: 'Todas as etapas', value: '' }, ...PROJECT_STAGES.map((value) => ({ label: PROJECT_STAGE_LABELS[value], value }))]} onChange={(value) => { setStage(value as ProjectStage | ''); setPage(1); }} />
        <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Buscar empresa" />
      </FiltersBar>

      <TableCard
        title="Projetos fechados"
        footerText={loading ? 'Carregando...' : `${refreshing ? 'Atualizando · ' : ''}Mostrando ${rows.length} de ${total} projeto(s).`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); }} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando projetos...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum projeto encontrado.</div> : null}
        {!error && !loading && rows.length ? <DataTable columns={columns} rows={rows} selectable={false} actions={canEdit ? ['edit'] : ['view']} onAction={handleAction} /> : null}
      </TableCard>

      <Drawer
        open={editingProject !== null && form !== null}
        title={editingProject ? (editingProject.alternativeName || editingProject.company) : 'Projeto'}
        description="O projeto é uma extensão do mesmo registro da empresa. Comercial, conversas e identidade permanecem na base canônica."
        size="wide"
        onClose={() => { if (!saving) { setEditingProject(null); setForm(null); } }}
        footer={canEdit ? <><Button variant="secondary" disabled={saving} onClick={() => { setEditingProject(null); setForm(null); }}>Cancelar</Button><Button loading={saving} onClick={() => void saveProject()}>Salvar projeto</Button></> : <Button variant="secondary" onClick={() => { setEditingProject(null); setForm(null); }}>Fechar</Button>}
      >
        {editingProject && form ? <div className="project-drawer">
          <section className="project-drawer__section">
            <h3>Visão geral</h3>
            <div className="project-drawer__grid">
              <Field label="Empresa" value={editingProject.alternativeName || editingProject.company} readOnly />
              <Field label="Fechado em" value={formatDateTime(editingProject.closedAt)} readOnly />
              <Field label="Início do projeto" type="date" value={form.projectStartDate} disabled={!canEdit} onChange={(value) => setForm((current) => current ? { ...current, projectStartDate: value } : current)} />
              <Field label="Entrega do projeto" type="date" value={form.projectDueDate} disabled={!canEdit} onChange={(value) => setForm((current) => current ? { ...current, projectDueDate: value, secondPaymentDueDate: current.paymentTerms === '50_50' && !current.secondPaymentDueDate ? value : current.secondPaymentDueDate } : current)} />
            </div>
          </section>

          <section className="project-drawer__section">
            <h3>Andamento</h3>
            <div className="project-drawer__grid">
              <label className="project-drawer__select-label"><span>Etapa atual</span><SelectField value={form.stage} disabled={!canEdit} options={PROJECT_STAGES.map((value) => ({ label: PROJECT_STAGE_LABELS[value], value }))} onChange={(value) => setForm((current) => {
                if (!current) return current;
                const nextStage = value as ProjectStage;
                if (nextStage === current.stage) return current;
                return { ...current, stage: nextStage, stageStartedOn: todayInputValue(), stageDueOn: '' };
              })} /></label>
              <Field label="Início da etapa" type="date" value={form.stageStartedOn} disabled={!canEdit} onChange={(value) => setForm((current) => current ? { ...current, stageStartedOn: value } : current)} />
              <Field label="Entrega da etapa" type="date" value={form.stageDueOn} disabled={!canEdit} onChange={(value) => setForm((current) => current ? { ...current, stageDueOn: value } : current)} />
              <Field label="Entrega efetiva" value={editingProject.deliveredOn ? dateOnly(editingProject.deliveredOn) : '—'} readOnly />
            </div>
          </section>

          <section className="project-drawer__section">
            <h3>Pagamento</h3>
            <div className="project-drawer__grid">
              <Field label="Valor do projeto" type="number" min="0" step="0.01" placeholder="0,00" value={form.totalValue} disabled={!canEdit} onChange={(value) => setForm((current) => current ? { ...current, totalValue: value } : current)} />
              <label className="project-drawer__select-label"><span>Condição</span><SelectField value={form.paymentTerms} disabled={!canEdit} placeholder="Selecionar" options={[{ label: 'Selecionar', value: '' }, ...Object.entries(PAYMENT_TERMS_LABELS).map(([value, label]) => ({ value, label }))]} onChange={(value) => setForm((current) => current ? { ...current, paymentTerms: value as PaymentTerms | '', secondPaymentDueDate: value === '50_50' ? (current.secondPaymentDueDate || current.projectDueDate) : '' } : current)} /></label>
              <Field label={form.paymentTerms === '50_50' ? 'Vencimento da entrada' : 'Vencimento'} type="date" value={form.firstPaymentDueDate} disabled={!canEdit} onChange={(value) => setForm((current) => current ? { ...current, firstPaymentDueDate: value } : current)} />
              {form.paymentTerms === '50_50' ? <Field label="Vencimento do saldo" type="date" value={form.secondPaymentDueDate} disabled={!canEdit} onChange={(value) => setForm((current) => current ? { ...current, secondPaymentDueDate: value } : current)} /> : null}
            </div>

            {editingProject.paymentTerms && editingProject.totalValue > 0 ? <div className="project-payments">
              <div className="project-payment-row">
                <div><strong>{editingProject.paymentTerms === '50_50' ? 'Entrada · 50%' : 'Pagamento · 100%'}</strong><span>{money(paymentFirstAmount)} · {editingProject.firstPaymentDueDate ? `vence ${dateOnly(editingProject.firstPaymentDueDate)}` : 'sem vencimento'}</span></div>
                <div>{editingProject.firstPaymentReceivedOn ? <><Tag tone="success">Recebido em {dateOnly(editingProject.firstPaymentReceivedOn)}</Tag>{canEdit ? <Button size="sm" variant="secondary" disabled={saving} onClick={() => void setPayment(1, false)}>Reabrir</Button> : null}</> : canEdit ? <Button size="sm" iconLeft={CircleCheck} disabled={saving} onClick={() => void setPayment(1, true)}>Marcar recebido</Button> : <Tag tone="warning">Pendente</Tag>}</div>
              </div>
              {editingProject.paymentTerms === '50_50' ? <div className="project-payment-row">
                <div><strong>Saldo · 50%</strong><span>{money(paymentSecondAmount)} · {editingProject.secondPaymentDueDate ? `vence ${dateOnly(editingProject.secondPaymentDueDate)}` : 'sem vencimento'}</span></div>
                <div>{editingProject.secondPaymentReceivedOn ? <><Tag tone="success">Recebido em {dateOnly(editingProject.secondPaymentReceivedOn)}</Tag>{canEdit ? <Button size="sm" variant="secondary" disabled={saving} onClick={() => void setPayment(2, false)}>Reabrir</Button> : null}</> : canEdit ? <Button size="sm" iconLeft={CircleCheck} disabled={saving} onClick={() => void setPayment(2, true)}>Marcar recebido</Button> : <Tag tone="warning">Pendente</Tag>}</div>
              </div> : null}
            </div> : <p className="drawer-help-text">Defina o valor e a condição de pagamento e salve o projeto para habilitar o acompanhamento dos recebimentos.</p>}
          </section>
        </div> : null}
      </Drawer>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
