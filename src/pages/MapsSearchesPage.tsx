import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DataTable, Drawer, MetricCard, Panel, SegmentedControl, TableCard, Tag, type TableColumn } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { getSupabaseClient } from '../lib/supabase';

type SearchRow = Record<string, unknown> & { maps_search_executions_id: string; branch_name: string; created_at: string; status: string };
type Detail = { coverage: Record<string, unknown>[]; candidates: Record<string, unknown>[] };
type DisplayRow = Record<string, ReactNode>;

const statusTone = (status: string) => status === 'completed' ? 'success' : status === 'error' ? 'danger' : status === 'paused' ? 'warning' : 'neutral';

export function MapsSearchesPage() {
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [selected, setSelected] = useState<SearchRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, unknown>[] | null>(null);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [tab, setTab] = useState('Resultados');
  const [error, setError] = useState('');

  useEffect(() => {
    void getSupabaseClient().from('maps_search_executions').select('*,branches:branches_id(branches_name),states:states_id(states_name,states_code),cities:requested_cities_id(cities_name)').order('created_at', { ascending: false }).limit(100)
      .then(({ data, error: queryError }) => queryError ? setError(queryError.message) : setSearches((data || []) as SearchRow[]));
  }, []);

  const open = async (row: SearchRow) => {
    setSelected(row); setDetail(null); setSnapshots(null); setTab('Resultados');
    const id = row.maps_search_executions_id;
    const client = getSupabaseClient();
    const [coverage, candidates] = await Promise.all([
      client.from('maps_search_coverage').select('maps_search_coverage_id,city_name,search_term,status,found_count,termination_reason,last_error,created_at').eq('maps_search_executions_id', id).order('cities_id').order('created_at'),
      client.from('maps_search_candidates').select('maps_search_candidates_id,candidate_name,effective_phone,effective_whatsapp,effective_instagram,effective_website,eligibility_status,excluded_by_user,promoted_leads_id,created_at').eq('maps_search_executions_id', id).order('created_at'),
    ]);
    const firstError = coverage.error || candidates.error;
    if (firstError) { setError(firstError.message); return; }
    setDetail({ coverage: coverage.data || [], candidates: candidates.data || [] });
  };

  const changeTab = async (nextTab: string) => {
    setTab(nextTab);
    if (nextTab !== 'JSON' || !selected || snapshots !== null || snapshotsLoading) return;
    setSnapshotsLoading(true);
    const response = await getSupabaseClient().from('maps_search_snapshots')
      .select('maps_search_snapshots_id,maps_search_coverage_id,snapshot_payload,created_at')
      .eq('maps_search_executions_id', selected.maps_search_executions_id)
      .order('created_at');
    setSnapshotsLoading(false);
    if (response.error) { setError(response.error.message); return; }
    setSnapshots(response.data || []);
  };

  const rows = useMemo<DisplayRow[]>(() => searches.map((row) => ({
    created_at: new Date(row.created_at).toLocaleString('pt-BR'),
    branch_name: row.branch_name,
    state: String((row.states as Record<string, unknown> | null)?.states_code || '—'),
    city: String((row.cities as Record<string, unknown> | null)?.cities_name || 'Automático'),
    requested_days: String(row.requested_days || 0),
    found_count: String(row.found_count || 0),
    eligible_count: String(row.eligible_count || 0),
    promoted_leads_count: String(row.promoted_leads_count || 0),
    contacts: `${row.phone_whatsapp_candidate_count || 0} Tel/WA • ${row.instagram_candidate_count || 0} IG`,
    status: <Tag tone={statusTone(row.status)}>{row.status}</Tag>,
  })), [searches]);

  const columns = useMemo<TableColumn<DisplayRow>[]>(() => [
    { key: 'created_at', label: 'Data' },
    { key: 'branch_name', label: 'Ramo' },
    { key: 'state', label: 'Estado' },
    { key: 'city', label: 'Cidade' },
    { key: 'requested_days', label: 'Dias' },
    { key: 'found_count', label: 'Encontrados' },
    { key: 'eligible_count', label: 'Candidatos' },
    { key: 'promoted_leads_count', label: 'Leads salvos' },
    { key: 'contacts', label: 'Contatos' },
    { key: 'status', label: 'Status' },
  ], []);

  return (
    <>
      <PageHeader title="Pesquisas Google Maps" description="Histórico persistido pela extensão. A configuração operacional acontece no Side Panel." />
      {error ? <Panel title="Falha ao consultar pesquisas"><p>{error}</p></Panel> : null}
      <section className="metric-grid metric-grid--4"><MetricCard value={String(searches.length)} label="Pesquisas" /><MetricCard value={String(searches.reduce((sum, row) => sum + Number(row.found_count || 0), 0))} label="Encontrados" /><MetricCard value={String(searches.reduce((sum, row) => sum + Number(row.eligible_count || 0), 0))} label="Candidatos" /><MetricCard value={String(searches.reduce((sum, row) => sum + Number(row.promoted_leads_count || 0), 0))} label="Leads salvos" /></section>
      <TableCard title="Histórico" footerText={`${searches.length} pesquisa(s)`}><DataTable rows={rows} columns={columns} selectable={false} actions={['view']} onAction={(_, __, index) => void open(searches[index])} /></TableCard>
      <Drawer open={Boolean(selected)} title={selected?.branch_name || 'Pesquisa Google Maps'} description={selected ? `${new Date(selected.created_at).toLocaleString('pt-BR')} • ${selected.status}` : ''} size="wide" onClose={() => setSelected(null)}>
        <SegmentedControl items={['Resultados', 'Cobertura', 'JSON']} active={tab} onChange={(nextTab) => void changeTab(nextTab)} />
        {!detail ? <p>Carregando…</p> : null}
        {detail && tab === 'Resultados' ? <div className="maps-history-list">{detail.candidates.map((candidate) => <article key={String(candidate.maps_search_candidates_id)}><strong>{String(candidate.candidate_name || 'Empresa')}</strong><span>{[candidate.effective_phone, candidate.effective_whatsapp, candidate.effective_instagram, candidate.effective_website].filter(Boolean).join(' • ') || 'Sem contato elegível'}</span></article>)}</div> : null}
        {detail && tab === 'Cobertura' ? <div className="maps-history-list">{detail.coverage.map((coverage) => <article key={String(coverage.maps_search_coverage_id)}><strong>{String(coverage.city_name)} • {String(coverage.search_term)}</strong><span>{String(coverage.status)} • {String(coverage.found_count || 0)} encontrados • {String(coverage.termination_reason || coverage.last_error || 'em andamento')}</span></article>)}</div> : null}
        {detail && tab === 'JSON' && snapshotsLoading ? <p>Carregando JSON da pesquisa...</p> : null}
        {detail && tab === 'JSON' && snapshots !== null ? <pre className="maps-history-json">{JSON.stringify({ execution: selected, coverage: detail.coverage, snapshots }, null, 2)}</pre> : null}
      </Drawer>
    </>
  );
}
