import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { organizationScopedAuthHeaders, resolveOrganizationContext, type OrganizationAuthContext } from '../organization/context.js';

export type Stage5Request = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};
export type Stage5Response = { status(code: number): Stage5Response; json(body: unknown): void; setHeader(name: string,value: string): void; end(): void };
export type Row = Record<string, unknown>;
declare const process: { env: Record<string,string|undefined> };

function env(...names: string[]) { for (const name of names) { const value=String(process.env[name]??'').trim(); if(value)return value; } return ''; }
export function text(value: unknown) { return String(value??'').trim(); }
export function record(value: unknown): Row { if(typeof value==='string'){try{return JSON.parse(value) as Row;}catch{return {};}}return value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{}; }
export function body(req: Stage5Request) { return record(req.body); }
export function header(req: Stage5Request,name:string){const key=Object.keys(req.headers??{}).find((item)=>item.toLowerCase()===name.toLowerCase());const value=key?req.headers?.[key]:undefined;return Array.isArray(value)?text(value[0]):text(value);}
export function bearer(req:Stage5Request){return header(req,'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim()??'';}
export function query(req:Stage5Request,name:string){const value=req.query?.[name];return Array.isArray(value)?text(value[0]):text(value);}
export function integer(value:unknown,code:string,optional=false){if(optional&&(value===null||value===undefined||text(value)===''))return null;const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<=0)throw new Error(code);return parsed;}
export function bool(value:unknown){return value===true||['true','1','yes','sim'].includes(text(value).toLowerCase());}
export function send(res:Stage5Response,status:number,payload:unknown){res.setHeader('Cache-Control','no-store');return res.status(status).json(payload);}

function serviceClient(){const url=env('SUPABASE_URL','VITE_SUPABASE_URL');const key=env('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)throw new Error('whatsapp_stage5_backend_not_configured');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}

export type HumanScope={client:SupabaseClient;admin:SupabaseClient;context:OrganizationAuthContext;memberId:number;authUserId:string};
export async function humanScope(req:Stage5Request,permission:'whatsapp.view'|'whatsapp.reply'|'whatsapp.assign'|'queues.view'|'queues.control'):Promise<HumanScope>{
  const token=bearer(req);if(!token)throw new Error('auth_required');
  const url=env('SUPABASE_URL','VITE_SUPABASE_URL');const key=env('SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEY','VITE_SUPABASE_PUBLISHABLE_KEY');
  if(!url||!key)throw new Error('supabase_auth_backend_not_configured');
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:organizationScopedAuthHeaders(token,req.headers)}});
  const auth=await client.auth.getUser(token);if(auth.error||!auth.data.user)throw new Error('auth_invalid');
  const context=await resolveOrganizationContext(client);
  // Platform Owner sem membership nunca recebe contexto comercial na Etapa 5.
  if(!context.memberId)throw new Error('conversation_active_membership_required');
  const admin=serviceClient();
  const membership=await admin.from('organization_members').select('organization_members_id,status_id').eq('organization_members_id',context.memberId).eq('organizations_id',context.organizationId).eq('status_id',1).maybeSingle();
  if(membership.error||!membership.data)throw new Error('conversation_active_membership_required');
  const allowed=await admin.rpc('stage5_member_has_permission',{p_organizations_id:context.organizationId,p_organization_members_id:context.memberId,p_permission:permission});
  if(allowed.error||allowed.data!==true)throw new Error(`conversation_permission_denied:${permission}`);
  return {client,admin,context,memberId:context.memberId,authUserId:auth.data.user.id};
}

export async function rpc(scope:HumanScope,name:string,args:Row){const result=await scope.admin.rpc(name,{p_organizations_id:scope.context.organizationId,p_organization_members_id:scope.memberId,...args});if(result.error)throw new Error(result.error.message);return result.data;}

export function status(error:unknown){const message=error instanceof Error?error.message:String(error);
  if(/auth_required|auth_invalid/.test(message))return 401;
  if(/permission_denied|membership_required|assigned_to_other|transfer_target/.test(message))return 403;
  if(/version_conflict|assignment_conflict|idempotency_conflict|requires_reconciliation|already_sent/.test(message))return 409;
  if(/not_found/.test(message))return 404;
  if(/required|invalid|not_safely|archived/.test(message))return 400;
  if(/not_configured/.test(message))return 503;
  return 500;
}

export function failure(res:Stage5Response,error:unknown){const message=error instanceof Error?error.message:String(error);return send(res,status(error),{ok:false,error:message});}

export async function evolutionCommand(scope:HumanScope,instancesId:number){
  const instances=await scope.admin.rpc('service_get_evolution_instances',{p_users_id:scope.context.scopeUsersId});
  if(instances.error)throw new Error(`evolution_instances_failed:${instances.error.message}`);
  const values=(Array.isArray(instances.data)?instances.data:[]) as Row[];
  const selected=values.find((item)=>Number(item.instances_id)===instancesId);
  if(!selected)throw new Error('conversation_instance_not_found');
  return {instanceName:text(selected.instances_name),instanceUrl:text(selected.instances_url),apiKey:text(selected.api_key)};
}

export function safeFileName(value:unknown){const base=text(value).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120);return base||'arquivo';}
export function allowedMedia(mime:string,size:number){const allowed=new Set(['image/jpeg','image/png','image/webp','video/mp4','audio/ogg','audio/mpeg','audio/mp4','application/pdf','application/octet-stream']);return allowed.has(mime)&&Number.isSafeInteger(size)&&size>0&&size<=26_214_400;}

