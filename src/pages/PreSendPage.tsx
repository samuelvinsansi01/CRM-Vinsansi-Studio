import { Archive, Check, PhoneCall, RefreshCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  MetricCard,
  TableCard,
  Tag,
  ToastViewport,
  type TableAction,
  type TableColumn,
  type ToastItem,
} from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { getSupabaseClient } from '../lib/supabase';
import { mapLead } from '../mappers/lead.mapper';
import { getCurrentUserId } from '../repositories/supabase.helpers';
import type { BaseLead } from '../services/base/types';
import { statusLabel, statusTone } from '../services/status/status.mapper';
import type { LeadDatabaseRow } from '../types/lead.types';

const LEADS_SELECT = `
  leads_id, users_id, branches_id, countries_id, states_id, cities_id,
  channels_id, lead_status_id, contact_sources_id, apify_import_jobs_id,
  leads_name, leads_phone, leads_instagram, leads_website, leads_maps,
  leads_street, leads_postal_code, leads_categories, leads_score,
  leads_reviews_count, leads_origin, leads_created_at, leads_updated_at,
  branches:branches_id ( branches_id, branches_name ),
  countries:countries_id ( countries_id, countries_name, countries_code ),
  states:states_id ( states_id, states_name, states_code ),
  cities:cities_id ( cities_id, cities_name ),
  channels:channels_id ( channels_id, channels_name ),
  lead_status:lead_status_id ( lead_status_id, lead_status_name ),
  contact_sources:contact_sources_id ( contact_sources_id, contact_sources_name )
`;

type Row = Record<string, ReactNode> & { id: string };

const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Nome da empresa', width: '30%' },
  { key: 'branch', label: 'Ramo', width: '20%' },
  { key: 'state', label: 'Estado', width: '12%' },
  { key: 'city', label: 'Cidade', width: '14%' },
  { key: 'phone', label: 'WhatsApp', width: '14%' },
  { key: 'status', label: 'Status', width: '10%' },
];

function mapsHref(lead: BaseLead) {
  if (lead.mapsUrl) return lead.mapsUrl;
  const query = [lead.company, lead.city, lead.state].filter(Boolean).join(' ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function companyLink(lead: BaseLead) {
  const href = mapsHref(lead);
  return href ? <a className="silent-link" href={href} target="_blank" rel="noreferrer">{lead.company}</a> : lead.company;
}

export function PreSendPage() {
  const [leads, setLeads] = useState<BaseLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, ...toast }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const userId = await getCurrentUserId();
      const pageSize = 1000;
      const allRows: LeadDatabaseRow[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error: queryError } = await getSupabaseClient()
          .from('leads')
          .select(LEADS_SELECT)
          .eq('users_id', userId)
          .eq('lead_status_id', 3)
          .neq('channels_id', 2)
          .order('leads_created_at', { ascending: false })
          .order('leads_id', { ascending: false })
          .range(from, from + pageSize - 1);
        if (queryError) throw new Error(queryError.message);
        const page = (data ?? []) as unknown as LeadDatabaseRow[];
        allRows.push(...page);
        if (page.length < pageSize) break;
      }
      setLeads(allRows.map(mapLead));
      setSelectedRows([]);
    } catch (err) {
      setLeads([]);
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o Pré-Envio.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<Row[]>(() => leads.map((lead) => ({
    id: lead.id,
    company: companyLink(lead),
    branch: lead.branch || '-',
    state: lead.state || '-',
    city: lead.city || '-',
    phone: lead.phone || '-',
    status: <Tag tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Tag>,
  })), [leads]);

  const selectedIds = selectedRows.map((index) => rows[index]?.id).filter(Boolean);

  const updateStatuses = async (ids: string[], statusId: 2 | 6 | 8, successMessage: string) => {
    if (!ids.length) return;
    setSaving(true);
    try {
      const userId = await getCurrentUserId();
      const { error: updateError } = await getSupabaseClient()
        .from('leads')
        .update({ lead_status_id: statusId, leads_updated_at: new Date().toISOString() })
        .in('leads_id', ids.map(Number))
        .eq('users_id', userId)
        .eq('lead_status_id', 3);
      if (updateError) throw new Error(updateError.message);
      pushToast({ title: successMessage, description: `${ids.length} lead(s) atualizado(s).`, tone: statusId === 2 ? 'success' : 'warning' });
      await load();
    } catch (err) {
      pushToast({ title: 'Não foi possível concluir', description: err instanceof Error ? err.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (action: TableAction, row: Row) => {
    if (action === 'approve') await updateStatuses([row.id], 2, 'Lead validado');
    if (action === 'invalidate') await updateStatuses([row.id], 6, 'Lead invalidado');
    if (action === 'archive') await updateStatuses([row.id], 8, 'Lead arquivado');
  };

  return (
    <div className="dashboard-table-page lead-list-page">
      <PageHeader
        title="Pré-Envio"
        description="Valide os números de WhatsApp. Ao validar, o lead sai automaticamente daqui e entra em Válidos."
        action={<Button variant="secondary" iconLeft={RefreshCcw} disabled={loading || saving} onClick={() => void load()}>Atualizar</Button>}
      />

      <section className="metric-grid metric-grid--1">
        <MetricCard icon={PhoneCall} value={String(leads.length)} label="WhatsApp para validar" tone="success" />
      </section>

      <TableCard
        title="Leads aguardando validação"
        footerText={loading ? 'Carregando leads...' : `Mostrando ${rows.length} lead(s). ${selectedIds.length} selecionado(s).`}
      >
        {selectedIds.length ? (
          <div className="lead-bulk-actions">
            <span>{selectedIds.length} selecionado(s)</span>
            <Button size="sm" iconLeft={Check} disabled={saving} onClick={() => void updateStatuses(selectedIds, 2, 'Leads validados')}>Validar leads</Button>
            <Button size="sm" variant="secondary" iconLeft={X} disabled={saving} onClick={() => void updateStatuses(selectedIds, 6, 'Leads invalidados')}>Invalidar</Button>
            <Button size="sm" variant="secondary" iconLeft={Archive} disabled={saving} onClick={() => void updateStatuses(selectedIds, 8, 'Leads arquivados')}>Arquivar</Button>
          </div>
        ) : null}
        {error ? <div className="table-message">{error}</div> : null}
        {!error && loading ? <div className="table-message">Carregando Pré-Envio...</div> : null}
        {!error && !loading && !rows.length ? <div className="table-message">Nenhum WhatsApp aguardando validação.</div> : null}
        {!error && !loading && rows.length ? (
          <DataTable
            columns={columns}
            rows={rows}
            actions={['approve', 'invalidate', 'archive']}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            onAction={handleAction}
          />
        ) : null}
      </TableCard>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
