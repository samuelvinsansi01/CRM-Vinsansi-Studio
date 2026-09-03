import { useEffect,useMemo,useState } from 'react';
import { Button,Panel } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { getSupabaseClient } from '../lib/supabase';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { organizationRequestHeaders } from '../services/organization/organizationSession';

export function ToolBrowserAuthorizePage({pairingId}:{pairingId:string}){
  const {organizationId,organizations}=useOrganizationContext();
  const eligible=useMemo(()=>organizations.filter(x=>x.memberId!==null),[organizations]);
  const [selected,setSelected]=useState('');const [status,setStatus]=useState<'ready'|'authorizing'|'authorized'|'error'>('ready');const [message,setMessage]=useState('Autorize somente se você iniciou a conexão em uma ferramenta Vinsansi neste navegador.');
  useEffect(()=>{if(!pairingId){setStatus('error');setMessage('Código de conexão ausente.');}},[pairingId]);
  useEffect(()=>{if(selected&&eligible.some(x=>x.id===selected))return;const active=eligible.find(x=>x.id===organizationId);setSelected(active?.id??(eligible.length===1?eligible[0].id:''));},[eligible,organizationId,selected]);
  async function authorize(){setStatus('authorizing');try{if(!selected)throw new Error('Selecione a organização desta instalação.');const {data,error}=await getSupabaseClient().auth.getSession();if(error||!data.session?.access_token)throw new Error('Sessão autenticada não encontrada.');const response=await fetch('/api/tools/browser-pair',{method:'POST',headers:organizationRequestHeaders({'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`}),body:JSON.stringify({action:'authorize',pairingId,organizationId:Number(selected)})});const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok)throw new Error(result.message||result.error||'Autorização recusada.');setStatus('authorized');setMessage(`${result.toolId==='vinsansi_instagram'?'Vinsansi Instagram':'Vinsansi Captura'} autorizado. Volte à extensão; esta aba pode ser fechada.`);}catch(error){setStatus('error');setMessage(error instanceof Error?error.message:'Não foi possível autorizar a ferramenta.');}}
  return <div className="maps-pairing-page"><PageHeader title="Conectar ferramenta Vinsansi" description="A sessão é temporária, escopada à organização e vinculada a esta instalação."/><Panel title={status==='authorized'?'Conexão autorizada':'Autorizar instalação'}><p>{message}</p>{status!=='authorized'?<div className="organization-form-stack"><label><span>Organização desta instalação</span><select value={selected} onChange={e=>setSelected(e.target.value)} disabled={status==='authorizing'}><option value="">Selecione uma organização</option>{eligible.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>{eligible.length===0?<p>Nenhuma membership ativa está disponível.</p>:null}<Button loading={status==='authorizing'} disabled={!pairingId||!selected} onClick={()=>void authorize()}>Autorizar ferramenta</Button></div>:null}</Panel></div>;
}
