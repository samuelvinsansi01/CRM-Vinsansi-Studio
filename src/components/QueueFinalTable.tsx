import { useMemo, type ReactNode } from 'react';
import { DataTable, RowsPerPageControl, TableCard, Tag, type TableAction, type TableColumn } from '../design-system/components';
import { permissionsFor } from '../services/permissions';
import { statusLabel, statusTone } from '../services/status/status.mapper';
import { hasWhatsAppOperationalIssue } from '../services/whatsapp-queue/whatsappQueue.guards';
import type { WhatsAppQueueLead } from '../services/whatsapp-queue/types';
import type { InstagramQueueLead } from '../services/instagram-queue/types';
import { externalHttpHref, instagramHref, mapsHref, whatsappHref } from '../utils/externalLinks';

export type FinalLead = WhatsAppQueueLead | InstagramQueueLead;
type FinalRow = Record<string, ReactNode> & { id: string };
function availability(available: boolean, href?: string, title?: string) { const tag=<Tag tone={available?'success':'neutral'}>{available?'Sim':'Não'}</Tag>; return available&&href?<a className="availability-link" href={href} target="_blank" rel="noreferrer" title={title}>{tag}</a>:tag; }
function company(lead: FinalLead) { const href=mapsHref(lead.mapsUrl); return href?<a className="company-map-link" href={href} target="_blank" rel="noreferrer" title={`Abrir ${lead.company} no Google Maps`}><strong>{lead.company}</strong></a>:<strong title={lead.company}>{lead.company}</strong>; }
function channelCell(lead: FinalLead) { if(lead.channel==='instagram'){const value=lead.instagram_username||lead.instagram||lead.instagram_url||'';return availability(Boolean(String(value).trim()),instagramHref(value),'Abrir Instagram');} return availability(Boolean(String(lead.phone).replace(/\D/g,'')),whatsappHref(lead.phone),'Abrir WhatsApp'); }
function queueStatus(lead: FinalLead) { const issue=lead.channel==='whatsapp'&&hasWhatsAppOperationalIssue(lead); return <Tag tone={issue?'danger':statusTone(lead.status)}>{issue?'Dados incompletos':statusLabel(lead.status)}</Tag>; }

export function QueueFinalTable({ channel, leads, total, page, rowsPerPage, refreshing=false, resourceLabel, canEdit, canInvalidate, onPageChange, onRowsPerPageChange, onView, onEdit, onInvalidate }: {
  channel:'WhatsApp'|'Instagram'; leads:FinalLead[]; total:number; page:number; rowsPerPage:number; refreshing?:boolean; resourceLabel:string; canEdit:boolean; canInvalidate:boolean;
  onPageChange:(page:number)=>void; onRowsPerPageChange:(size:number)=>void;
  onView:(lead:FinalLead)=>void; onEdit:(lead:FinalLead)=>void; onInvalidate:(lead:FinalLead)=>void;
}) {
  const offset=(page-1)*rowsPerPage;
  // A posição persistida continua sendo histórica; a apresentação é contínua em toda a paginação server-side.
  const displayLeads=useMemo<FinalLead[]>(()=>[...leads]
    .sort((a,b)=>a.position-b.position||Number(a.id)-Number(b.id))
    .map((lead,index)=>({...lead,position:offset+index+1})),[leads,offset]);
  const rows=useMemo<FinalRow[]>(()=>displayLeads.map((lead)=>({ id:lead.id, position:lead.position, company:company(lead), branch:lead.branch||'—', state:lead.state||'—', city:lead.city||'—', rating:Number(lead.rating||0).toFixed(1), reviews:Number(lead.reviews||0).toLocaleString('pt-BR'), channel:channelCell(lead), instagram:availability(Boolean(String(lead.instagram_username||lead.instagram_url||lead.instagram||'').trim()),instagramHref(lead.instagram_username||lead.instagram_url||lead.instagram||''),'Abrir Instagram'), site:availability(Boolean(String(lead.site||'').trim()),externalHttpHref(lead.site),'Abrir site'), status:queueStatus(lead) })),[displayLeads]);
  const columns=useMemo<TableColumn<FinalRow>[]>(()=>{
    const base:TableColumn<FinalRow>[]=[
      {key:'position',label:'#',width:'5%'},{key:'company',label:'Empresa',width:'20%'},{key:'branch',label:'Ramo',width:'11%'},{key:'state',label:'Estado',width:'6%'},{key:'city',label:'Cidade',width:'9%'},{key:'rating',label:'Nota',width:'6%'},{key:'reviews',label:'Avaliações',width:'8%'},{key:'channel',label:channel,width:'8%'},
    ];
    if(channel==='WhatsApp')base.push({key:'instagram',label:'Instagram',width:'8%'});
    base.push({key:'site',label:'Site',width:'7%'},{key:'status',label:'Status',width:'10%'});
    return base;
  },[channel]);
  const totalPages=Math.max(1,Math.ceil(total/rowsPerPage));
  const handleAction=(action:TableAction,row:FinalRow)=>{const lead=displayLeads.find((candidate)=>candidate.id===row.id);if(!lead)return;if(action==='view')onView(lead);if(action==='edit')onEdit(lead);if(action==='invalidate')onInvalidate(lead);};
  return <TableCard title={`Listagem de disparos · ${resourceLabel}`} footerText={`${refreshing?'Atualizando · ':''}Mostrando ${rows.length} de ${total} lead(s)`} footerLeft={total?<RowsPerPageControl value={rowsPerPage} onChange={onRowsPerPageChange}/>:undefined} page={page} totalPages={totalPages} onPageChange={onPageChange}>
    {!total?<div className="table-message">Nenhum item aprovado para este recurso.</div>:null}
    {rows.length?<DataTable columns={columns} rows={rows} selectable={false} actions={['view','edit','invalidate']} actionsLabel="Ações"
      getRowActions={(row)=>{const lead=displayLeads.find((candidate)=>candidate.id===row.id);if(!lead)return[];const canInvalidateLead=lead.channel==='whatsapp'?permissionsFor('whatsapp-queue',lead.status).canInvalidate():permissionsFor('instagram-queue',lead.status).canInvalidate();return ['view' as const,...(canEdit?['edit' as const]:[]),...(canInvalidate&&canInvalidateLead?['invalidate' as const]:[])];}}
      onAction={handleAction}/>:null}
  </TableCard>;
}
