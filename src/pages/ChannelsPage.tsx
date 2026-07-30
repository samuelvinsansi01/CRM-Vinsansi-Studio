import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { MessageCircle, RefreshCcw } from 'lucide-react';
import { Button, DataTable, MetricCard, Panel, RowsPerPageControl, TableCard, Tag, type TableColumn } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useClientPagination } from '../hooks/useClientPagination';
import { listChannelOptions, type ChannelOption } from '../repositories/configuration';

type ChannelRow = Record<string, ReactNode> & { id: string };

const columns: TableColumn<ChannelRow>[] = [
  { key: 'id', label: 'ID', width: '16%' },
  { key: 'name', label: 'Canal', width: '54%' },
  { key: 'status', label: 'Disponibilidade', width: '24%' },
];

export function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setChannels(await listChannelOptions());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar canais.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const rows: ChannelRow[] = channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    status: <Tag tone="success">Disponível</Tag>,
  }));
  const { page, setPage, rowsPerPage, setRowsPerPage, totalPages, pageItems } = useClientPagination(rows, 20);

  return (
    <div className="config-table-page channels-page">
      <PageHeader
        title="Canais do sistema"
        description="Catálogo canônico usado por leads, níveis, templates e filas. Esta página é somente leitura."
        action={<Button variant="secondary" iconLeft={RefreshCcw} loading={loading} onClick={() => void refresh()}>Atualizar</Button>}
      />
      <section className="metric-grid metric-grid--3">
        <MetricCard icon={MessageCircle} value={String(channels.length)} label="Canais disponíveis" tone="primary" />
      </section>
      <Panel title="Contrato protegido" className="settings-card settings-card--readiness">
        <p className="settings-note">Os IDs dos canais fazem parte do contrato do painel, Worker e extensão. Por segurança, não há criação, edição ou exclusão nesta tela.</p>
      </Panel>
      <TableCard
        title="Canais canônicos"
        footerText={`Mostrando ${pageItems.length} de ${channels.length} registro(s)`}
        footerLeft={<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage} />}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        {error ? <div className="configuration-state configuration-state--error">{error}</div> : null}
        {loading ? <div className="configuration-state">Carregando canais...</div> : null}
        {!loading && !error ? <DataTable<ChannelRow> rows={pageItems} columns={columns} actions={[]} selectable={false} /> : null}
      </TableCard>
    </div>
  );
}
