import { getSupabaseClient } from '../../lib/supabase';
import type { BaseFilters, BaseFinalStatusId, BaseLead, BaseSummary, FinalLeadIdentities } from '../../services/base/types';
import type { BaseRepository } from './base.repository';

type Row = Record<string, unknown>;

function normalize(value: unknown) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(); }
function one(value: unknown): Row { return Array.isArray(value) ? (value[0] as Row ?? {}) : (value as Row ?? {}); }
function statusName(id: number) { return ({5:'enviado',6:'invalido',7:'duplicado',8:'arquivado'} as Record<number,string>)[id] ?? 'arquivado'; }

function map(row: Row): BaseLead {
  const branch=one(row.branches), state=one(row.states), city=one(row.cities), channel=one(row.channels);
  const statusId=Number(row.last_lead_status_id) as BaseFinalStatusId;
  const origin=normalize(channel.channels_name)==='instagram'?'Instagram':'WhatsApp';
  return {
    id:String(row.canonical_lead_id), canonicalId:String(row.canonical_lead_id), company:String(row.company_name??''),
    branch:String(branch.branches_name??''), branch_id:String(row.branches_id??''), state:String(state.states_code??state.states_name??''), city:String(city.cities_name??''),
    phone:String(row.normalized_phone??''), normalizedPhone:String(row.normalized_phone??''), site:String(row.normalized_domain??''), normalizedSite:String(row.normalized_domain??''),
    instagram:String(row.normalized_instagram??''), normalizedInstagram:String(row.normalized_instagram??''), mapsUrl:String(row.normalized_maps??''),
    origin, destination: origin==='Instagram'?'Instagram':String(row.normalized_domain??'')?'Com site':'WhatsApp',
    status:statusName(statusId) as BaseLead['status'], statusId, finalizedAt:String(row.last_activity_at??''),
    totalLeads:Number(row.total_leads??1), totalDispatches:Number(row.total_dispatches??0), lastSentAt:String(row.last_sent_at??''),
    suppressed:Boolean(row.is_suppressed),
  };
}

const SELECT=`permanent_records_id,users_id,canonical_lead_id,branches_id,states_id,cities_id,channels_id,last_lead_status_id,company_name,normalized_phone,normalized_instagram,normalized_domain,normalized_maps,total_leads,total_dispatches,first_seen_at,last_activity_at,last_sent_at,is_suppressed,record_status,archived_at,branches:branches_id(branches_name),states:states_id(states_name,states_code),cities:cities_id(cities_name),channels:channels_id(channels_name)`;

async function all(): Promise<BaseLead[]> {
  const response=await getSupabaseClient().from('permanent_records').select(SELECT).order('last_activity_at',{ascending:false}).order('permanent_records_id',{ascending:false});
  if(response.error) throw new Error(`Não foi possível carregar a Base Permanente consolidada: ${response.error.message}`);
  return ((response.data??[]) as unknown as Row[]).map(map);
}

function filtered(records:BaseLead[],filters:BaseFilters={}) { const q=normalize(filters.search); return records.filter((lead)=>(!q||normalize(`${lead.company} ${lead.phone} ${lead.instagram} ${lead.site} ${lead.city} ${lead.state} ${lead.branch}`).includes(q))&&(!filters.origin||filters.origin==='Todos'||lead.origin===filters.origin)&&(!filters.branch||filters.branch==='Todos'||lead.branch===filters.branch)&&(!filters.state||filters.state==='Todos'||normalize(lead.state)===normalize(filters.state))&&(!filters.city||filters.city==='Todos'||lead.city===filters.city)&&(!filters.destination||filters.destination==='Todos'||lead.destination===filters.destination)&&(!filters.status||filters.status==='Todos'||lead.status===filters.status)); }
function summary(records:BaseLead[]):BaseSummary { const sent=records.filter(x=>x.statusId===5); return {total:records.length,sent:sent.length,sentWhatsApp:sent.filter(x=>x.origin==='WhatsApp').length,sentInstagram:sent.filter(x=>x.origin==='Instagram').length,archived:records.filter(x=>x.statusId===8).length,invalid:records.filter(x=>x.statusId===6).length,duplicates:records.filter(x=>x.statusId===7).length}; }

export const supabaseBaseRepository: BaseRepository={
  async list(filters={}){return filtered(await all(),filters);}, async summary(){return summary(await all());},
  async options(){const r=await all();const u=(v:string[])=>['Todos',...Array.from(new Set(v.filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt-BR'))];return{origins:u(r.map(x=>x.origin)),branches:u(r.map(x=>x.branch)),states:u(r.map(x=>x.state)),cities:u(r.map(x=>x.city)),destinations:u(r.map(x=>x.destination)),statuses:u(r.map(x=>x.status))};},
  async listFinalIdentities(){const response=await getSupabaseClient().from('contact_suppressions').select('identity_type,identity_value,expires_at').eq('is_active',true);if(response.error)throw new Error(`Não foi possível carregar as supressões de contato: ${response.error.message}`);const active=(response.data??[]).filter(row=>!row.expires_at||new Date(String(row.expires_at)).getTime()>Date.now());const v=(t:string)=>Array.from(new Set(active.filter(r=>r.identity_type===t).map(r=>String(r.identity_value)).filter(Boolean)));return{phones:v('phone'),sites:v('domain'),instagrams:v('instagram'),mapsUrls:v('maps')};},
};
