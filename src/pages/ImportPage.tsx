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
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useImportLeads } from '../hooks/useImportLeads';
import { useApifyAccounts } from '../hooks/useApifyAccounts';
import { apifyImportService } from '../services/apify-import';
import type { ApifyImportJob, ApifyLocationOption } from '../services/apify-import';
import { configService } from '../services/config/config.service';
import type { BranchConfigRecord } from '../services/config/types';
import { useImportSettings } from '../hooks/useImportSettings';
import { isValidInstagram } from '../services/instagram/instagram.utils';
import { permissionsFor } from '../services/permissions';
import { isStatusGroup } from '../services/status/status.mapper';
import type { ImportLead, ImportLeadDestination, ImportLeadInput, ImportLeadStatus, ImportParseResult } from '../services/import/types';

type ImportPageProps = {
  rejected?: boolean;
  onStatusChange?: (rejected: boolean) => void;
};

type LeadForm = {
  empresa: string;
  ramo: string;
  destino: ImportLeadDestination;
  whatsapp: string;
  instagram: string;
  site: string;
  send_instagram: 'Sim' | 'Não';
  instagram_override_reason: string;
  cidade: string;
  estado: string;
  motivo: string;
};

const destinationOptions: ImportLeadDestination[] = ['WhatsApp', 'Com site', 'Agregadores', 'Instagram', 'Recusado', 'Já no banco'];

const emptyLeadForm: LeadForm = {
  empresa: '',
  ramo: '',
  destino: 'WhatsApp',
  whatsapp: '',
  instagram: '',
  site: '',
  send_instagram: 'Não',
  instagram_override_reason: '',
  cidade: '',
  estado: '',
  motivo: '',
};

function normalizeLocationKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s*[-\/]\s*/g, ',')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function silentLink(label: string, href?: string) {
  if (!href) return label;
  return <a className="silent-link" href={href} target="_blank" rel="noreferrer" title={href}>{label}</a>;
}

const duplicateReasonCodes = new Set([
  'payload_duplicate',
  'duplicate_phone',
  'duplicate_site',
  'already_in_base',
  'duplicate_lead_id',
  'already_sent',
]);

function formatRejectionReasons(result: ImportParseResult) {
  const reasons = result.report.reasons
    .filter((reason) => reason.code !== 'approved' && reason.code !== 'ignored' && !duplicateReasonCodes.has(reason.code))
    .filter((reason) => reason.count > 0)
    .sort((a, b) => b.count - a.count);

  if (!reasons.length) return '';
  return ` Motivos das recusas: ${reasons.map((reason) => `${reason.label}: ${reason.count}`).join('; ')}.`;
}

function formatApifyImportSummary(result: ImportParseResult) {
  return `${result.report.processed} processado(s): ${result.report.created} criado(s), ${result.report.duplicates} duplicado(s) e ${result.report.rejected} recusado(s).${formatRejectionReasons(result)}`;
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
    ramo: lead.ramo,
    destino: lead.destino,
    whatsapp: lead.whatsapp ?? '',
    instagram: lead.instagram ?? '',
    site: lead.site ?? '',
    send_instagram: lead.send_instagram ? 'Sim' : 'Não',
    instagram_override_reason: lead.instagram_override_reason ?? '',
    cidade: lead.cidade ?? '',
    estado: lead.estado ?? '',
    motivo: lead.motivo ?? '',
  };
}

function formToInput(form: LeadForm, status: ImportLead['status'], previous?: ImportLead | null): ImportLeadInput {
  const sendInstagram = form.send_instagram === 'Sim';
  const originalDestination = previous?.original_destination ?? previous?.destino ?? form.destino;

  return {
    empresa: form.empresa,
    ramo: form.ramo,
    destino: form.destino,
    original_destination: originalDestination,
    destination: sendInstagram ? 'Instagram' : form.destino,
    destination_override: sendInstagram ? 'Instagram' : undefined,
    send_instagram: sendInstagram,
    instagram_url: form.instagram,
    instagram_override_reason: sendInstagram ? form.instagram_override_reason || 'Override manual para Instagram' : '',
    override_by: sendInstagram ? previous?.override_by || 'Operador local' : '',
    override_at: sendInstagram ? previous?.override_at || new Date().toISOString() : '',
    status,
    motivo: status === 'rejected' ? form.motivo || 'Recusado manualmente.' : form.motivo,
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
  const [manualLead, setManualLead] = useState({ empresa: '', whatsapp: '', instagram: '' });
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
  const [selectedApifyAccountId, setSelectedApifyAccountId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
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

  const selectedBranch = useMemo(
    () => uniqueBranches.find((branch) => branch.id === selectedBranchId) ?? null,
    [selectedBranchId, uniqueBranches],
  );

  const [mapsLocation, setMapsLocation] = useState('');
  const [mapsLimit, setMapsLimit] = useState('100');
  const [locationOptions, setLocationOptions] = useState<ApifyLocationOption[]>([]);
  const [searchedLocations, setSearchedLocations] = useState<string[]>([]);

  const searchedLocationKeys = useMemo(
    () => new Set(searchedLocations.map(normalizeLocationKey)),
    [searchedLocations],
  );

  const availableLocationOptions = useMemo(
    () => locationOptions.filter((location) => !searchedLocationKeys.has(normalizeLocationKey(location.label))),
    [locationOptions, searchedLocationKeys],
  );

  const previouslySearchedLocationOptions = useMemo(
    () => locationOptions.filter((location) => searchedLocationKeys.has(normalizeLocationKey(location.label))),
    [locationOptions, searchedLocationKeys],
  );
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [apifyJobs, setApifyJobs] = useState<ApifyImportJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ApifyImportJob | null>(null);
  const [jobItems, setJobItems] = useState<unknown[] | null>(null);
  const [jobDetailsLoading, setJobDetailsLoading] = useState(false);
  const [importTab, setImportTab] = useState<'Apify' | 'Manual'>('Apify');
  const [startingApify, setStartingApify] = useState(false);

  const { settings: importSettings } = useImportSettings();
  const { activeAccounts: apifyAccounts, loading: loadingApifyAccounts, error: apifyAccountsError } = useApifyAccounts();
  const simulateImport = importSettings?.safeMode.simulationMode ?? true;
  const { leads, summary, loading, error, importJson, createLead, updateLead, removeLead, moveLead, moveMany, clearSession, sendApprovedToInicio } = useImportLeads(activeStatus, search);
  const previewToken = useRef(0);
  const recoveredApifyJob = useRef(false);

  const loadApifyJobs = async () => {
    setJobsLoading(true);
    try {
      setApifyJobs(await apifyImportService.listGoogleMapsJobs());
    } catch (err) {
      pushToast({ title: 'Não foi possível carregar os runs', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setJobsLoading(false);
    }
  };

  useEffect(() => {
    void configService.list('branches').then((records) => {
      setBranches(records.filter((record): record is BranchConfigRecord => record.kind === 'branches' && record.active));
    }).catch((err) => {
      pushToast({ title: 'Não foi possível carregar os ramos', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    });
    setLocationsLoading(true);
    void apifyImportService.listBrazilLocations().then(setLocationOptions).catch((err) => {
      pushToast({ title: 'Não foi possível carregar as localidades', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }).finally(() => setLocationsLoading(false));
    void loadApifyJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMapsLocation('');
    setSearchedLocations([]);
    if (!selectedBranchId) return;

    setLocationsLoading(true);
    void apifyImportService.listSuccessfullySearchedLocations(Number(selectedBranchId))
      .then(setSearchedLocations)
      .catch((err) => {
        pushToast({ title: 'Não foi possível verificar as localidades já pesquisadas', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
      })
      .finally(() => setLocationsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

  const openJobDetails = async (job: ApifyImportJob) => {
    setSelectedJob(job);
    setJobItems(null);
    setJobDetailsLoading(true);
    try {
      const details = await apifyImportService.getGoogleMapsJobDetails(job.jobId);
      setJobItems(details.items ?? []);
    } catch (err) {
      pushToast({ title: 'Não foi possível abrir o run', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setJobDetailsLoading(false);
    }
  };

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

  const handleImport = async () => {
    setIsImporting(true);

    try {
      const result = await importJson(jsonText, { simulate: simulateImport });
      setSearch('');
      setPage(1);
      setSelectedRows([]);
      setLastImport(result);
      if (result.approved === 0 && result.rejected > 0) {
        onStatusChange?.(true);
      } else if (result.approved > 0 && rejected) {
        onStatusChange?.(false);
      }
      pushToast({
        title: result.report.simulation ? 'Simulação concluída' : 'Importação concluída',
        description: `${result.report.processed} processado(s): ${result.approved} aprovado(s), ${result.rejected} recusado(s), ${result.ignored} ignorado(s).`,
        tone: result.rejected > 0 ? 'warning' : 'success',
      });
    } catch (err) {
      pushToast({ title: 'Erro na importação', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setIsImporting(false);
    }
  };


  const processApifyJob = async (jobId: number) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const sync = await apifyImportService.syncGoogleMapsExtractor(jobId);

      if (sync.status === 'failed' || sync.status === 'aborted' || sync.status === 'timed_out') {
        throw new Error(`A execução da Apify terminou com status ${sync.status}.`);
      }
      if (sync.status !== 'succeeded') continue;
      if (sync.imported) return null;
      if (!sync.items) throw new Error('A execução terminou, mas o dataset não foi retornado.');

      const importedResult = await importJson(JSON.stringify(sync.items), { simulate: false });
      setLastImport(importedResult);
      setSearch('');
      setPage(1);
      setSelectedRows([]);

      await apifyImportService.finalizeGoogleMapsImport({
        jobId,
        processed: importedResult.report.processed,
        imported: importedResult.report.created,
        duplicates: importedResult.report.duplicates,
        rejected: importedResult.report.rejected,
      });
      return importedResult;
    }
    throw new Error('A coleta continua em processamento. Consulte novamente em alguns instantes.');
  };

  useEffect(() => {
    if (recoveredApifyJob.current) return;
    recoveredApifyJob.current = true;

    void (async () => {
      try {
        const pendingJob = await apifyImportService.findLatestPendingGoogleMapsJob();
        if (!pendingJob) return;
        setStartingApify(true);
        const importedResult = await processApifyJob(pendingJob.jobId);
        if (!importedResult) return;
        pushToast({
          title: 'Coleta anterior recuperada',
          description: formatApifyImportSummary(importedResult),
          tone: importedResult.report.rejected > 0 ? 'warning' : 'success',
        });
      } catch (err) {
        pushToast({ title: 'Não foi possível recuperar a coleta', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
      } finally {
        setStartingApify(false);
      }
    })();
    // Executa uma única vez para recuperar inclusive o dataset criado antes deste deploy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startApifyImport = async () => {
    const limit = Number(mapsLimit);
    const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);
    const searchTerms = selectedBranch ? [selectedBranch.name] : [];
    if (!selectedApifyAccountId || !selectedBranch || !mapsLocation.trim()) return;
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      pushToast({ title: 'Quantidade inválida', description: 'Informe uma quantidade entre 1 e 500.', tone: 'danger' });
      return;
    }

    setStartingApify(true);
    try {
      const result = await apifyImportService.startGoogleMapsExtractor({
        apifyAccountId: Number(selectedApifyAccountId),
        searchTerms,
        location: mapsLocation,
        limit,
        branchId: Number(selectedBranch.id),
        branchName: selectedBranch.name,
      });
      pushToast({
        title: 'Coleta iniciada',
        description: `A conta ${result.account?.name ?? result.accountName} iniciou o Google Maps Extractor. Execução: ${result.runId}.`,
        tone: 'success',
      });

      const importedResult = await processApifyJob(result.jobId);
      if (!importedResult) {
        pushToast({ title: 'Dataset já processado', description: 'Esta execução já havia sido importada e não será duplicada.', tone: 'success' });
        return;
      }
      await loadApifyJobs();
      pushToast({
        title: 'Coleta validada e importada',
        description: formatApifyImportSummary(importedResult),
        tone: importedResult.report.rejected > 0 ? 'warning' : 'success',
      });
    } catch (err) {
      pushToast({ title: 'Não foi possível concluir a coleta', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setStartingApify(false);
    }
  };


  const saveEditedLead = async () => {
    if (!editingLead) return;

    setSaving(true);

    try {
      if (leadForm.send_instagram === 'Sim' && !isValidInstagram(leadForm.instagram)) {
        pushToast({ title: 'Lead sem Instagram válido', description: 'Informe um Instagram válido antes de marcar Enviar Instagram.', tone: 'danger' });
        return;
      }

      await updateLead(editingLead.id, formToInput(leadForm, editingLead.status, editingLead));
      closeDrawer();
      pushToast({ title: 'Lead atualizado', description: 'Alteração salva na camada de importação.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível salvar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const addManualLead = async () => {
    if (!manualLead.empresa.trim()) return;

    try {
      await createLead({
        empresa: manualLead.empresa,
        ramo: importSettings?.branchRules[0]?.branch ?? '',
        destino: manualLead.instagram && !manualLead.whatsapp ? 'Instagram' : 'WhatsApp',
        original_destination: manualLead.instagram && !manualLead.whatsapp ? 'Instagram' : 'WhatsApp',
        destination: manualLead.instagram && !manualLead.whatsapp ? 'Instagram' : 'WhatsApp',
        destination_override: undefined,
        send_instagram: false,
        instagram_url: manualLead.instagram,
        status: 'approved',
        whatsapp: manualLead.whatsapp,
        instagram: manualLead.instagram,
        site: '',
        cidade: '',
        estado: '',
        motivo: '',
      });
      setManualLead({ empresa: '', whatsapp: '', instagram: '' });
      setPage(1);
      setSelectedRows([]);
      pushToast({ title: 'Lead adicionado', description: 'Lead criado localmente na lista de aprovados.', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível adicionar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const approveLeads = async () => {
    try {
      const result = await importJson(jsonText, { simulate: simulateImport });
      const created = await sendApprovedToInicio(result.leads);
      setLastImport(result);
      setPage(1);
      setSelectedRows([]);
      if (!created.length) {
        pushToast({ title: 'Nenhum lead elegível', description: 'Nao ha aprovados ou leads em aguarde novos para mandar ao Inicio.', tone: 'warning' });
        return;
      }
      pushToast({
        title: 'Leads enviados ao Início',
        description: `${created.length} lead(s) aprovado(s) ou em aguarde enviado(s) ao Início.`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Erro ao aprovar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteLead) return;

    try {
      await removeLead(deleteLead.id);
      setDeleteLead(null);
      pushToast({ title: 'Lead removido', description: 'Registro removido da camada de importação.', tone: 'danger' });
    } catch (err) {
      pushToast({ title: 'Não foi possível excluir', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const runBulkMove = async (nextStatus: 'approved' | 'rejected') => {
    try {
      await moveMany(selectedIds, nextStatus);
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

      <div className="import-source-tabs" role="tablist" aria-label="Tipo de importação">
        <button type="button" role="tab" aria-selected={importTab === 'Apify'} className={importTab === 'Apify' ? 'is-active' : ''} onClick={() => setImportTab('Apify')}>Apify</button>
        <button type="button" role="tab" aria-selected={importTab === 'Manual'} className={importTab === 'Manual' ? 'is-active' : ''} onClick={() => setImportTab('Manual')}>Manual</button>
      </div>

      {importTab === 'Apify' ? (
        <>
        <Panel title="Google Maps Extractor" className="import-extractor-panel">
          <p>Escolha manualmente a conta que será usada nesta coleta. A plataforma não troca a conta automaticamente.</p>
          <div className="import-extractor-fields">
            <label className="field import-select-field">
              <span className="field__label">Conta Apify</span>
              <SelectField
                className="import-select-control"
                value={selectedApifyAccountId}
                options={[{ label: loadingApifyAccounts ? 'Carregando contas...' : 'Selecione uma conta', value: '' }, ...apifyAccounts.map((account) => ({ label: account.name, value: String(account.id) }))]}
                onChange={setSelectedApifyAccountId}
              />
            </label>
            <label className="field import-select-field">
              <span className="field__label">Ramo</span>
              <SelectField
                className="import-select-control"
                value={selectedBranchId}
                placeholder="Selecione um ramo cadastrado"
                searchable
                searchPlaceholder="Buscar ramo..."
                options={uniqueBranches.map((branch) => ({ label: branch.name, value: branch.id }))}
                onChange={setSelectedBranchId}
              />
            </label>
            <label className="field import-select-field">
              <span className="field__label">Localização</span>
              <SelectField
                className="import-select-control"
                value={mapsLocation}
                placeholder={!selectedBranchId ? 'Selecione primeiro um ramo' : locationsLoading ? 'Carregando localidades...' : 'Selecione uma localidade'}
                searchable
                searchPlaceholder="Buscar cidade ou estado..."
                options={availableLocationOptions.map((location) => ({ label: location.label, value: location.label }))}
                onChange={setMapsLocation}
                renderNoResults={(query, selectValue) => {
                  const normalizedQuery = normalizeLocationKey(query);

                  const searchedMatches = normalizedQuery
                    ? previouslySearchedLocationOptions
                        .filter((location) => normalizeLocationKey(location.label).includes(normalizedQuery))
                        .slice(0, 5)
                    : [];

                  const catalogMatches = normalizedQuery
                    ? locationOptions
                        .filter((location) => normalizeLocationKey(location.label).includes(normalizedQuery))
                        .slice(0, 5)
                    : [];

                  if (searchedMatches.length) {
                    return (
                      <div className="location-already-searched">
                        {searchedMatches.map((location) => (
                          <div className="location-already-searched__item" key={location.cityId}>
                            <span>
                              Você já pesquisou <strong>{selectedBranch?.name ?? 'esse ramo'}</strong> em <strong>{location.label}</strong>.
                            </span>
                            <button type="button" onClick={() => selectValue(location.label)}>Selecionar mesmo assim</button>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  if (catalogMatches.length) {
                    return (
                      <div className="location-already-searched">
                        {catalogMatches.map((location) => (
                          <div className="location-already-searched__item" key={location.cityId}>
                            <span>Localidade encontrada: <strong>{location.label}</strong>.</span>
                            <button type="button" onClick={() => selectValue(location.label)}>Selecionar</button>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  return <div className="select-field__empty">Nenhuma localidade encontrada.</div>;
                }}
              />
            </label>
            <Field label="Quantidade" type="number" min="1" max="500" value={mapsLimit} onChange={setMapsLimit} />
          </div>
          {apifyAccountsError ? <div className="table-message">{apifyAccountsError}</div> : null}
          {!loadingApifyAccounts && !apifyAccounts.length ? <div className="table-message">Cadastre uma conta em Configurações → Importação antes de executar o extractor.</div> : null}
          <div className="import-extractor-actions">
            <Button
              iconLeft={Database}
              loading={startingApify}
              disabled={!selectedApifyAccountId || !selectedBranchId || !mapsLocation.trim()}
              onClick={startApifyImport}
            >
              Iniciar coleta
            </Button>
          </div>
        </Panel>
        <section className="apify-runs-section">
          <TableCard title="Runs reais" footerText={`${apifyJobs.length} execução(ões) encontrada(s)`}>
            {jobsLoading ? <div className="table-message">Carregando runs...</div> : null}
            {!jobsLoading && !apifyJobs.length ? <div className="table-message">Nenhuma execução encontrada.</div> : null}
            {!jobsLoading && apifyJobs.length ? (
              <div className="apify-runs-table-wrap">
                <table className="apify-runs-table">
                  <thead><tr><th>Status</th><th>Conta</th><th>Localização</th><th>Ramo</th><th>Resultados</th><th>Criados</th><th>Duplicados</th><th>Recusados</th><th>Data</th></tr></thead>
                  <tbody>{apifyJobs.map((job) => (
                    <tr key={job.jobId} onClick={() => void openJobDetails(job)} tabIndex={0}>
                      <td><Tag tone={job.status === 'succeeded' ? 'success' : job.status === 'failed' ? 'danger' : 'warning'}>{job.status}</Tag></td>
                      <td>{job.accountName}</td><td>{job.location}</td><td>{job.branchName}</td><td>{job.totalReceived}</td><td>{job.totalImported}</td><td>{job.totalDuplicates}</td><td>{job.totalRejected}</td><td>{job.createdAt ? new Date(job.createdAt).toLocaleString('pt-BR') : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : null}
          </TableCard>
        </section>
        </>
      ) : (
        <section className="import-grid import-grid--manual">
          <Panel title="Importação manual" className="import-json">
            <p>Cole o JSON exportado ou adicione um lead manualmente. Ambos passam pela mesma prévia de validação.</p>
            <Field
              as="textarea"
              className="json-dropzone"
              placeholder="Cole aqui o JSON exportado"
              value={jsonText}
              onChange={setJsonText}
            />
            <div className="import-json__actions">
              <Button variant="secondary" onClick={() => { setJsonText(''); setLastImport(null); clearSession(); setPage(1); }}>Limpar importação</Button>
              <Button iconLeft={Database} loading={isImporting} disabled={!jsonText.trim() || isPreviewing} onClick={approveLeads}>Aprovar leads</Button>
            </div>
          </Panel>

          <Panel title="Adicionar lead" className="manual-validation">
            <div className="manual-validation__fields manual-validation__fields--stacked">
              <Field label="Nome da empresa" placeholder="Digite o nome da empresa" value={manualLead.empresa} onChange={(empresa) => setManualLead((current) => ({ ...current, empresa }))} />
              <Field label="Número WhatsApp" placeholder="Digite o número WhatsApp" value={manualLead.whatsapp} onChange={(whatsapp) => setManualLead((current) => ({ ...current, whatsapp }))} />
              <Field label="Link Instagram" placeholder="Digite o link Instagram" value={manualLead.instagram} onChange={(instagram) => setManualLead((current) => ({ ...current, instagram }))} />
            </div>
            <div className="manual-validation__actions">
              <Button variant="secondary" disabled={!manualLead.empresa} onClick={() => setManualLead({ empresa: '', whatsapp: '', instagram: '' })}>Limpar</Button>
              <Button disabled={!manualLead.empresa} onClick={addManualLead}>Adicionar lead</Button>
            </div>
          </Panel>
        </section>
      )}

      {importTab === 'Manual' ? (
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
            <div className="table-message">Nenhum lead nesta prévia. Cole um JSON e execute a simulação/importação.</div>
          ) : null}
          {!error && !loading && leads.length > 0 ? (
            <DataTable
              selectable
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
              actions={[]}
              columns={columns}
              rows={pageRows}
            />
          ) : null}
        </TableCard>
      </section>
      ) : null}

      <Drawer
        open={Boolean(selectedJob)}
        title={selectedJob ? `Run #${selectedJob.jobId}` : 'Run'}
        description="Dados reais da execução e conteúdo bruto do dataset da Apify."
        onClose={() => { setSelectedJob(null); setJobItems(null); }}
      >
        {selectedJob ? (
          <div className="apify-run-details">
            <div className="apify-run-summary">
              <strong>{selectedJob.branchName}</strong>
              <span>{selectedJob.location} · {selectedJob.status}</span>
              <span>Run ID: {selectedJob.runId ?? '—'} · Dataset ID: {selectedJob.datasetId ?? '—'}</span>
            </div>
            {jobDetailsLoading ? <div className="table-message">Carregando JSON e resultados...</div> : null}
            {!jobDetailsLoading && jobItems ? (
              <>
                <h3>Resultados ({jobItems.length})</h3>
                <pre className="apify-json-viewer">{JSON.stringify(jobItems, null, 2)}</pre>
              </>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={drawerOpen}
        title={drawerMode === 'edit' ? 'Editar lead' : 'Detalhes do lead'}
        description="Ajuste os dados do lead. Nesta etapa a alteração fica no serviço local de importação."
        onClose={closeDrawer}
        footer={
          drawerMode === 'edit' ? (
            <>
              <Button variant="secondary" onClick={() => editingLead ? openLeadDrawer(editingLead, 'view') : closeDrawer()}>Cancelar</Button>
              <Button loading={saving} onClick={saveEditedLead}>Salvar</Button>
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
          <Field label="Ramo" value={leadForm.ramo} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('ramo', value)} />
          <label className="drawer-field">
            <span>Destino</span>
            {drawerMode === 'view' ? <Field value={leadForm.destino} readOnly /> : <SelectField value={leadForm.destino} options={destinationOptions} onChange={(value) => updateForm('destino', value)} />}
          </label>
          <Field label="WhatsApp" value={leadForm.whatsapp} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('whatsapp', value)} />
          <Field label="Instagram" value={leadForm.instagram} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('instagram', value)} />
          <Field label="Site" value={leadForm.site} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('site', value)} />
          <label className="drawer-field">
            <span>Enviar Instagram?</span>
            {drawerMode === 'view' ? <Field value={leadForm.send_instagram} readOnly /> : <SelectField value={leadForm.send_instagram} options={['Não', 'Sim']} onChange={(value) => updateForm('send_instagram', value as LeadForm['send_instagram'])} />}
          </label>
          <Field label="Motivo do override Instagram" value={leadForm.instagram_override_reason} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('instagram_override_reason', value)} />
          <Field label="Cidade" value={leadForm.cidade} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('cidade', value)} />
          <Field label="Estado" value={leadForm.estado} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('estado', value)} />
          <Field as="textarea" label="Motivo" value={leadForm.motivo} readOnly={drawerMode === 'view'} onChange={(value) => updateForm('motivo', value)} />
        </div>
      </Drawer>

      <ConfirmDialog
        open={deleteLead !== null}
        title="Excluir lead?"
        description="Essa acao remove o lead apenas da importacao local desta etapa."
        confirmLabel="Excluir"
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
