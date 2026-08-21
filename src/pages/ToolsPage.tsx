import { Download, PackageCheck, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';

type ToolRelease = {
  id: string;
  name: string;
  description: string;
  version: string;
  path: string;
  fileName: string;
  size: number;
};

type ToolsManifest = {
  updatedAt: string;
  tools: ToolRelease[];
};

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'data não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function ToolsPage() {
  const [manifest, setManifest] = useState<ToolsManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    void fetch(`/tools/manifest.json?v=${Date.now()}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Manifesto indisponível (${response.status}).`);
        return response.json() as Promise<ToolsManifest>;
      })
      .then((data) => {
        if (active) setManifest(data);
      })
      .catch((fetchError) => {
        if (active) setError(fetchError instanceof Error ? fetchError.message : 'Não foi possível carregar as ferramentas.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [refreshKey]);

  return (
    <div className="settings-page tools-page">
      <PageHeader
        title="Ferramentas"
        description="Baixe as extensões operacionais publicadas pela plataforma. O Worker WhatsApp é embarcado e administrado pelo Gerenciador de Disparos."
        action={<Button variant="secondary" iconLeft={RefreshCw} loading={loading} onClick={() => setRefreshKey((value) => value + 1)}>Atualizar</Button>}
      />

      <Panel
        title="Extensões disponíveis"
        className="settings-card tools-panel"
        actions={manifest ? <span className="tools-updated-at">Atualizado em {formatDate(manifest.updatedAt)}</span> : null}
      >
        {error ? <div className="table-message">{error}</div> : null}
        {loading && !manifest ? <div className="table-message">Carregando ferramentas...</div> : null}
        {!loading && !error && !manifest?.tools.length ? <div className="table-message">Nenhum pacote publicado.</div> : null}

        <div className="tools-grid">
          {manifest?.tools.map((tool) => (
            <article className="tool-card" key={tool.id}>
              <div className="tool-card__icon"><PackageCheck size={24} strokeWidth={1.8} /></div>
              <div className="tool-card__content">
                <header>
                  <strong>{tool.name}</strong>
                  <Tag tone="success">Última versão</Tag>
                </header>
                <p>{tool.description}</p>
                <div className="tool-card__meta">
                  <span>Versão {tool.version}</span>
                  <span>{formatFileSize(tool.size)}</span>
                </div>
              </div>
              <a className="button button--primary button--md tool-card__download" href={`${tool.path}?v=${encodeURIComponent(tool.version)}`} download={tool.fileName}>
                <Download size={16} strokeWidth={2} />
                <span>Baixar ZIP</span>
              </a>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
