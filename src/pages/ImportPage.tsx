import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, Globe2, Users, X } from 'lucide-react';
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
import { DestinationBadge } from '../components/DestinationBadge';
import { useImportLeads } from '../hooks/useImportLeads';
import { useImportSettings } from '../hooks/useImportSettings';
import { isValidInstagram } from '../services/instagram/instagram.utils';
import { permissionsFor } from '../services/permissions';
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

function silentLink(label: string, href?: string) {
  if (!href) return label;
  return <a className="silent-link" href={href} target="_blank" rel="noreferrer" title={href}>{label}</a>;
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

  const { settings: importSettings } = useImportSettings();
  const simulateImport = importSettings?.safeMode.simulationMode ?? true;
  const { leads, summary, loading, error, importJson, createLead, updateLead, removeLead, moveLead, moveMany, clearSession, sendApprovedToPreSend } = useImportLeads(activeStatus, search);
  const previewToken = useRef(0);

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

  const sendToPreSend = async () => {
    try {
      const created = await sendApprovedToPreSend();
      if (!created.length) {
        pushToast({ title: 'Nada enviado', description: 'Nao ha aprovados novos para enviar ao pre-envio.', tone: 'warning' });
        return;
      }
      pushToast({ title: 'Enviado ao pre-envio', description: `${created.length} lead(s) disponivel(is) no pre-envio.`, tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao enviar', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    }
  };

  const handleAction = async (action: TableAction, lead: ImportLead) => {
    if (action === 'edit' || action === 'view') {
      openLeadDrawer(lead, action === 'edit' ? 'edit' : 'view');
      return;
    }

    if (action === 'delete') {
      setDeleteLead(lead);
      return;
    }

    if (action === 'refresh' || action === 'archive') {
      const permissions = permissionsFor('import', lead.status);
      const nextStatus = permissions.canReject() ? 'rejected' : permissions.canApprove() ? 'approved' : null;
      if (!nextStatus) {
        pushToast({ title: 'Acao bloqueada', description: 'Este lead nao pode mudar de aprovacao neste estado.', tone: 'warning' });
        return;
      }
      await moveLead(lead.id, nextStatus);
      pushToast({
        title: nextStatus === 'approved' ? 'Lead aprovado' : 'Lead recusado',
        description: 'Lead movido entre as listas.',
        tone: nextStatus === 'approved' ? 'success' : 'warning',
      });
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
    { key: 'empresa', label: 'Nome da empresa', width: '42%', render: (lead) => silentLink(lead.empresa, mapsHref(lead)) },
    { key: 'ramo', label: 'Ramo', width: '28%' },
    {
      key: 'destino',
      label: 'Destino',
      width: '20%',
      render: (lead) => {
        const destination = lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino;
        if (destination === 'Recusado') return <Tag tone="danger">Recusado</Tag>;
        if (destination === 'Já no banco') return <Tag tone="warning">Já no banco</Tag>;
        return <DestinationBadge value={destination} />;
      },
    },
  ];

  return (
    <div className="import-page">
      <PageHeader title="Importar" />
      <section className="import-metrics">
        <div className="metric-grid metric-grid--3">
          <MetricCard icon={Users} value={String(summary.total)} label="Total" />
          <MetricCard icon={Globe2} value={String(summary.approved)} label="Aprovados" tone="success" />
          <MetricCard icon={X} value={String(summary.rejected)} label="Recusados" tone="danger" />
        </div>
        <div className="metric-grid metric-grid--4">
          <MetricCard value={String(summary.whatsapp)} label="WhatsApp" />
          <MetricCard value={String(summary.ownSite)} label="Com site" />
          <MetricCard value={String(summary.aggregators)} label="Agregadores" />
          <MetricCard value={String(summary.instagram)} label="Instagram" />
        </div>
      </section>

      <section className="import-grid">
        <Panel title="JSON da Apify" className="import-json">
          <p>Cole o JSON abaixo. A prévia inicia zerada e mostra apenas o resultado da última simulação/importação.</p>
          <Field
            as="textarea"
            className="json-dropzone"
            placeholder="Cole aqui o JSON exportado da Apify"
            value={jsonText}
            onChange={setJsonText}
          />
          <div className="import-json__actions">
            <Button variant="secondary" onClick={() => { setJsonText(''); setLastImport(null); clearSession(); setPage(1); }}>Limpar importação</Button>
            <Button variant="secondary" disabled={summary.approved === 0} onClick={sendToPreSend}>Enviar WhatsApp ao Pré-Envio</Button>
            <Button iconLeft={Database} loading={isImporting} disabled={!jsonText.trim() || isPreviewing} onClick={handleImport}>{simulateImport ? 'Simular regras' : 'Importar'}</Button>
          </div>
          {lastImport ? (
            <div className="import-result">
              <strong>Última importação</strong>
              <span>{lastImport.report.simulation ? 'Simulação sem gravação' : `${lastImport.created} importado(s)`}</span>
              <span>{lastImport.report.processed} processado(s)</span>
              <span>{lastImport.approved} aprovado(s)</span>
              <span>{lastImport.rejected} recusado(s)</span>
              {lastImport.ignored > 0 ? <span>{lastImport.ignored} ignorado(s)</span> : null}
              {lastImport.report.duplicates > 0 ? <span>{lastImport.report.duplicates} duplicado(s)</span> : null}
              <span>{lastImport.report.durationMs}ms</span>
              {lastImport.report.reasons.length ? (
                <div className="import-result__reasons">
                  {lastImport.report.reasons.map((reason) => (
                    <span key={reason.code}>{reason.label}: {reason.count}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </Panel>

        <TableCard
          title="Prévia"
          footerText={`Mostrando ${pageRows.length} de ${leads.length} ${rejected ? 'recusados' : 'aprovados'}`}
          footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={(value) => { setRowsPerPage(value); setPage(1); setSelectedRows([]); }} />}
          page={currentPage}
          totalPages={totalPages}
          onPageChange={(nextPage) => { setPage(nextPage); setSelectedRows([]); }}
        >
          <div className="preview-tabs">
            <SegmentedControl
              items={['Aprovados', 'Recusados']}
              active={rejected ? 'Recusados' : 'Aprovados'}
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
              actions={rejected ? ['view', 'refresh'] : ['view', 'archive']}
              getRowActions={(lead) => {
                const permissions = permissionsFor('import', lead.status);
                return [
                  'view' as TableAction,
                  ...(permissions.canApprove() ? ['refresh' as TableAction] : []),
                  ...(permissions.canReject() ? ['archive' as TableAction] : []),
                ];
              }}
              columns={columns}
              rows={pageRows}
              onAction={handleAction}
            />
          ) : null}
        </TableCard>
      </section>

      <Panel title="Validação manual" className="manual-validation">
        <div className="manual-validation__fields">
          <Field label="Nome da empresa" placeholder="Digite o nome da empresa" value={manualLead.empresa} onChange={(empresa) => setManualLead((current) => ({ ...current, empresa }))} />
          <Field label="Número WhatsApp" placeholder="Digite o número WhatsApp" value={manualLead.whatsapp} onChange={(whatsapp) => setManualLead((current) => ({ ...current, whatsapp }))} />
          <Field label="Link Instagram" placeholder="Digite o link Instagram" value={manualLead.instagram} onChange={(instagram) => setManualLead((current) => ({ ...current, instagram }))} />
        </div>
        <div className="manual-validation__actions">
          <Button variant="secondary" disabled={!manualLead.empresa} onClick={() => setManualLead({ empresa: '', whatsapp: '', instagram: '' })}>Limpar</Button>
          <Button disabled={!manualLead.empresa} onClick={addManualLead}>Adicionar lead</Button>
        </div>
      </Panel>

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
