import { Instagram, MessageCircle, RefreshCcw, Star, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button, DataTable, FiltersBar, MetricCard, RowsPerPageControl, SearchInput, SelectField, TableCard, ToastViewport, type TableColumn, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useClientPagination } from '../hooks/useClientPagination';
import { useLeadCycle } from '../hooks/useLeadCycle';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { queueReviewService } from '../services/queue-review';
import { toLocalDateInputValue } from '../utils/date';

 type Row = Record<string, ReactNode> & { id: string };

const columns: TableColumn<Row>[] = [
  { key: 'company', label: 'Empresa', width: '25%' },
  { key: 'branch', label: 'Ramo', width: '17%' },
  { key: 'location', label: 'Localização', width: '18%' },
  { key: 'rating', label: 'Nota', width: '8%' },
  { key: 'reviews', label: 'Avaliações', width: '10%' },
  { key: 'phone', label: 'Telefone / WhatsApp', width: '11%' },
  { key: 'instagram', label: 'Instagram', width: '11%' },
];

export function HomePage() {
  const { hasPermission } = useOrganizationContext();
  const canPrepare = hasPermission('queues.prepare');
  const imported = useLeadCycle('imported');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('Todos');
  const [state, setState] = useState('Todos');
  const [pulling, setPulling] = useState<'WhatsApp' | 'Instagram' | ''>('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = (title: string, description: string, tone: ToastItem['tone'] = 'success') => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [...current, { id, title, description, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  };

  const sorted = useMemo(() => [...imported.records].sort((a, b) =>
    b.rating - a.rating || b.reviews - a.reviews || Number(a.id) - Number(b.id)
  ), [imported.records]);

  const branches = useMemo(() => ['Todos', ...Array.from(new Set(sorted.map((lead) => lead.branch).filter(Boolean))).sort()], [sorted]);
  const states = useMemo(() => ['Todos', ...Array.from(new Set(sorted.map((lead) => lead.state).filter(Boolean))).sort()], [sorted]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((lead) =>
      (!q || lead.company.toLowerCase().includes(q) || lead.phone.toLowerCase().includes(q) || lead.instagram.toLowerCase().includes(q))
      && (branch === 'Todos' || lead.branch === branch)
      && (state === 'Todos' || lead.state === state)
    );
  }, [branch, search, sorted, state]);

  const rows = useMemo<Row[]>(() => visible.map((lead) => ({
    id: lead.id,
    company: <strong>{lead.company}</strong>,
    branch: lead.branch || '-',
    location: [lead.city, lead.state].filter(Boolean).join(' / ') || '-',
    rating: lead.rating.toFixed(1),
    reviews: lead.reviews.toLocaleString('pt-BR'),
    phone: lead.whatsapp || lead.rawPhone || '-',
    instagram: lead.instagram ? `@${lead.instagram.replace(/^@/, '')}` : '-',
  })), [visible]);

  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems, resetPage } = useClientPagination(rows, 20);

  const pull = async (channel: 'WhatsApp' | 'Instagram') => {
    if (!canPrepare) return;
    setPulling(channel);
    try {
      const result = await queueReviewService.pullToCapacity(channel, toLocalDateInputValue());
      await imported.refresh();
      resetPage();
      const details = `${result.batch.openCount}/${result.batch.targetCount} lead(s) prontos para revisão em ${result.resource.label}.`;
      toast(`Fila ${channel} preparada`, details + (result.exhausted ? ' A base elegível acabou antes do limite.' : ''), result.errors ? 'warning' : 'success');
    } catch (error) {
      toast(`Não foi possível puxar ${channel}`, error instanceof Error ? error.message : 'Tente novamente.', 'danger');
    } finally {
      setPulling('');
    }
  };

  const whatsappCount = sorted.filter((lead) => (lead.whatsapp || lead.rawPhone).replace(/\D/g, '').length >= 10).length;
  const instagramCount = sorted.filter((lead) => Boolean(lead.instagram.trim())).length;

  return (
    <div className="dashboard-table-page lead-list-page home-leads-page">
      <PageHeader
        title="Início"
        description="Leads importados aguardando seleção. Os melhores avaliados são puxados primeiro, independentemente da data de entrada."
        action={(
          <div className="home-leads-actions">
            <Button variant="secondary" iconLeft={RefreshCcw} disabled={imported.loading || Boolean(pulling)} onClick={() => void imported.refresh()}>Atualizar</Button>
            {canPrepare ? <Button iconLeft={MessageCircle} loading={pulling === 'WhatsApp'} disabled={Boolean(pulling)} onClick={() => void pull('WhatsApp')}>Puxar WhatsApp</Button> : null}
            {canPrepare ? <Button iconLeft={Instagram} loading={pulling === 'Instagram'} disabled={Boolean(pulling)} onClick={() => void pull('Instagram')}>Puxar Instagram</Button> : null}
          </div>
        )}
      />

      <section className="metric-grid metric-grid--3">
        <MetricCard icon={Users} value={String(sorted.length)} label="Importados" tone="neutral" />
        <MetricCard icon={MessageCircle} value={String(whatsappCount)} label="Com telefone / WhatsApp" tone="success" />
        <MetricCard icon={Instagram} value={String(instagramCount)} label="Com Instagram" tone="primary" />
      </section>

      <FiltersBar>
        <SelectField value={branch} options={branches} placeholder="Ramo" onChange={(value) => { setBranch(value); resetPage(); }} />
        <SelectField value={state} options={states} placeholder="Estado" onChange={(value) => { setState(value); resetPage(); }} />
        <SearchInput value={search} placeholder="Buscar empresa ou contato" onChange={(value) => { setSearch(value); resetPage(); }} />
      </FiltersBar>

      <TableCard
        title="Leads importados"
        footerText={`Mostrando ${pageItems.length} de ${rows.length} lead(s) · ordenação por nota e avaliações`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {imported.error ? <div className="table-message">{imported.error}</div> : null}
        {!imported.error && imported.loading ? <div className="table-message">Carregando leads importados...</div> : null}
        {!imported.error && !imported.loading && !rows.length ? <div className="table-message">Nenhum lead importado disponível.</div> : null}
        {!imported.error && !imported.loading && pageItems.length ? <DataTable columns={columns} rows={pageItems} actions={[]} /> : null}
      </TableCard>
      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toastItem) => toastItem.id !== id))} />
    </div>
  );
}
