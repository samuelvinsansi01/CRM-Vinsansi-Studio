import { useEffect, useState } from 'react';
import { Button, Panel } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { getSupabaseClient } from '../lib/supabase';
import { organizationRequestHeaders } from '../services/organization/organizationSession';

export function MapsExtensionAuthorizePage({ pairingId }: { pairingId: string }) {
  const [status, setStatus] = useState<'ready' | 'authorizing' | 'authorized' | 'error'>('ready');
  const [message, setMessage] = useState('Autorize somente se você iniciou a conexão na extensão Google Maps.');

  useEffect(() => {
    if (!pairingId) { setStatus('error'); setMessage('Código de conexão ausente.'); }
  }, [pairingId]);

  const authorize = async () => {
    setStatus('authorizing');
    try {
      const { data, error } = await getSupabaseClient().auth.getSession();
      if (error || !data.session?.access_token) throw new Error('Sessão autenticada não encontrada.');
      const response = await fetch('/api/maps/pair', {
        method: 'POST',
        headers: organizationRequestHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }),
        body: JSON.stringify({ action: 'authorize', pairingId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || result.code || 'Autorização recusada.');
      setStatus('authorized');
      setMessage('Instalação autorizada. Volte ao Side Panel; esta aba pode ser fechada.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Não foi possível autorizar a extensão.');
    }
  };

  return (
    <div className="maps-pairing-page">
      <PageHeader title="Conectar à plataforma" description="A credencial da extensão Google Maps é temporária, escopada e vinculada a esta instalação." />
      <Panel title={status === 'authorized' ? 'Conexão autorizada' : 'Autorizar instalação'}>
        <p>{message}</p>
        {status !== 'authorized' ? <Button loading={status === 'authorizing'} disabled={!pairingId} onClick={authorize}>Autorizar extensão</Button> : null}
      </Panel>
    </div>
  );
}
