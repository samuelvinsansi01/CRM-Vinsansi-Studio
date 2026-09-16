import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

const ACTIVE_PAGE_STORAGE_KEY = 'painel:active-page';
const NOTIFICATION_TARGET_KEY = 'crm:notification:conversation-target';

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[crm-render-error]', error, info.componentStack);
    try {
      window.sessionStorage.setItem('crm:last-render-error', JSON.stringify({
        message: error.message,
        stack: error.stack ?? null,
        componentStack: info.componentStack ?? null,
        at: new Date().toISOString(),
      }));
    } catch {
      // Diagnóstico best-effort: nunca deixa storage quebrado derrubar o fallback.
    }
  }

  private reload = () => {
    window.location.reload();
  };

  private openDashboard = () => {
    try {
      window.sessionStorage.removeItem(ACTIVE_PAGE_STORAGE_KEY);
      window.sessionStorage.removeItem(NOTIFICATION_TARGET_KEY);
    } catch {
      // Session storage é opcional; o reload ainda deve funcionar.
    }
    window.location.assign(window.location.pathname);
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="login-page">
        <div className="login-panel">
          <strong>A interface do CRM encontrou um erro</strong>
          <p>Os dados e os serviços continuam separados da interface. Você pode recarregar a página ou voltar ao Dashboard sem sair da conta.</p>
          <code style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 16 }}>
            {this.state.error.message || 'Erro de renderização sem mensagem.'}
          </code>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button button--primary" onClick={this.reload}>Recarregar interface</button>
            <button type="button" className="button button--secondary" onClick={this.openDashboard}>Abrir Dashboard</button>
          </div>
        </div>
      </div>
    );
  }
}
