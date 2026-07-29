import { Panel } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useAuthContext } from '../providers/AuthProvider';

export function HomePage() {
  const { user } = useAuthContext();
  const firstName = user?.name?.split(' ')[0] || 'usuário';

  return (
    <div className="settings-page home-welcome-page">
      <PageHeader
        title="Início"
        description="A visão geral será construída a partir do layout definitivo no Figma."
      />
      <Panel title={`Olá, ${firstName}!`} className="settings-card home-welcome-card">
        <p className="settings-note">
          O painel está pronto para receber a futura visão geral. Use o menu para acessar leads, disparos, remetentes, mensagens e configurações.
        </p>
      </Panel>
    </div>
  );
}
