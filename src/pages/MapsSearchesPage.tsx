import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DataTable, Drawer, MetricCard, Panel, SegmentedControl, TableCard, Tag, type TableColumn } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { getSupabaseClient } from '../lib/supabase';

type SearchRow = Record<string, unknown> & { maps_search_executions_id: string; branch_name: string; created_at: string; status: string };
type CoverageRow = Record<string, unknown> & { maps_search_coverage_id: string; city_name: string; search_term: string; status: string };
type CandidateRow = Record<string, unknown> & { maps_search_candidates_id: string; candidate_name: string };
type Detail = { coverage: CoverageRow[]; candidates: CandidateRow[] };
type DisplayRow = Record<string, ReactNode>;

const statusTone = (status: string) => status === 'completed' ? 'success' : status === 'error' ? 'danger' : status === 'paused' ? 'warning' : 'neutral';
const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

function candidateBelongsToCoverage(candidate: CandidateRow, coverage: CoverageRow) {
  const ids = Array.isArray(candidate.coverage_ids_found) ? candidate.coverage_ids_found.map(String) : [];
  if (ids.includes(coverage.maps_search_coverage_id)) return true;
  const sameCity = Number(candidate.cities_id) === Number(coverage.cities_id);
  const terms = Array.isArray(candidate.search_terms_found) ? candidate.search_terms_found : [];
  return sameCity && terms.some((term) => normalize(term) === normalize(coverage.search_term));
}

export function MapsSearchesPage() {
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [selected, setSelected] = useState<SearchRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedCoverage, setSelectedCoverage] = useState<CoverageRow | null>(null);
  const [coverageTab, setCoverageTab] = useState('Resultados');
  const [coverageSnapshots, setCoverageSnapshots] = useState<Record<string, unknown>[] | null>(null);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void getSupabaseClient().from('maps_search_executions').select('*,branches:branches_id(branches_name),states:states_id(states_name,states_code),cities:requested_cities_id(cities_name)').order('created_at', { ascending: false }).limit(100)
      .then(({ data, error: queryError }) => queryError ? setError(queryError.message) : setSearches((data || []) as SearchRow[]));
  }, []);

  const open = async (row: SearchRow) => {
    setSelected(row);
    setDetail(null);
    setSelectedCoverage(null);
    setCoverageSnapshots(null);
    setCoverageTab('Resultados');
    const id = row.maps_search_executions_id;
    const client = getSupabaseClient();
    const [coverage, candidates] = await Promise.all([
      client.from('maps_search_coverage').select('maps_search_coverage_id,cities_id,city_name,state_code,search_term,status,found_count,unique_count,eligible_count,rejected_count,duplicate_count,termination_reason,last_error,started_at,finished_at,created_at').eq('maps_search_executions_id', id).order('cities_id').order('term_position').order('created_at'),
      client.from('maps_search_candidates').select('maps_search_candidates_id,cities_id,candidate_name,effective_phone,effective_whatsapp,effective_instagram,effective_website,eligibility_status,excluded_by_user,promoted_leads_id,maps_rating,maps_reviews_count,business_status,acquisition_bucket,search_terms_found,coverage_ids_found,maps_url,created_at').eq('maps_search_executions_id', id).order('created_at'),
    ]);
    const firstError = coverage.error || candidates.error;
    if (firstError) { setError(firstError.message); return; }
    setDetail({ coverage: (coverage.data || []) as CoverageRow[], candidates: (candidates.data || []) as CandidateRow[] });
  };

  const openCoverage = (coverage: CoverageRow) => {
    setSelectedCoverage(coverage);
    setCoverageTab('Resultados');
    setCoverageSnapshots(null);
  };

  const changeCoverageTab = async (nextTab: string) => {
    setCoverageTab(nextTab);
    if (nextTab !== 'JSON' || !selected || !selectedCoverage || coverageSnapshots !== null || snapshotsLoading) return;
    setSnapshotsLoading(true);
    const response = await getSupabaseClient().from('maps_search_snapshots')
      .select('maps_search_snapshots_id,maps_search_coverage_id,snapshot_payload,created_at')
      .eq('maps_search_executions_id', selected.maps_search_executions_id)
      .eq('maps_search_coverage_id', selectedCoverage.maps_search_coverage_id)
      .order('created_at');
    setSnapshotsLoading(false);
    if (response.error) { setError(response.error.message); return; }
    setCoverageSnapshots(response.data || []);
  };

  const rows = useMemo<DisplayRow[]>(() => searches.map((row) => ({
    created_at: new Date(row.created_at).toLocaleString('pt-BR'),
    branch_name: row.branch_name,
    state: String((row.states as Record<string, unknown> | null)?.states_code || '—'),
    city: String((row.cities as Record<string, unknown> | null)?.cities_name || 'Automático'),
    target: `${row.target_phone_whatsapp || 0} WA + ${row.target_instagram || 0} IG`,
    allocated: `${row.whatsapp_bucket_count || 0} WA + ${row.instagram_bucket_count || 0} IG`,
    found_count: String(row.found_count || 0),
    eligible_count: String(row.eligible_count || 0),
    promoted_leads_count: String(row.promoted_leads_count || 0),
    status: <Tag tone={statusTone(row.status)}>{row.status}</Tag>,
  })), [searches]);

  const columns = useMemo<TableColumn<DisplayRow>[]>(() => [
    { key: 'created_at', label: 'Data' },
    { key: 'branch_name', label: 'Ramo' },
    { key: 'state', label: 'Estado' },
    { key: 'city', label: 'Cidade' },
    { key: 'target', label: 'Meta' },
    { key: 'allocated', label: 'Alocados' },
    { key: 'found_count', label: 'Encontrados' },
    { key: 'eligible_count', label: 'Candidatos' },
    { key: 'promoted_leads_count', label: 'Leads salvos' },
    { key: 'status', label: 'Status' },
  ], []);

  const coverageByCity = useMemo(() => {
    const groups = new Map<string, CoverageRow[]>();
    for (const coverage of detail?.coverage || []) {
      const key = String(coverage.city_name || 'Cidade');
      groups.set(key, [...(groups.get(key) || []), coverage]);
    }
    return [...groups.entries()];
  }, [detail]);

  const coverageCandidates = useMemo(() => selectedCoverage && detail
    ? detail.candidates.filter((candidate) => candidateBelongsToCoverage(candidate, selectedCoverage))
    : [], [detail, selectedCoverage]);

  return (
    <>
      <PageHeader title="Pesquisas Google Maps" description="Histórico persistido pela extensão, organizado por cidade e cobertura. A configuração operacional continua no Side Panel." />
      {error ? <Panel title="Falha ao consultar pesquisas"><p>{error}</p></Panel> : null}
      <section className="metric-grid metric-grid--4"><MetricCard value={String(searches.length)} label="Pesquisas" /><MetricCard value={String(searches.reduce((sum, row) => sum + Number(row.found_count || 0), 0))} label="Encontrados" /><MetricCard value={String(searches.reduce((sum, row) => sum + Number(row.eligible_count || 0), 0))} label="Candidatos" /><MetricCard value={String(searches.reduce((sum, row) => sum + Number(row.promoted_leads_count || 0), 0))} label="Leads salvos" /></section>
      <TableCard title="Histórico" footerText={`${searches.length} pesquisa(s)`}><DataTable rows={rows} columns={columns} selectable={false} actions={['view']} onAction={(_, __, index) => void open(searches[index])} /></TableCard>
      <Drawer open={Boolean(selected)} title={selectedCoverage ? `${selectedCoverage.search_term}` : selected?.branch_name || 'Pesquisa Google Maps'} description={selectedCoverage ? `${selectedCoverage.city_name}${selectedCoverage.state_code ? ` / ${selectedCoverage.state_code}` : ''}` : selected ? `${new Date(selected.created_at).toLocaleString('pt-BR')} • ${selected.status}` : ''} size="wide" onClose={() => { setSelected(null); setSelectedCoverage(null); }}>
        {!detail ? <p>Carregando…</p> : null}
        {detail && !selectedCoverage ? <div className="maps-history-list">
          <article><strong>Resumo da execução</strong><span>{`${selected?.target_phone_whatsapp || 0} WA + ${selected?.target_instagram || 0} IG = ${selected?.target_unique || Number(selected?.target_phone_whatsapp || 0) + Number(selected?.target_instagram || 0)} leads únicos alvo`}</span></article>
          {coverageByCity.map(([cityName, coverages]) => <section key={cityName} className="maps-history-city">
            <h3>{cityName}</h3>
            {coverages.map((coverage) => <button type="button" className="maps-history-coverage-button" key={coverage.maps_search_coverage_id} onClick={() => openCoverage(coverage)}>
              <strong>{coverage.search_term}</strong>
              <span>{`${coverage.status} • ${coverage.found_count || 0} encontrados • ${coverage.eligible_count || 0} elegíveis`}</span>
            </button>)}
          </section>)}
        </div> : null}
        {detail && selectedCoverage ? <>
          <button type="button" className="maps-history-back" onClick={() => { setSelectedCoverage(null); setCoverageSnapshots(null); }}>← Voltar para cobertura</button>
          <div className="maps-history-list">
            <article><strong>Status</strong><span>{`${selectedCoverage.status} • ${selectedCoverage.found_count || 0} encontrados • ${selectedCoverage.duplicate_count || 0} duplicados • ${selectedCoverage.rejected_count || 0} rejeitados`}</span></article>
            <article><strong>Encerramento</strong><span>{String(selectedCoverage.termination_reason || selectedCoverage.last_error || 'em andamento')}</span></article>
          </div>
          <SegmentedControl items={['Resultados', 'JSON']} active={coverageTab} onChange={(nextTab) => void changeCoverageTab(nextTab)} />
          {coverageTab === 'Resultados' ? <div className="maps-history-list">{coverageCandidates.length ? coverageCandidates.map((candidate) => <article key={candidate.maps_search_candidates_id}>
            <strong>{String(candidate.candidate_name || 'Empresa')}</strong>
            <span>{[candidate.maps_rating != null ? `★ ${candidate.maps_rating}` : '', candidate.maps_reviews_count != null ? `${candidate.maps_reviews_count} avaliações` : '', candidate.acquisition_bucket ? `bucket ${candidate.acquisition_bucket}` : '', candidate.business_status && candidate.business_status !== 'unknown' ? String(candidate.business_status) : '', candidate.effective_phone, candidate.effective_whatsapp, candidate.effective_instagram, candidate.effective_website].filter(Boolean).join(' • ') || 'Sem contato elegível'}</span>
          </article>) : <p>Nenhum candidato vinculado a esta cobertura.</p>}</div> : null}
          {coverageTab === 'JSON' && snapshotsLoading ? <p>Carregando JSON da cobertura...</p> : null}
          {coverageTab === 'JSON' && coverageSnapshots !== null ? <pre className="maps-history-json">{JSON.stringify({ coverage: selectedCoverage, snapshots: coverageSnapshots }, null, 2)}</pre> : null}
        </> : null}
      </Drawer>
    </>
  );
}
