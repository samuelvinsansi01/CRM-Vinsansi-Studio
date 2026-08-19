import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, Globe2, Plus, Users, X } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  MetricCard,
  Panel,
  RowsPerPageControl,
  SearchInput,
  SelectField,
  SegmentedControl,
  TableCard,
  Tag,
  ToastViewport,
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useImportLeads } from '../hooks/useImportLeads';
import { configService } from '../services/config/config.service';
import type { BranchConfigRecord } from '../services/config/types';
import { useImportSettings } from '../hooks/useImportSettings';
import { isValidInstagram, normalizeInstagramUsername } from '../services/instagram/instagram.utils';
import { permissionsFor } from '../services/permissions';
import { isStatusGroup } from '../services/status/status.mapper';
import { whatsappValidationService } from '../services/whatsapp-validation/whatsappValidation.service';
import type { ImportLead, ImportLeadDestination, ImportLeadInput, ImportLeadStatus, ImportParseResult } from '../services/import/types';

type ImportPageProps = {
  rejected?: boolean;
  onStatusChange?: (rejected: boolean) => void;
};

type LeadForm = {
  empresa: string;
  branchId: string;
  ramo: string;
  destino: ImportLeadDestination;
  whatsapp: string;
  instagram: string;
  site: string;
  cidade: string;
  estado: string;
};

type ManualLeadForm = {
  empresa: string;
  branchId: string;
  whatsapp: string;
  instagram: string;
};

const destinationOptions: ImportLeadDestination[] = ['WhatsApp', 'Com site', 'Agregadores', 'Instagram'];

const emptyLeadForm: LeadForm = {
  empresa: '',
  branchId: '',
  ramo: '',
  destino: 'WhatsApp',
  whatsapp: '',
  instagram: '',
  site: '',
  cidade: '',
  estado: '',
};

const emptyManualLeadForm: ManualLeadForm = {
  empresa: '',
  branchId: '',
  whatsapp: '',
  instagram: '',
};

function silentLink(label: string, href?: string) {
  if (!href) return label;
  return <a className="silent-link" href={href} target="_blank" rel="noreferrer" title={href}>{label}</a>;
}

function eligibleCount(result: ImportParseResult) {
  return result.leads.filter((lead) => isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'pending') || isStatusGroup(lead.status, 'review')).length;
}

function formatSimulationSummary(result: ImportParseResult) {
  return `${eligibleCount(result)} elegível(is), ${result.report.rejected} recusado(s), ${result.report.duplicates} duplicado(s) e 0 lead(s) persistido(s) por causa da simulação.`;
}

function ensureUrl(value?: string | null) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function mapsHref(lead: ImportLead) {
  if (lead.normalizedMapsUrl?.trim()) return ensureUrl(lead.normalizedMapsUrl);
  const query = [lead.empresa, lead.cidade, lead.estado].filter(Boolean).join(' ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function splitSubcategories(value?: string | null) {
  return String(value ?? '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function destinationLabel(value?: string | null) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('instagram')) return 'Instagram';
  if (normalized.includes('site')) return 'Com site';
  if (normalized.includes('agreg')) return 'Agregadores';
  if (normalized.includes('banco')) return 'Já no banco';
  if (normalized.includes('recus')) return 'Recusado';
  return 'WhatsApp';
}

function destinationTone(value?: string | null): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' {
  const label = destinationLabel(value);
  if (label === 'WhatsApp') return 'success';
  if (label === 'Instagram') return 'primary';
  if (label === 'Com site') return 'neutral';
  if (label === 'Agregadores') return 'warning';
  if (label === 'Recusado') return 'danger';
  return 'warning';
}

function DestinationTextBadge({ value }: { value?: string | null }) {
  const label = destinationLabel(value);
  return <Tag tone={destinationTone(value)}>{label}</Tag>;
}

function SubcategoryTooltip({ value }: { value?: string | null }) {
  const items = splitSubcategories(value);
  if (!items.length) return <span className="import-subcategory import-subcategory--empty">—</span>;

  const [first, ...rest] = items;
  return (
    <span className="import-subcategory" tabIndex={0}>
      <span className="import-subcategory__chip" title={items.join(' • ')}>
        <span>{first}</span>
        {rest.length ? <em>+{rest.length}</em> : null}
      </span>
      <span className="import-subcategory__card" role="tooltip" aria-label={`Sub ramo: ${items.join(', ')}`}>
        <strong>Sub ramo</strong>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </span>
    </span>
  );
}

function toForm(lead: ImportLead): LeadForm {
  return {
    empresa: lead.empresa,
    branchId: lead.branch_id ?? '',
    ramo: lead.ramo,
    destino: destinationLabel(lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino) as ImportLeadDestination,
    whatsapp: lead.whatsapp ?? '',
    instagram: lead.instagram ?? '',
    site: lead.site ?? '',
    cidade: lead.cidade ?? '',
    estado: lead.estado ?? '',
  };
}

function formToInput(form: LeadForm, status: ImportLead['status'], previous?: ImportLead | null): ImportLeadInput {
  const sendInstagram = form.destino === 'Instagram';
  const originalDestination = previous?.original_destination ?? previous?.destino ?? form.destino;

  return {
    empresa: form.empresa,
    branch_id: form.branchId,
    ramo: form.ramo,
    destino: form.destino,
    original_destination: originalDestination,
    destination: form.destino,
    destination_override: undefined,
    send_instagram: sendInstagram,
    instagram_url: form.instagram,
    status,
    whatsapp: form.whatsapp,
    instagram: form.instagram,
    site: form.site,
    cidade: form.cidade,
    estado: form.estado,
  };
}

export function ImportPage({ rejected = false, onStatusChange }: ImportPageProps) {
  const activeStatus: ImportLeadStatus = rejected ? 'rejected' : 'approved';
  const [jsonText, setJsonText] = useState('');
  const [search, setSearch] = useState('');
  const [manualLead, setManualLead] = useState<ManualLeadForm>(emptyManualLeadForm);
  const [isImporting, setIsImporting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [editingLead, setEditingLead] = useState<ImportLead | null>(null);
  const [leadForm, setLeadForm] = useState<LeadForm>(emptyLeadForm);
  const [deleteLead, setDeleteLead] = useState<ImportLead | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [lastImport, setLastImport] = useState<ImportParseResult | null>(null);
  const [branches, setBranches] = useState<BranchConfigRecord[]>([]);

  const uniqueBranches = useMemo(() => {
    const byName = new Map<string, BranchConfigRecord>();

    for (const branch of branches) {
      const normalizedName = branch.name.trim().toLocaleLowerCase('pt-BR');
      if (!normalizedName || byName.has(normalizedName)) continue;
      byName.set(normalizedName, { ...branch, name: branch.name.trim() });
    }

    return Array.from(byName.values()).sort((left, right) =>
      left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }),
    );
  }, [branches]);

  const { settings: importSettings } = useImportSettings();
  const simulateImport = importSettings?.safeMode.simulationMode ?? true;
  const { leads, summary, loading, error, importJson, createLead, updateLead, removeLead, moveLead, moveMany, clearSession, sendApprovedToInicio } = useImportLeads(activeStatus, search);
  const previewToken = useRef(0);

  useEffect(() => {
    void configService.list('branches').then((records) => {
      setBranches(records.filter((record): record is BranchConfigRecord => record.kind === 'branches' && record.active));
    }).catch((err) => {
      pushToast({ title: 'Não foi possível carregar os ramos', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.max(1, Math.ceil(leads.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => leads.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage), [leads, currentPage, rowsPerPage]);
  const selectedLeads = selectedRows.map((rowIndex) => pageRows[rowIndex]).filter((lead): lead is ImportLead => Boolean(lead));
  const selectedIds = selectedLeads.map((lead) => lead.id);
  const canBulkApprove = rejected && selectedLeads.length > 0 && selectedLeads.every((lead) => permissionsFor('import', lead.status).canApprove());
  const canBulkReject = !rejected && selectedLeads.length > 0 && selectedLeads.every((lead) => permissionsFor('import', lead.status).canReject());

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  };

  const changeStatus = (nextRejected: boolean) => {
    setPage(1);
    setSelectedRows([]);
    onStatusChange?.(nextRejected);
  };

  const updateForm = (key: keyof LeadForm, value: string) => {
    setLeadForm((current) => ({ ...current, [key]: value }));
  };

  const openLeadDrawer = (lead: ImportLead, mode: 'view' | 'edit' = 'view') => {
    setEditingLead(lead);
    setLeadForm(toForm(lead));
    setDrawerMode(mode);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingLead(null);
    setDrawerMode('view');
    setLeadForm(emptyLeadForm);
  };

  useEffect(() => {
    const source = jsonText.trim();
    const token = previewToken.current + 1;
    previewToken.current = token;

    if (!source) {
      setIsPreviewing(false);
      setLastImport(null);
      clearSession();
      return;
    }

    const timeout = window.setTimeout(async () => {
      setIsPreviewing(true);
      try {
        const result = await importJson(source, { simulate: true });
        if (previewToken.current === token) {
          setLastImport(result);
          setPage(1);
          setSelectedRows([]);
        }
      } catch {
        if (previewToken.current === token) setLastImport(null);
      } finally {
        if (previewToken.current === token) setIsPreviewing(false);
      }
    }, 420);

    return () => window.clearTimeout(timeout);
  }, [clearSession, importJson, jsonText]);

  const saveEditedLead = async () => {
    if (!editingLead) return;

    setSaving(true);

    try {
      if (!leadForm.branchId) {
        pushToast({ title: 'Ramo obrigatório', description: 'Selecione um ramo existente antes de salvar.', tone: 'danger' });
        return;
      }
      if (leadForm.destino === 'Instagram' && !isValidInstagram(leadForm.instagram)) {
        pushToast({ title: 'Lead sem Instagram válido', description: 'Informe um Instagram válido para usar o canal Instagram.', tone: 'danger' });
        return;
      }

      const updateResult = await updateLead(editingLead.id, formToInput(leadForm, editingLead.status, editingLead));
      if (updateResult?.simulation) {
        pushToast({ title: 'Simulação ativa', description: 'A alteração foi bloqueada e nenhum lead foi atualizado.', tone: 'info' });
        return;
      }
      closeDrawer();
      pushToast({
        title: 'Lead atualizado',
        description: /^\d+$/.test(editingLead.id) ? 'Alteração confirmada na tabela canônica leads.' : 'Alteração aplicada somente à prévia desta sessão.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Não foi possível salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const addManualLead = async () => {
    const company = manualLead.empresa.trim();
    const whatsapp = manualLead.whatsapp.trim();
    const instagramInput = manualLead.instagram.trim();
    const branch = uniqueBranches.find((item) => item.id === manualLead.branchId) ?? null;

    if (!company) {
      pushToast({ title: 'Nome obrigatório', description: 'Informe o nome da empresa.', tone: 'danger' });
      return;
    }
    if (!branch) {
      pushToast({ title: 'Ramo obrigatório', description: 'Selecione um ramo ativo existente.', tone: 'danger' });
      return;
    }
    if (!whatsapp && !instagramInput) {
      pushToast({ title: 'Contato obrigatório', description: 'Informe pelo menos WhatsApp ou Instagram.', tone: 'danger' });
      return;
    }

    const instagram = instagramInput ? normalizeInstagramUsername(instagramInput) : '';
    if (instagramInput && !instagram) {
      pushToast({ title: 'Instagram inválido', description: 'Informe somente um username, @username ou URL de perfil do Instagram.', tone: 'danger' });
      return;
    }

    const destination = instagram && !whatsapp ? 'Instagram' : 'WhatsApp';

    try {
      const createResult = await createLead({
        empresa: company,
        branch_id: branch.id,
        ramo: branch.name,
        destino: destination,
        original_destination: destination,
        destination,
        destination_override: undefined,
        send_instagram: false,
        instagram_url: instagram,
        status: destination === 'Instagram' ? 'pending' : 'review',
        whatsapp,
        instagram,
        site: '',
        cidade: '',
        estado: '',
        motivo: '',
      });
      if (createResult.simulation) {
        pushToast({ title: 'Simulação ativa', description: 'O cadastro foi bloqueado e nenhum lead foi persistido.', tone: 'info' });
        return;
      }
      setManualLead(emptyManualLeadForm);
      setPage(1);
      setSelectedRows([]);

      if (whatsapp && createResult.lead) {
        try {
          const validation = await whatsappValidationService.validateInitial([createResult.lead.id]);
          if (validation.approved > 0) {
            pushToast({ title: 'Lead adicionado', description: 'WhatsApp confirmado pela Evolution e resultado persistido.', tone: 'success' });
          } else if (validation.redirectedToInstagram > 0) {
            pushToast({ title: 'Lead adicionado', description: 'WhatsApp não encontrado; o lead voltou para Importado no destino Instagram e exige revisão/aprovação manual.', tone: 'warning' });
          } else if (validation.invalidated > 0) {
            pushToast({ title: 'Lead adicionado', description: 'A Evolution não confirmou o WhatsApp e o resultado inválido foi persistido.', tone: 'warning' });
          } else {
            pushToast({
              title: 'Lead adicionado; validação pendente',
              description: validation.failures[0]?.reason ?? 'A Evolution não confirmou um resultado persistido para este lead.',
              tone: 'warning',
            });
          }
        } catch (validationError) {
          pushToast({
            title: 'Lead adicionado; validação pendente',
            description: validationError instanceof Error ? validationError.message : 'Não foi possível consultar a Evolution.',
            tone: 'warning',
          });
        }
        return;
      }

      pushToast({ title: 'Lead adicionado', description: 'Instagram validado por formato e lead salvo para revisão.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível adicionar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const approveLeads = async () => {
    setIsImporting(true);
    try {
      const result = await importJson(jsonText, { simulate: true });
      const persistence = await sendApprovedToInicio(result.leads);
      setLastImport(result);
      setPage(1);
      setSelectedRows([]);
      if (persistence.simulation) {
        pushToast({
          title: 'Simulação concluída',
          description: formatSimulationSummary(result),
          tone: result.report.rejected > 0 ? 'warning' : 'info',
        });
        return;
      }
      if (!persistence.created.length) {
        pushToast({ title: 'Nenhum lead elegível', description: 'Nao ha aprovados ou leads em aguarde novos para mandar ao Inicio.', tone: 'warning' });
        return;
      }
      pushToast({
        title: 'Leads enviados ao Início',
        description: `${persistence.created.length} lead(s) aprovado(s) ou em aguarde enviado(s) ao Início.`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Erro ao aprovar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setIsImporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteLead) return;
    const persisted = /^\d+$/.test(deleteLead.id);

    try {
      const result = await removeLead(deleteLead.id);
      if (result?.simulation) {
        pushToast({
          title: 'Ação bloqueada pela simulação',
          description: 'O lead persistido não foi alterado.',
          tone: 'info',
        });
        return;
      }
      setDeleteLead(null);
      pushToast({
        title: persisted ? 'Lead arquivado' : 'Item removido da prévia',
        description: persisted ? 'lead_status_id atualizado para Arquivado (8) na tabela leads.' : 'O item temporário foi removido apenas desta sessão.',
        tone: persisted ? 'warning' : 'info',
      });
    } catch (err) {
      pushToast({ title: persisted ? 'Não foi possível arquivar' : 'Não foi possível remover', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const rowActions = (lead: ImportLead): TableAction[] => {
    const permissions = permissionsFor('import', lead.status);
    const actions: TableAction[] = ['view'];
    if (permissions.canEdit()) actions.push('edit');
    if (permissions.canArchive()) actions.push(/^\d+$/.test(lead.id) ? 'archive' : 'delete');
    return actions;
  };

  const handleRowAction = (action: TableAction, lead: ImportLead) => {
    if (action === 'view' || action === 'edit') {
      openLeadDrawer(lead, action);
      return;
    }
    if (action === 'archive' || action === 'delete') setDeleteLead(lead);
  };

  const runBulkMove = async (nextStatus: 'approved' | 'rejected') => {
    try {
      const result = await moveMany(selectedIds, nextStatus);
      if (result?.simulation) {
        pushToast({
          title: 'Ação bloqueada pela simulação',
          description: 'Nenhum lead persistido foi alterado.',
          tone: 'info',
        });
        return;
      }
      setSelectedRows([]);
      pushToast({
        title: nextStatus === 'approved' ? 'Leads aprovados' : 'Leads recusados',
        description: `${selectedIds.length} lead(s) atualizado(s).`,
        tone: nextStatus === 'approved' ? 'success' : 'warning',
      });
    } catch (err) {
      pushToast({ title: 'Acao em massa bloqueada', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const columns: TableColumn<ImportLead>[] = [
    { key: 'empresa', label: 'Nome da empresa', width: '34%', render: (lead) => silentLink(lead.empresa, mapsHref(lead)) },
    { key: 'ramo', label: 'Ramo', width: '21%' },
    {
      key: 'subcategoria',
      label: 'Sub ramo',
      width: '23%',
      render: (lead) => <SubcategoryTooltip value={lead.subcategoria} />,
    },
    {
      key: 'destino',
      label: 'Destino',
      width: '16%',
      render: (lead) => {
        const destination = lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino;
        return <DestinationTextBadge value={destination} />;
      },
    },
  ];

  return (
    <div className="import-page">
      <PageHeader title="Importar" />
      {simulateImport ? (
        <div className="import-simulation-banner" role="status">
          <strong>Modo de simulação ativo.</strong>
          <span>Os leads serão analisados, mas não serão gravados.</span>
        </div>
      ) : null}
      <section className="import-metrics">
        <div className="metric-grid metric-grid--4">
          <MetricCard icon={Users} value={String(summary.total)} label="Total" />
          <MetricCard icon={Globe2} value={String(summary.approved)} label="Aprovados" tone="success" />
          <MetricCard value={String(summary.pending)} label="Em aguarde" tone="warning" />
          <MetricCard icon={X} value={String(summary.rejected)} label="Recusados" tone="danger" />
        </div>
        <div className="metric-grid metric-grid--4">
          <MetricCard value={String(summary.whatsapp)} label="WhatsApp" />
          <MetricCard value={String(summary.ownSite)} label="Com site" />
          <MetricCard value={String(summary.aggregators)} label="Agregadores" />
          <MetricCard value={String(summary.instagram)} label="Instagram" />
        </div>
      </section>

      <section className="import-grid import-grid--manual">
          <Panel title="Adicionar lead" className="manual-validation">
            <p>Cadastre um lead usando um ramo ativo e pelo menos um contato. O WhatsApp será validado pela Evolution após a criação; o Instagram é validado somente por formato.</p>
            <div className="manual-validation__fields manual-validation__fields--stacked">
              <Field label="Nome da empresa" placeholder="Digite o nome da empresa" value={manualLead.empresa} onChange={(empresa) => setManualLead((current) => ({ ...current, empresa }))} />
              <label className="field import-select-field">
                <span className="field__label">Ramo</span>
                <SelectField
                  className="import-select-control"
                  value={manualLead.branchId}
                  placeholder="Selecione um ramo ativo"
                  searchable
                  searchPlaceholder="Buscar ramo..."
                  options={uniqueBranches.map((branch) => ({ label: branch.name, value: branch.id }))}
                  onChange={(branchId) => setManualLead((current) => ({ ...current, branchId }))}
                />
              </label>
              <Field label="Número WhatsApp" placeholder="Digite o número WhatsApp" value={manualLead.whatsapp} onChange={(whatsapp) => setManualLead((current) => ({ ...current, whatsapp }))} />
              <Field label="Link Instagram" placeholder="Digite o link Instagram" value={manualLead.instagram} onChange={(instagram) => setManualLead((current) => ({ ...current, instagram }))} />
            </div>
            <div className="manual-validation__actions">
              <Button variant="secondary" disabled={!manualLead.empresa && !manualLead.branchId && !manualLead.whatsapp && !manualLead.instagram} onClick={() => setManualLead(emptyManualLeadForm)}>Limpar</Button>
              <Button disabled={!manualLead.empresa.trim() || !manualLead.branchId || (!manualLead.whatsapp.trim() && !manualLead.instagram.trim()) || simulateImport} onClick={addManualLead}>Adicionar lead</Button>
            </div>
          </Panel>
      </section>

      <details className="import-json-fallback">
        <summary>Importar backup JSON (diagnóstico)</summary>
        <section className="import-grid import-grid--manual">
          <Panel title="JSON de backup/diagnóstico" className="import-json">
            <p>Cole o JSON exportado pela extensão Google Maps. A extensão fornece candidatos; as regras canônicas, a barreira de simulação e a validação posterior de WhatsApp continuam sob responsabilidade da plataforma.</p>
            <Field
              as="textarea"
              className="json-dropzone"
              placeholder="Cole aqui o JSON exportado pela extensão Google Maps"
              value={jsonText}
              onChange={setJsonText}
            />
            <div className="import-json__actions">
              <Button variant="secondary" onClick={() => { setJsonText(''); setLastImport(null); clearSession(); setPage(1); }}>Limpar importação</Button>
              <Button iconLeft={Database} loading={isImporting} disabled={!jsonText.trim() || isPreviewing} onClick={approveLeads}>{simulateImport ? 'Executar simulação' : 'Aprovar leads'}</Button>
            </div>
          </Panel>
        </section>
      </details>

      <section className="import-grid">
        <TableCard
          title="Prévia"
          footerText={`Mostrando ${pageRows.length} de ${leads.length} ${rejected ? 'recusados' : 'leads aptos'}`}
          footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); setSelectedRows([]); }} />}
          page={currentPage}
          totalPages={totalPages}
          onPageChange={(nextPage) => { setPage(nextPage); setSelectedRows([]); }}
        >
          <div className="preview-tabs">
            <SegmentedControl
              items={['Leads aptos', 'Recusados']}
              active={rejected ? 'Recusados' : 'Leads aptos'}
              compact
              onChange={(item) => changeStatus(item === 'Recusados')}
            />
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); setSelectedRows([]); }} placeholder="Buscar empresa, telefone ou Instagram" />
          </div>
          {selectedLeads.length ? (
            <div className="lead-bulk-actions">
              <span>{selectedLeads.length} selecionado(s)</span>
              {canBulkApprove ? <Button size="sm" onClick={() => runBulkMove('approved')}>Aprovar</Button> : null}
              {canBulkReject ? <Button size="sm" variant="danger" onClick={() => runBulkMove('rejected')}>Recusar</Button> : null}
              {!canBulkApprove && !canBulkReject ? <small>Nenhuma acao disponivel para a selecao atual.</small> : null}
            </div>
          ) : null}
          {error ? <div className="table-message">{error}</div> : null}
          {!error && loading ? <div className="table-message">Processando leads...</div> : null}
          {!error && !loading && !leads.length ? (
            <div className="table-message">Nenhum lead nesta prévia.</div>
          ) : null}
          {!error && !loading && leads.length > 0 ? (
            <DataTable
              selectable
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
              actions={['view', 'edit', 'archive']}
              getRowActions={rowActions}
              onAction={(action, lead) => handleRowAction(action, lead)}
              columns={columns}
              rows={pageRows}
            />
          ) : null}
        </TableCard>
      </section>

      <Drawer
        open={drawerOpen}
        title={drawerMode === 'edit' ? 'Editar lead' : 'Detalhes do lead'}
        description={editingLead && /^\d+$/.test(editingLead.id)
          ? 'Edite somente campos físicos de public.leads; o ramo é gravado por branches_id e o destino resolve channels_id/contact_sources_id.'
          : 'Item ainda não persistido: as alterações afetam somente a prévia desta sessão.'}
        onClose={closeDrawer}
        footer={
          drawerMode === 'edit' ? (
            <>
              <Button variant="secondary" onClick={() => editingLead ? openLeadDrawer(editingLead, 'view') : closeDrawer()}>Cancelar</Button>
              <Button loading={saving} disabled={simulateImport && Boolean(editingLead && /^\d+$/.test(editingLead.id))} onClick={saveEditedLead}>Salvar</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={closeDrawer}>Fechar</Button>
              {editingLead && permissionsFor('import', editingLead.status).canEdit() ? (
                <Button onClick={() => openLeadDrawer(editingLead, 'edit')}>Editar</Button>
              ) : null}
            </>
          )
        }
      >
        <div className={`drawer-form ${drawerMode === 'view' ? 'drawer-form--readonly' : ''}`}>
          <Field label="Nome da empresa" value={leadForm.empresa} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('empresa', value)} />
          <label className="drawer-field">
            <span>Ramo</span>
            {drawerMode === 'view' ? (
              <Field value={leadForm.ramo} readOnly />
            ) : (
              <SelectField
                value={leadForm.branchId}
                options={uniqueBranches.map((branch) => ({ label: branch.name, value: branch.id }))}
                placeholder="Selecione um ramo cadastrado"
                onChange={(value) => {
                  const branch = uniqueBranches.find((item) => item.id === value);
                  setLeadForm((current) => ({ ...current, branchId: value, ramo: branch?.name ?? '' }));
                }}
              />
            )}
          </label>
          <label className="drawer-field">
            <span>Destino</span>
            {drawerMode === 'view' ? <Field value={leadForm.destino} readOnly /> : <SelectField value={leadForm.destino} options={destinationOptions} onChange={(value) => updateForm('destino', value)} />}
          </label>
          <Field label="WhatsApp" value={leadForm.whatsapp} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('whatsapp', value)} />
          <Field label="Instagram" value={leadForm.instagram} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('instagram', value)} />
          <Field label="Site" value={leadForm.site} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('site', value)} />
          <Field label="Cidade" value={leadForm.cidade} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('cidade', value)} />
          <Field label="Estado" value={leadForm.estado} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('estado', value)} />
        </div>
      </Drawer>

      <ConfirmDialog
        open={deleteLead !== null}
        title={deleteLead && /^\d+$/.test(deleteLead.id) ? 'Arquivar lead?' : 'Remover item da prévia?'}
        description={deleteLead && /^\d+$/.test(deleteLead.id)
          ? 'Esta ação grava lead_status_id = 8 (Arquivado) na tabela canônica leads.'
          : 'Esta ação remove somente o item temporário da prévia atual.'}
        confirmLabel={deleteLead && /^\d+$/.test(deleteLead.id) ? 'Arquivar' : 'Remover'}
        danger
        onClose={() => setDeleteLead(null)}
        onConfirm={confirmDelete}
      >
        {deleteLead ? <strong>{deleteLead.empresa}</strong> : null}
      </ConfirmDialog>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
