import { useEffect, useState } from 'react';
import { SegmentedControl } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { QueuePage } from './QueuePage';

type SendsChannel = 'WhatsApp' | 'Instagram';

function initialChannel(): SendsChannel {
  const routed = window.sessionStorage.getItem('crm:envios:channel');
  const remembered = window.sessionStorage.getItem('crm:envios:last-channel');
  window.sessionStorage.removeItem('crm:envios:channel');
  const stored = routed ?? remembered;
  return stored === 'Instagram' ? 'Instagram' : 'WhatsApp';
}

export function SendsPage() {
  const [channel, setChannel] = useState<SendsChannel>(initialChannel);
  useEffect(() => { window.sessionStorage.setItem('crm:envios:last-channel', channel); }, [channel]);

  return (
    <div className="sends-page">
      <PageHeader
        title="Envios"
        description="Prepare e acompanhe as filas. A execução dos motores continua exclusiva do Gerenciador de Disparos."
      />
      <div className="sends-page__channel-tabs">
        <SegmentedControl items={['WhatsApp', 'Instagram']} active={channel} onChange={(value) => setChannel(value as SendsChannel)} />
      </div>
      <QueuePage channel={channel === 'Instagram' ? 'instagram' : 'whatsapp'} embedded />
    </div>
  );
}
