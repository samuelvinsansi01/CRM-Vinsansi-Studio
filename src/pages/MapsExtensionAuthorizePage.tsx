import { useEffect, useState } from 'react';
import { Button, Panel } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { getSupabaseClient } from '../lib/supabase';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { organizationRequestHeaders } from '../services/organization/organizationSession';

export function MapsExtensionAuthorizePage({ pairingId }: { pairingId: string }) {
  const { organizationId, organizations } = useOrganizationContext();
  const [status, setStatus] = useState<'ready' | 'authorizing' | 'authorized' | 'error'>('ready');
  const [message, setMessage] = useState('Autorize somente se você iniciou a conexão na extensão Google Maps.');
  const eligibleOrganizations = organizations.filter((organization) => organization.memberId !== null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');

  useEffect(() => {
    if (!pairingId) { setStatus('error'); setMessage('Código de conexão ausente.'); }
  }, [pairingId]);

  useEffect(() => {
    if (selectedOrganizationId && eligibleOrganizations.some((organization) => organization.id === selectedOrganizationId)) return;
    const activeMembership = eligibleOrganizations.find((organization) => organization.id === organizationId);
    setSelectedOrganizationId(activeMembership?.id ?? (eligibleOrganizations.length === 1 ? eligibleOrganizations[0].id : ''));
  }, [eligibleOrganizations, organizationId, selectedOrganizationId]);

  const authorize = async () => {
    setStatus('authorizing');
    try {
      if (!selectedOrganizationId) throw new Error('Selecione uma organização em que sua membership esteja ativa.');
      const { data, error } = await getSupabaseClient().auth.getSession();
      if (error || !data.session?.access_token) throw new Error('Sessão autenticada não encontrada.');
      const response = await fetch('/api/maps/pair', {
        method: 'POST',
        headers: organizationRequestHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }),
        body: JSON.stringify({ action: 'authorize', pairingId, organizationId: Number(selectedOrganizationId) }),
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
        {status !== 'authorized' ? (
          <div className="organization-form-stack">
            <label>
              <span>Organização desta instalação</span>
              <select value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)} disabled={status === 'authorizing'}>
                <option value="">Selecione uma organização</option>
                {eligibleOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
              </select>
            </label>
            {eligibleOrganizations.length === 0 ? <p>Nenhuma membership ativa com permissão de captura está disponível.</p> : null}
            <Button loading={status === 'authorizing'} disabled={!pairingId || !selectedOrganizationId} onClick={authorize}>Autorizar extensão</Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
