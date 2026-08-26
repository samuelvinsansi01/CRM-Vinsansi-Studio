import { useMemo, type ReactNode } from 'react';
import { DataTable, RowsPerPageControl, TableCard, Tag, type TableAction, type TableColumn } from '../design-system/components';
import { useClientPagination } from '../hooks/useClientPagination';
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

export function QueueFinalTable({ channel, leads, resourceLabel, canEdit, canInvalidate, onView, onEdit, onInvalidate }: {
  channel:'WhatsApp'|'Instagram'; leads:FinalLead[]; resourceLabel:string; canEdit:boolean; canInvalidate:boolean;
  onView:(lead:FinalLead)=>void; onEdit:(lead:FinalLead)=>void; onInvalidate:(lead:FinalLead)=>void;
}) {
  const rows=useMemo<FinalRow[]>(()=>leads.map((lead)=>({ id:lead.id, position:lead.position, company:company(lead), branch:lead.branch||'—', state:lead.state||'—', city:lead.city||'—', rating:Number(lead.rating||0).toFixed(1), reviews:Number(lead.reviews||0).toLocaleString('pt-BR'), channel:channelCell(lead), site:availability(Boolean(String(lead.site||'').trim()),externalHttpHref(lead.site),'Abrir site'), status:queueStatus(lead) })),[leads]);
  const columns=useMemo<TableColumn<FinalRow>[]>(()=>[
    {key:'position',label:'#',width:'5%'},{key:'company',label:'Empresa',width:'23%'},{key:'branch',label:'Ramo',width:'13%'},{key:'state',label:'Estado',width:'7%'},{key:'city',label:'Cidade',width:'11%'},{key:'rating',label:'Nota',width:'6%'},{key:'reviews',label:'Avaliações',width:'8%'},{key:'channel',label:channel,width:'8%'},{key:'site',label:'Site',width:'7%'},{key:'status',label:'Status',width:'10%'},
  ],[channel]);
  const {page,setPage,rowsPerPage,setRowsPerPage,totalPages,pageItems}=useClientPagination(rows,20);
  const handleAction=(action:TableAction,row:FinalRow)=>{const lead=leads.find((candidate)=>candidate.id===row.id);if(!lead)return;if(action==='view')onView(lead);if(action==='edit')onEdit(lead);if(action==='invalidate')onInvalidate(lead);};
  return <TableCard title={`Listagem de disparos · ${resourceLabel}`} footerText={`Mostrando ${pageItems.length} de ${leads.length} lead(s)`} footerLeft={leads.length?<RowsPerPageControl value={rowsPerPage} onChange={setRowsPerPage}/>:undefined} page={page} totalPages={totalPages} onPageChange={setPage}>
    {!leads.length?<div className="table-message">Nenhum item aprovado para este recurso.</div>:null}
    {pageItems.length?<DataTable columns={columns} rows={pageItems} selectable={false} actions={['view','edit','invalidate']} actionsLabel="Ações"
      getRowActions={(row)=>{const lead=leads.find((candidate)=>candidate.id===row.id);if(!lead)return[];const canInvalidateLead=lead.channel==='whatsapp'?permissionsFor('whatsapp-queue',lead.status).canInvalidate():permissionsFor('instagram-queue',lead.status).canInvalidate();return ['view' as const,...(canEdit?['edit' as const]:[]),...(canInvalidate&&canInvalidateLead?['invalidate' as const]:[])];}}
      onAction={handleAction}/>:null}
  </TableCard>;
}
