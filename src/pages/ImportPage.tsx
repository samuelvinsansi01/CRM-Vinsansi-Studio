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
import { useClientPagination } from '../hooks/useClientPagination';
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
  branchId: string;
  ramo: string;
  destino: ImportLeadDestination;
  whatsapp: string;
  instagram: string;
  site: string;
  cidade: string;
  estado: string;
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
]);

function formatRejectionReasons(result: ImportParseResult) {
  const reasons = result.report.reasons
    .filter((reason) => reason.code !== 'approved' && reason.code !== 'ignored' && !duplicateReasonCodes.has(reason.code))
    .filter((reason) => reason.count > 0)
    .sort((a, b) => b.count - a.count);

  if (!reasons.length) return '';
  return ` Motivos das recusas: ${reasons.map((reason) => `${reason.label}: ${reason.count}`).join('; ')}.`;
}

function eligibleCount(result: ImportParseResult) {
  return result.leads.filter((lead) => isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'pending') || isStatusGroup(lead.status, 'review')).length;
}

function formatSimulationSummary(result: ImportParseResult) {
  return `${eligibleCount(result)} elegível(is), ${result.report.rejected} recusado(s), ${result.report.duplicates} duplicado(s) e 0 lead(s) persistido(s) por causa da simulação.`;
}

function formatApifyImportSummary(result: ImportParseResult) {
  if (result.report.simulation) return formatSimulationSummary(result);
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

function apifyStatusLabel(job: ApifyImportJob, simulated = false) {
  if (simulated) return 'Simulado';
  if (job.importedAt) return 'Importado';
  if (job.status === 'starting') return 'Iniciando';
  if (job.status === 'ready') return 'Pronto';
  if (job.status === 'running') return 'Executando';
  if (job.status === 'succeeded') return 'Concluído';
  if (job.status === 'failed') return 'Falhou';
  if (job.status === 'aborted') return 'Cancelado';
  return 'Tempo excedido';
}

function apifyStatusTone(job: ApifyImportJob): 'neutral' | 'success' | 'warning' | 'danger' {
  if (job.importedAt || job.status === 'succeeded') return 'success';
  if (job.status === 'failed' || job.status === 'timed_out') return 'danger';
  if (job.status === 'aborted') return 'neutral';
  return 'warning';
}

type ApifyRunRow = {
  jobId: number;
  status: string;
  account: string;
  branch: string;
  location: string;
  results: number;
  created: number;
  duplicates: number;
  rejected: number;
  date: string;
};

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

  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [mapsLimit, setMapsLimit] = useState('100');
  const [locationOptions, setLocationOptions] = useState<ApifyLocationOption[]>([]);
  const [searchedLocations, setSearchedLocations] = useState<string[]>([]);

  const selectedLocation = useMemo(
    () => locationOptions.find((location) => String(location.cityId) === selectedLocationId) ?? null,
    [locationOptions, selectedLocationId],
  );

  const searchedLocationKeys = useMemo(
    () => new Set(searchedLocations.map(normalizeLocationKey)),
    [searchedLocations],
  );

  const selectedLocationWasSearched = Boolean(
    selectedLocation && searchedLocationKeys.has(normalizeLocationKey(selectedLocation.label)),
  );

  const locationSelectOptions = useMemo(
    () => locationOptions.map((location) => {
      const wasSearched = searchedLocationKeys.has(normalizeLocationKey(location.label));
      return {
        label: wasSearched ? `${location.label} — já pesquisada neste ramo` : location.label,
        value: String(location.cityId),
      };
    }),
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
  const [simulatedApifyJobIds, setSimulatedApifyJobIds] = useState<Set<number>>(() => new Set());

  const { settings: importSettings } = useImportSettings();
  const { activeAccounts: apifyAccounts, loading: loadingApifyAccounts, error: apifyAccountsError } = useApifyAccounts();
  const simulateImport = importSettings?.safeMode.simulationMode ?? true;
  const { leads, summary, loading, error, importJson, createLead, updateLead, removeLead, moveLead, moveMany, clearSession, sendApprovedToInicio } = useImportLeads(activeStatus, search);
  const {
    page: jobsPage,
    setPage: setJobsPage,
    rowsPerPage: jobsPerPage,
    setRowsPerPage: setJobsPerPage,
    totalPages: jobsTotalPages,
    pageItems: pagedApifyJobs,
  } = useClientPagination(apifyJobs, 10);
  const apifyJobById = useMemo(() => new Map(apifyJobs.map((job) => [job.jobId, job])), [apifyJobs]);
  const apifyRunRows = useMemo<ApifyRunRow[]>(() => pagedApifyJobs.map((job) => ({
    jobId: job.jobId,
    status: apifyStatusLabel(job, simulatedApifyJobIds.has(job.jobId)),
    account: job.accountName,
    branch: job.branchName,
    location: job.location,
    results: job.totalReceived,
    created: job.totalImported,
    duplicates: job.totalDuplicates,
    rejected: job.totalRejected,
    date: job.createdAt ? new Date(job.createdAt).toLocaleString('pt-BR') : '—',
  })), [pagedApifyJobs, simulatedApifyJobIds]);
  const apifyRunColumns: TableColumn<ApifyRunRow>[] = useMemo(() => [
    { key: 'status', label: 'Status', width: '11%', render: (row) => {
      const job = apifyJobById.get(row.jobId);
      return job ? <Tag tone={apifyStatusTone(job)}>{row.status}</Tag> : row.status;
    } },
    { key: 'account', label: 'Conta', width: '18%' },
    { key: 'branch', label: 'Ramo', width: '16%' },
    { key: 'location', label: 'Localização', width: '14%' },
    { key: 'results', label: 'Resultados', width: '8%' },
    { key: 'created', label: 'Criados', width: '7%' },
    { key: 'duplicates', label: 'Duplicados', width: '8%' },
    { key: 'rejected', label: 'Recusados', width: '8%' },
    { key: 'date', label: 'Data', width: '14%' },
  ], [apifyJobById]);
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
    setSelectedLocationId('');
    setSearchedLocations([]);
    const branch = uniqueBranches.find((item) => item.id === selectedBranchId);
    if (!selectedBranchId) return;

    setLocationsLoading(true);
    void apifyImportService.listSuccessfullySearchedLocations(Number(selectedBranchId), branch?.name ?? '')
      .then(setSearchedLocations)
      .catch((err) => {
        pushToast({ title: 'Não foi possível verificar as localidades já pesquisadas', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
      })
      .finally(() => setLocationsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, uniqueBranches]);

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


  const importApifyDataset = async (jobId: number) => {
    const claim = await apifyImportService.claimGoogleMapsDataset(jobId);
    if (!claim.items || !claim.claimToken || !claim.claimedAt) {
      throw new Error('O dataset foi concluído, mas não pôde ser assumido para importação.');
    }

    try {
      const importedResult = await importJson(JSON.stringify(claim.items), {
        apifyImportJobId: jobId,
        origin: 'apify',
      });
      if (importedResult.report.simulation) {
        setSimulatedApifyJobIds((current) => new Set(current).add(jobId));
      }
      setLastImport(importedResult);
      setSearch('');
      setPage(1);
      setSelectedRows([]);

      await apifyImportService.finalizeGoogleMapsImport({
        jobId,
        claimToken: claim.claimToken,
        claimedAt: claim.claimedAt,
        processed: importedResult.report.processed,
        imported: importedResult.report.created,
        duplicates: importedResult.report.duplicates,
        rejected: importedResult.report.rejected,
      });
      return importedResult;
    } catch (error) {
      await apifyImportService.releaseGoogleMapsImportClaim({
        jobId,
        claimToken: claim.claimToken,
        claimedAt: claim.claimedAt,
        reason: error instanceof Error ? error.message : 'Falha na importação do dataset.',
      }).catch(() => undefined);
      throw error;
    }
  };

  const processApifyJob = async (jobId: number, poll = true) => {
    const attempts = poll ? 120 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 3000));
      const sync = await apifyImportService.syncGoogleMapsExtractor(jobId);

      if (sync.status === 'failed' || sync.status === 'aborted' || sync.status === 'timed_out') {
        throw new Error(`A execução da Apify terminou com status ${sync.status}.`);
      }
      if (sync.status !== 'succeeded') continue;
      if (sync.imported) return null;
      return importApifyDataset(jobId);
    }
    throw new Error('A coleta continua em processamento. Use Sincronizar no histórico para consultar novamente.');
  };

  const syncJob = async (job: ApifyImportJob) => {
    setStartingApify(true);
    try {
      const result = await processApifyJob(job.jobId, false);
      await loadApifyJobs();
      if (result) {
        pushToast({
          title: result.report.simulation ? 'Simulação do dataset concluída' : 'Dataset importado',
          description: formatApifyImportSummary(result),
          tone: result.report.simulation ? 'info' : result.report.rejected > 0 ? 'warning' : 'success',
        });
      } else {
        pushToast({ title: 'Run sincronizado', description: 'O job foi atualizado. Se já estava importado, nenhuma duplicação foi executada.', tone: 'success' });
      }
    } catch (err) {
      await loadApifyJobs();
      pushToast({ title: 'Sincronização incompleta', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'warning' });
    } finally {
      setStartingApify(false);
    }
  };

  const abortJob = async (job: ApifyImportJob) => {
    setStartingApify(true);
    try {
      await apifyImportService.abortGoogleMapsJob(job.jobId);
      await loadApifyJobs();
      pushToast({ title: 'Coleta cancelada', description: `O run ${job.runId ?? job.jobId} foi cancelado.`, tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Não foi possível cancelar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setStartingApify(false);
    }
  };

  useEffect(() => {
    if (recoveredApifyJob.current) return;
    recoveredApifyJob.current = true;

    void (async () => {
      try {
        await apifyImportService.recoverStaleImportClaims();
        const pendingJob = await apifyImportService.findLatestPendingGoogleMapsJob();
        if (!pendingJob) return;
        setStartingApify(true);
        const importedResult = await processApifyJob(pendingJob.jobId);
        if (!importedResult) return;
        pushToast({
          title: importedResult.report.simulation ? 'Coleta anterior recuperada em simulação' : 'Coleta anterior recuperada',
          description: formatApifyImportSummary(importedResult),
          tone: importedResult.report.simulation ? 'info' : importedResult.report.rejected > 0 ? 'warning' : 'success',
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
    if (!selectedApifyAccountId || !selectedBranch || !selectedLocation || !selectedLocationId) return;
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      pushToast({ title: 'Quantidade inválida', description: 'Informe uma quantidade entre 1 e 500.', tone: 'danger' });
      return;
    }

    setStartingApify(true);
    try {
      const result = await apifyImportService.startGoogleMapsExtractor({
        apifyAccountId: Number(selectedApifyAccountId),
        locationCityId: selectedLocation.cityId,
        limit,
        branchId: Number(selectedBranch.id),
      });
      pushToast({
        title: 'Coleta iniciada',
        description: `A conta ${result.account?.name ?? result.accountName} iniciou o Google Maps Extractor. Execução: ${result.runId}.${simulateImport ? ' A coleta pode consumir créditos do Apify, mas nenhum lead será persistido.' : ''}`,
        tone: 'success',
      });

      const importedResult = await processApifyJob(result.jobId);
      if (!importedResult) {
        pushToast({ title: 'Dataset já processado', description: 'Esta execução já havia sido importada e não será duplicada.', tone: 'success' });
        return;
      }
      await loadApifyJobs();
      pushToast({
        title: importedResult.report.simulation ? 'Coleta validada em simulação' : 'Coleta validada e importada',
        description: formatApifyImportSummary(importedResult),
        tone: importedResult.report.simulation ? 'info' : importedResult.report.rejected > 0 ? 'warning' : 'success',
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
    if (!manualLead.empresa.trim()) return;

    try {
      const createResult = await createLead({
        empresa: manualLead.empresa,
        ramo: importSettings?.branchRules[0]?.branch ?? '',
        destino: manualLead.instagram && !manualLead.whatsapp ? 'Instagram' : 'WhatsApp',
        original_destination: manualLead.instagram && !manualLead.whatsapp ? 'Instagram' : 'WhatsApp',
        destination: manualLead.instagram && !manualLead.whatsapp ? 'Instagram' : 'WhatsApp',
        destination_override: undefined,
        send_instagram: false,
        instagram_url: manualLead.instagram,
        status: manualLead.instagram && !manualLead.whatsapp ? 'pending' : 'review',
        whatsapp: manualLead.whatsapp,
        instagram: manualLead.instagram,
        site: '',
        cidade: '',
        estado: '',
        motivo: '',
      });
      if (createResult.simulation) {
        pushToast({ title: 'Simulação ativa', description: 'O cadastro foi bloqueado e nenhum lead foi persistido.', tone: 'info' });
        return;
      }
      setManualLead({ empresa: '', whatsapp: '', instagram: '' });
      setPage(1);
      setSelectedRows([]);
      pushToast({ title: 'Lead adicionado', description: createResult.lead?.destination === 'WhatsApp' ? 'Lead salvo aguardando validação WhatsApp.' : 'Lead salvo para revisão do Instagram.', tone: 'success' });
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

      <div className="import-source-tabs" role="tablist" aria-label="Tipo de importação">
        <button type="button" role="tab" aria-selected={importTab === 'Apify'} className={importTab === 'Apify' ? 'is-active' : ''} onClick={() => setImportTab('Apify')}>Apify</button>
        <button type="button" role="tab" aria-selected={importTab === 'Manual'} className={importTab === 'Manual' ? 'is-active' : ''} onClick={() => setImportTab('Manual')}>Manual</button>
      </div>

      {importTab === 'Apify' ? (
        <>
        <Panel title="Google Maps Extractor" className="import-extractor-panel">
          <p>Escolha manualmente a conta que será usada nesta coleta. A plataforma não troca a conta automaticamente.</p>
          {simulateImport ? <p className="import-simulation-note">A coleta pode consumir créditos do Apify, mas nenhum lead será persistido.</p> : null}
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
                value={selectedLocationId}
                placeholder={!selectedBranchId ? 'Selecione primeiro um ramo' : locationsLoading ? 'Carregando localidades...' : 'Selecione uma localidade'}
                searchable
                searchPlaceholder="Buscar cidade ou estado..."
                options={locationSelectOptions}
                onChange={setSelectedLocationId}
              />
            </label>
            <Field label="Quantidade" type="number" min="1" max="500" value={mapsLimit} onChange={setMapsLimit} />
          </div>
          <p className="settings-note">
            {selectedBranch ? <>A busca usará somente o ramo <strong>{selectedBranch.name}</strong>. A localização é enviada separadamente e o histórico de cidades é independente para cada ramo. <strong>{locationOptions.length.toLocaleString('pt-BR')}</strong> localidade(s) carregada(s) do cadastro oficial.</> : 'Selecione um ramo cadastrado para iniciar a busca.'}
          </p>
          {selectedLocationId && !selectedLocation ? <div className="table-message">Selecione uma localidade do cadastro oficial.</div> : null}
          {selectedLocationWasSearched && selectedLocation ? (
            <div className="table-message">
              Você já pesquisou <strong>{selectedBranch?.name ?? 'este ramo'}</strong> em <strong>{selectedLocation.label}</strong>. Uma nova coleta repetirá essa combinação.
            </div>
          ) : null}
          {apifyAccountsError ? <div className="table-message">{apifyAccountsError}</div> : null}
          {!loadingApifyAccounts && !apifyAccounts.length ? <div className="table-message">Cadastre uma conta em Configurações → Importação antes de executar o extractor.</div> : null}
          <div className="import-extractor-actions">
            <Button
              iconLeft={Database}
              loading={startingApify}
              disabled={!selectedApifyAccountId || !selectedBranchId || !selectedLocation}
              onClick={startApifyImport}
            >
              Iniciar coleta
            </Button>
          </div>
        </Panel>
        <section className="apify-runs-section">
          <TableCard
            title="Execuções Apify"
            footerText={`Mostrando ${pagedApifyJobs.length} de ${apifyJobs.length} execução(ões)`}
            footerLeft={<RowsPerPageControl value={jobsPerPage} onChange={setJobsPerPage} />}
            page={jobsPage}
            totalPages={jobsTotalPages}
            onPageChange={setJobsPage}
          >
            {jobsLoading ? <div className="table-message">Carregando runs...</div> : null}
            {!jobsLoading && !apifyJobs.length ? <div className="table-message">Nenhuma execução encontrada.</div> : null}
            {!jobsLoading && apifyJobs.length ? (
              <DataTable
                selectable={false}
                columns={apifyRunColumns}
                rows={apifyRunRows}
                actions={['view', 'refresh', 'cancel']}
                getRowActions={(row) => {
                  const job = apifyJobById.get(row.jobId);
                  if (!job) return [];
                  const actions: TableAction[] = ['view'];
                  if (!job.importedAt && !['failed', 'aborted', 'timed_out'].includes(job.status)) actions.push('refresh');
                  if (['starting', 'ready', 'running'].includes(job.status)) actions.push('cancel');
                  return actions;
                }}
                onAction={(action, row) => {
                  const job = apifyJobById.get(row.jobId);
                  if (!job) return;
                  if (action === 'view') void openJobDetails(job);
                  if (action === 'refresh') void syncJob(job);
                  if (action === 'cancel') void abortJob(job);
                }}
              />
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
              <Button iconLeft={Database} loading={isImporting} disabled={!jsonText.trim() || isPreviewing} onClick={approveLeads}>{simulateImport ? 'Executar simulação' : 'Aprovar leads'}</Button>
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
              <Button disabled={!manualLead.empresa || simulateImport} onClick={addManualLead}>Adicionar lead</Button>
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
              actions={['view', 'edit', 'archive']}
              getRowActions={rowActions}
              onAction={(action, lead) => handleRowAction(action, lead)}
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
              <span>Ramo pesquisado: {selectedJob.branchName} · Limite: {selectedJob.requestedLimit || '—'}</span>
              {simulatedApifyJobIds.has(selectedJob.jobId) ? <span>Processado em modo de simulação nesta sessão; nenhum lead foi persistido.</span> : null}
              {selectedJob.errorMessage ? <span className="table-message">{selectedJob.errorMessage}</span> : null}
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
